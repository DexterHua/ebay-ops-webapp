const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;

export function configuredLarkUserReference(
  sessionName: string,
  rawMapping: string | undefined = process.env.LARK_USER_OPEN_IDS,
): Array<{ id: string }> | undefined {
  const normalizedName = sessionName.trim();
  if (!normalizedName || !rawMapping?.trim()) return undefined;

  try {
    const parsed: unknown = JSON.parse(rawMapping);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const value = (parsed as Record<string, unknown>)[normalizedName];
    if (typeof value !== "string") return undefined;
    const openId = value.trim();
    return OPEN_ID_PATTERN.test(openId) ? [{ id: openId }] : undefined;
  } catch {
    return undefined;
  }
}
