import { describe, expect, it } from "vitest";
import { configuredLarkUserReference } from "./lark-user-map";

describe("configured Feishu user references", () => {
  it("maps the trimmed session name to a validated open_id", () => {
    expect(configuredLarkUserReference(" 车泉 ", '{"车泉":" ou_owner_123 "}')).toEqual([
      { id: "ou_owner_123" },
    ]);
  });

  it.each([undefined, "", "not-json", "[]", '{"车泉":"invalid"}'])(
    "returns undefined for unavailable or invalid mapping %s",
    (raw) => {
      expect(configuredLarkUserReference("车泉", raw)).toBeUndefined();
    },
  );
});
