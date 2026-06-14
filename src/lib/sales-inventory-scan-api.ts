import crypto from "node:crypto";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shanghaiParts(now: number): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    time: `${parts.hour}${parts.minute}`,
  };
}

export function parseSalesScanRequest(body: unknown): { limit: number } {
  if (!isRecord(body)) throw new Error("请求体必须是对象");
  if ("mode" in body) throw new Error("请求体不允许指定 mode");

  const limit: unknown = body.limit === undefined ? DEFAULT_LIMIT : body.limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error("limit 必须是 1 到 500 的整数");
  }
  return { limit };
}

export function verifyScheduledScanAuthorization(
  authorization: string,
  expectedSecret?: string,
): void {
  const secret = expectedSecret?.trim();
  if (!secret) throw new Error("计划任务密钥未配置");
  if (!authorization.startsWith("Bearer ")) throw new Error("计划任务密钥无效");

  const supplied = authorization.slice("Bearer ".length).trim();
  const suppliedBuffer = Buffer.from(supplied);
  const secretBuffer = Buffer.from(secret);
  if (
    suppliedBuffer.length !== secretBuffer.length
    || !crypto.timingSafeEqual(suppliedBuffer, secretBuffer)
  ) {
    throw new Error("计划任务密钥无效");
  }
}

export function createSalesScanId(now = Date.now(), uuid = crypto.randomUUID()): string {
  const { date, time } = shanghaiParts(now);
  return `SCAN-${date}-${time}-${uuid.replace(/-/g, "").slice(0, 8)}`;
}
