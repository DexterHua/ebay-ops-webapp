import { describe, expect, test, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/session-server", () => ({
  requireSession: sessionMock.requireSession,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("./store-page-client", () => ({
  default: function MockStorePageClient(props: { storeId: string }) {
    return props.storeId;
  },
}));

import StorePage from "./page";

function collectText(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(collectText).join("");
  if (typeof value === "object" && "props" in value) {
    return collectText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

describe("StorePage access guard", () => {
  test("renders the dashboard client when the current user is assigned to the store", async () => {
    sessionMock.requireSession.mockResolvedValue({
      name: "运营",
      role: "operator",
      isAdmin: false,
      storeIds: ["NP"],
      sessionVersion: 0,
    });

    const element = await StorePage({ params: Promise.resolve({ id: "NP" }) });

    expect((element as { props: { storeId: string } }).props.storeId).toBe("NP");
  });

  test("blocks manual access to an unassigned store", async () => {
    sessionMock.requireSession.mockResolvedValue({
      name: "运营",
      role: "operator",
      isAdmin: false,
      storeIds: ["VG"],
      sessionVersion: 0,
    });

    const element = await StorePage({ params: Promise.resolve({ id: "NP" }) });
    const text = collectText(element);

    expect(text).toContain("无权访问该店铺");
    expect(text).toContain("NewPower");
  });
});
