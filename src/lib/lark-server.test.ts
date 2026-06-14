import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as larkServer from "@/lib/lark-server";
import {
  calculateSalesSummaryPatch,
  calculateStockSummaryPatch,
  createLarkRecords,
  deleteLarkRecord,
  downloadLarkMedia,
  findLarkRecordByText,
  findUniqueLarkRecordByText,
  findUniqueSummaryRecordBySku,
  getLarkTableId,
  listLarkRecords,
  parseStockSummaryFlow,
  sendLarkMarkdownMessage,
  sendLarkTextToUser,
  uploadLarkRecordAttachment,
  updateLarkRecord,
  updateLarkRecords,
} from "@/lib/lark-server";

const { execFileMock, unlinkSyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("fs", () => ({
  unlinkSync: unlinkSyncMock,
  writeFileSync: writeFileSyncMock,
}));

function replyWithCliJson(payload: unknown) {
  return (...args: unknown[]) => {
    const callback = args.at(-1) as ((error: null, result: { stdout: string; stderr: string }) => void) | undefined;
    callback?.(null, { stdout: JSON.stringify(payload), stderr: "" });
  };
}

function replyWithCliError(message: string) {
  return (...args: unknown[]) => {
    const callback = args.at(-1) as ((error: Error) => void) | undefined;
    callback?.(new Error(message));
  };
}

beforeEach(() => {
  vi.stubEnv("LARK_WRITE_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  execFileMock.mockReset();
  unlinkSyncMock.mockReset();
  writeFileSyncMock.mockReset();
});

describe("飞书表格环境变量", () => {
  it.each([
    ["sourcing", "LARK_TABLE_SOURCING"],
    ["purchaseBatch", "LARK_TABLE_PURCHASE_BATCH"],
    ["shipmentBatch", "LARK_TABLE_SHIPMENT_BATCH"],
    ["inventoryDetail", "LARK_TABLE_INVENTORY_DETAIL"],
    ["inventoryException", "LARK_TABLE_INVENTORY_EXCEPTION"],
  ] as const)("%s 使用 %s", (table, envKey) => {
    vi.stubEnv(envKey, `${table}-table-id`);

    expect(getLarkTableId(table)).toBe(`${table}-table-id`);
  });
});

describe("飞书写入开关", () => {
  it("底层 CLI runner 不作为外部 API 导出，避免绕过写入开关和表映射", () => {
    expect("runLarkCli" in larkServer).toBe(false);
  });

  it("关闭写入时拒绝新增记录，且不调用本地 CLI", async () => {
    await expect(createLarkRecords("sku", [{ SKU: "SKU-1" }])).rejects.toThrow("飞书写入已关闭");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("关闭写入时拒绝更新记录，且不请求 OpenAPI", async () => {
    vi.stubEnv("LARK_APP_ID", "app-id");
    vi.stubEnv("LARK_APP_SECRET", "app-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("测试禁止真实网络请求");
    });

    await expect(updateLarkRecord("sku", "record-1", { SKU: "SKU-1" })).rejects.toThrow("飞书写入已关闭");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("关闭写入时拒绝发送消息，且不请求 OpenAPI", async () => {
    vi.stubEnv("LARK_APP_ID", "app-id");
    vi.stubEnv("LARK_APP_SECRET", "app-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("测试禁止真实网络请求");
    });

    await expect(sendLarkMarkdownMessage("chat-1", "hello")).rejects.toThrow("飞书写入已关闭");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("关闭写入时拒绝发送用户私聊消息，且不请求 OpenAPI", async () => {
    vi.stubEnv("LARK_APP_ID", "app-id");
    vi.stubEnv("LARK_APP_SECRET", "app-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("测试禁止真实网络请求");
    });

    await expect(sendLarkTextToUser("ou_user", "hello")).rejects.toThrow("飞书写入已关闭");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空数组新增直接返回，不检查写入开关", async () => {
    await expect(createLarkRecords("sku", [])).resolves.toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("飞书用户消息发送", () => {
  it("本地 CLI 按 open_id 给用户发送文本消息", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_APP_ID", "");
    vi.stubEnv("LARK_APP_SECRET", "");
    execFileMock.mockImplementation(replyWithCliJson({ ok: true, data: { message_id: "om-1" } }));

    await expect(sendLarkTextToUser("ou_user", "新增报销")).resolves.toBe("om-1");

    const cliArgs = execFileMock.mock.calls[0][1] as string[];
    expect(cliArgs).toEqual([
      "im", "+messages-send", "--user-id", "ou_user", "--text", "新增报销", "--as", "user",
    ]);
  });
});

describe("本地飞书分页", () => {
  it("OpenAPI 读取记录遇到角色权限不足时降级到本地 CLI 用户身份", async () => {
    vi.stubEnv("LARK_BASE_TOKEN", "base-token");
    vi.stubEnv("LARK_TABLE_SKU", "sku-table");
    vi.stubEnv("LARK_APP_ID", "app-id");
    vi.stubEnv("LARK_APP_SECRET", "app-secret");
    vi.stubEnv("LARK_CLI_PATH", "/usr/local/bin/lark-cli");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: "tenant-token",
          expire: 7200,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        code: 1254302,
        msg: "RolePermNotAllow",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cliArgs = args[1] as string[];
      return cliArgs.includes("+field-list")
        ? replyWithCliJson({ data: { fields: [{ id: "fld-sku", name: "SKU" }] } })(...args)
        : replyWithCliJson({
            data: {
              data: [["SKU-1"]],
              field_id_list: ["fld-sku"],
              record_id_list: ["record-1"],
              has_more: false,
            },
          })(...args);
    });

    const result = await listLarkRecords("sku", 10);

    expect(fetchMock).toHaveBeenCalled();
    expect(result).toEqual({
      records: [{ recordId: "record-1", fields: { SKU: "SKU-1" } }],
      hasMore: false,
    });
    expect(execFileMock.mock.calls.map((call) => (call[1] as string[])[1])).toEqual(["+field-list", "+record-list"]);
  });

  it("按剩余读取额度限制 CLI 单页数量，并保留截断标记", async () => {
    vi.stubEnv("LARK_BASE_TOKEN", "base-token");
    vi.stubEnv("LARK_TABLE_SKU", "sku-table");
    vi.stubEnv("LARK_APP_ID", "");
    vi.stubEnv("LARK_APP_SECRET", "");
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cliArgs = args[1] as string[];
      return cliArgs.includes("+field-list")
        ? replyWithCliJson({ data: { fields: [{ id: "fld-sku", name: "SKU" }] } })(...args)
        : replyWithCliJson({
            data: {
              data: [["SKU-1"], ["SKU-2"]],
              field_id_list: ["fld-sku"],
              record_id_list: ["record-1", "record-2"],
              has_more: true,
            },
          })(...args);
    });

    const result = await listLarkRecords("sku", 2);
    const recordListArgs = execFileMock.mock.calls[1][1] as string[];

    expect(recordListArgs[recordListArgs.indexOf("--limit") + 1]).toBe("2");
    expect(result).toMatchObject({ records: [{ recordId: "record-1" }, { recordId: "record-2" }], hasMore: true });
  });

  it("拒绝非正 maxRecords", async () => {
    await expect(listLarkRecords("sku", 0)).rejects.toThrow("maxRecords 必须为正数");
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("批量更新飞书记录", () => {
  it("按顺序逐条更新", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_BASE_TOKEN", "base-token");
    vi.stubEnv("LARK_TABLE_SKU", "sku-table");
    vi.stubEnv("LARK_APP_ID", "");
    vi.stubEnv("LARK_APP_SECRET", "");
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as ((error: null, result: { stdout: string; stderr: string }) => void) | undefined;
      callback?.(null, { stdout: JSON.stringify({ ok: true }), stderr: "" });
    });

    await updateLarkRecords("sku", [
      { recordId: "record-1", fields: { SKU: "SKU-1" } },
      { recordId: "record-2", fields: { SKU: "SKU-2" } },
    ]);

    expect(execFileMock.mock.calls.map((call) => {
      const args = call[1] as string[];
      return args[args.indexOf("--record-id") + 1];
    })).toEqual(["record-1", "record-2"]);
  });

  it("中途失败时报告失败记录和已完成数量", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_BASE_TOKEN", "base-token");
    vi.stubEnv("LARK_TABLE_SKU", "sku-table");
    vi.stubEnv("LARK_APP_ID", "");
    vi.stubEnv("LARK_APP_SECRET", "");
    execFileMock
      .mockImplementationOnce(replyWithCliJson({ ok: true }))
      .mockImplementationOnce(replyWithCliError("mock update failed"));

    await expect(updateLarkRecords("sku", [
      { recordId: "record-1", fields: { SKU: "SKU-1" } },
      { recordId: "record-2", fields: { SKU: "SKU-2" } },
      { recordId: "record-3", fields: { SKU: "SKU-3" } },
    ])).rejects.toThrow(/record-2.*1/);
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});

describe("飞书临时 JSON 文件", () => {
  it("使用仅当前用户可读写的独占文件并保持清理", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_BASE_TOKEN", "base-token");
    vi.stubEnv("LARK_TABLE_SKU", "sku-table");
    vi.stubEnv("LARK_APP_ID", "");
    vi.stubEnv("LARK_APP_SECRET", "");
    execFileMock.mockImplementation(replyWithCliJson({ ok: true }));

    await updateLarkRecord("sku", "record-1", { SKU: "SKU-1" });

    const filename = writeFileSyncMock.mock.calls[0][0];
    expect(writeFileSyncMock).toHaveBeenCalledWith(filename, JSON.stringify({ SKU: "SKU-1" }), {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    expect(unlinkSyncMock).toHaveBeenCalledWith(filename);
  });

  it("OpenAPI 新增记录遇到角色权限不足时降级到本地 CLI 用户身份", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_BASE_TOKEN", "base-token");
    vi.stubEnv("LARK_TABLE_SKU", "sku-table");
    vi.stubEnv("LARK_APP_ID", "app-id");
    vi.stubEnv("LARK_APP_SECRET", "app-secret");
    vi.stubEnv("LARK_CLI_PATH", "/usr/local/bin/lark-cli");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: "tenant-token",
          expire: 7200,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        code: 1254302,
        msg: "RolePermNotAllow",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    execFileMock.mockImplementation(replyWithCliJson({ ok: true, data: { record_id_list: ["cli-rec-1"] } }));

    await expect(createLarkRecords("sku", [{ SKU: "SKU-1" }])).resolves.toEqual(["cli-rec-1"]);

    expect(fetchMock).toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][0]).toBe("/usr/local/bin/lark-cli");
    expect(execFileMock.mock.calls[0][1]).toContain("+record-batch-create");
  });

  it("OpenAPI 更新记录遇到角色权限不足时降级到本地 CLI 用户身份", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_BASE_TOKEN", "base-token");
    vi.stubEnv("LARK_TABLE_SKU", "sku-table");
    vi.stubEnv("LARK_APP_ID", "app-id");
    vi.stubEnv("LARK_APP_SECRET", "app-secret");
    vi.stubEnv("LARK_CLI_PATH", "/usr/local/bin/lark-cli");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: "tenant-token",
          expire: 7200,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        code: 1254302,
        msg: "RolePermNotAllow",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    execFileMock.mockImplementation(replyWithCliJson({ ok: true }));

    await expect(updateLarkRecord("sku", "record-1", { SKU: "SKU-1" })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][0]).toBe("/usr/local/bin/lark-cli");
    expect(execFileMock.mock.calls[0][1]).toContain("+record-upsert");
  });
});

describe("飞书附件上传", () => {
  it("上传文件时在文件所在目录执行 CLI，并传相对文件路径", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_BASE_FINANCE", "finance-base");
    vi.stubEnv("LARK_TABLE_FINANCE", "finance-table");
    vi.stubEnv("LARK_APP_ID", "");
    vi.stubEnv("LARK_APP_SECRET", "");
    execFileMock.mockImplementation(replyWithCliJson({ ok: true }));

    await uploadLarkRecordAttachment({
      table: "finance",
      recordId: "record-1",
      field: "发票及付款记录",
      filePath: "/private/tmp/finance-vouchers-abc/1-voucher.png",
      name: "voucher.png",
    });

    const cliArgs = execFileMock.mock.calls[0][1] as string[];
    const cliOptions = execFileMock.mock.calls[0][2] as { cwd?: string };
    expect(cliOptions.cwd).toBe("/private/tmp/finance-vouchers-abc");
    expect(cliArgs[cliArgs.indexOf("--file") + 1]).toBe("./1-voucher.png");
  });
});

describe("飞书记录删除", () => {
  it("本地 CLI 删除记录时带确认参数", async () => {
    vi.stubEnv("LARK_WRITE_ENABLED", "true");
    vi.stubEnv("LARK_BASE_FINANCE", "finance-base");
    vi.stubEnv("LARK_TABLE_FINANCE", "finance-table");
    vi.stubEnv("LARK_APP_ID", "");
    vi.stubEnv("LARK_APP_SECRET", "");
    execFileMock.mockImplementation(replyWithCliJson({ ok: true }));

    await deleteLarkRecord("finance", "rec-1");

    expect(execFileMock.mock.calls[0][1]).toEqual([
      "base", "+record-delete",
      "--base-token", "finance-base",
      "--table-id", "finance-table",
      "--record-id", "rec-1",
      "--yes",
      "--as", "user",
    ]);
  });
});

describe("飞书素材下载", () => {
  it("使用 tenant token 下载素材二进制内容", async () => {
    vi.stubEnv("LARK_APP_ID", "app-id");
    vi.stubEnv("LARK_APP_SECRET", "app-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: "tenant-token",
          expire: 7200,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": "attachment; filename=\"voucher.png\"",
        },
      });
    });

    const result = await downloadLarkMedia("box-token");

    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.contentType).toBe("image/png");
    expect(result.filename).toBe("voucher.png");
    const mediaCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/drive/v1/medias/box-token/download"));
    expect(mediaCall?.[0]).toBe("https://open.feishu.cn/open-apis/drive/v1/medias/box-token/download");
    expect(mediaCall?.[1]).toMatchObject({
      headers: { Authorization: "Bearer tenant-token" },
    });
  });
});

