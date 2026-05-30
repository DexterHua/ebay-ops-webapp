const MIN_JWT_SECRET_LENGTH = 32;

/** 获取 JWT 密钥。禁止使用可预测的默认值。 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET 未配置或长度不足 ${MIN_JWT_SECRET_LENGTH} 位`);
  }
  return new TextEncoder().encode(secret);
}
