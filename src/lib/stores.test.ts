import { describe, expect, it } from "vitest";
import { STORES } from "@/types";

describe("store config", () => {
  it("shows all store dashboard links in the header", () => {
    expect(STORES.filter((store) => store.active).map((store) => store.name)).toEqual([
      "NewPower",
      "VelocityGear",
      "TitanRig",
      "Solidparts",
      "Nexusmoto",
    ]);
  });
});