describe("严格文本查找", () => {
  const first = { recordId: "record-1", fields: { 批次号: "BATCH-1" } };

  it("导出异步查找包装函数", () => {
    expect(findLarkRecordByText).toBeTypeOf("function");
  });

  it("分页未完整读取时拒绝查找", () => {
    expect(() => findUniqueLarkRecordByText({ records: [first], hasMore: true }, "批次号", "BATCH-1"))
      .toThrow("未完整读取");
  });

  it("匹配到重复文本时拒绝查找", () => {
    expect(() => findUniqueLarkRecordByText({
      records: [first, { recordId: "record-2", fields: { 批次号: "BATCH-1" } }],
      hasMore: false,
    }, "批次号", "BATCH-1")).toThrow("匹配到多条");
  });

  it("匹配到单条文本时返回记录", () => {
    expect(findUniqueLarkRecordByText({ records: [first], hasMore: false }, "批次号", "BATCH-1")).toBe(first);
  });

  it("没有匹配文本时返回 undefined", () => {
    expect(findUniqueLarkRecordByText({ records: [first], hasMore: false }, "批次号", "BATCH-2")).toBeUndefined();
  });
});

describe("严格汇总读取", () => {
  const summary = { recordId: "summary-1", fields: { SKU: "SKU-1" } };

  it("汇总记录分页未完整读取时拒绝选择 SKU", () => {
    expect(() => findUniqueSummaryRecordBySku({ records: [summary], hasMore: true }, "SKU-1"))
      .toThrow("未完整读取");
  });

  it("汇总记录存在重复 SKU 时拒绝选择", () => {
    expect(() => findUniqueSummaryRecordBySku({
      records: [summary, { recordId: "summary-2", fields: { SKU: "SKU-1" } }],
      hasMore: false,
    }, "SKU-1")).toThrow("匹配到多条");
  });

	  it("销售记录分页未完整读取时拒绝计算累计销量", () => {
	    expect(() => calculateSalesSummaryPatch({
	      records: [{ recordId: "sales-1", fields: { SKU: "SKU-1", 售出数量: 3 } }],
	      hasMore: true,
	    }, "SKU-1", 1780400000000)).toThrow("销售记录未完整读取");
	  });

	  it("拒绝坏销售数量，避免默默计为 0 后覆盖汇总", () => {
	    expect(() => calculateSalesSummaryPatch({
	      records: [{ recordId: "sales-1", fields: { SKU: "SKU-1", 售出数量: "abc", 日期: 1780400000000 } }],
	      hasMore: false,
	    }, "SKU-1", 1780400000000)).toThrow("售出数量");
	  });

	  it("拒绝坏销售日期，避免近 7 日销量被静默排除", () => {
	    expect(() => calculateSalesSummaryPatch({
	      records: [{ recordId: "sales-1", fields: { SKU: "SKU-1", 售出数量: 3, 日期: "bad-date" } }],
	      hasMore: false,
	    }, "SKU-1", 1780400000000)).toThrow("日期");
	  });
	});

describe("零散库存流水汇总 patch", () => {
  const summary = {
    本地库存: 10,
    国内集货仓: 20,
    橙联在途: 30,
    橙联可售: 40,
    异常暂存: 5,
  };

  it("国内集货仓变动计入总可用库存和账面总量", () => {
    expect(calculateStockSummaryPatch(summary, "国内集货仓", 2)).toEqual({
      国内集货仓: 22,
      总可用库存: 102,
      账面总量: 107,
    });
  });

  it("异常暂存变动只计入账面总量", () => {
    expect(calculateStockSummaryPatch(summary, "异常暂存", 3)).toEqual({
      异常暂存: 8,
      总可用库存: 100,
      账面总量: 108,
    });
  });

  it("拒绝未知库存位置", () => {
    expect(() => calculateStockSummaryPatch(summary, "未知位置", 1)).toThrow("未知库存位置");
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("拒绝非法 delta：%s", (delta) => {
    expect(() => calculateStockSummaryPatch(summary, "本地仓", delta)).toThrow("数量变动");
  });

  it.each(["本地库存", "国内集货仓", "橙联在途", "橙联可售", "异常暂存"] as const)(
    "拒绝非法已有汇总字段：%s",
    (field) => {
      expect(() => calculateStockSummaryPatch({ ...summary, [field]: Number.NaN }, "本地仓", 1)).toThrow(field);
    },
  );

  it.each([null, "", {}])("拒绝显式非法汇总值：%j", (value) => {
    expect(() => calculateStockSummaryPatch({ ...summary, 本地库存: value }, "本地仓", 1)).toThrow("本地库存");
  });

  it("旧汇总记录缺少新增列时按零库存兼容", () => {
    expect(calculateStockSummaryPatch({ 本地库存: 10, 橙联在途: 20, 橙联可售: 30 }, "本地仓", 1)).toEqual({
      本地库存: 11,
      总可用库存: 61,
      账面总量: 61,
    });
  });

  it("拒绝任何结果负库存", () => {
    expect(() => calculateStockSummaryPatch({ ...summary, 本地库存: 0 }, "本地仓", -1)).toThrow("库存不足");
  });
});

describe("零散库存流水输入", () => {
  it("未知位置在同步前拒绝", () => {
    expect(() => parseStockSummaryFlow({ SKU: "SKU-1", 库存位置: "未知位置", 数量变动: 1 }))
      .toThrow("未知库存位置");
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("非法 delta 在同步前拒绝：%s", (delta) => {
    expect(() => parseStockSummaryFlow({ SKU: "SKU-1", 库存位置: "本地仓", 数量变动: delta }))
      .toThrow("数量变动");
  });
});
