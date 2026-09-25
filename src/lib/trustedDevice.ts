import { randomBytes, createHmac } from "crypto"

// Pending OTP grants cannot authenticate as cookies: normal token hashes are hex.
export const DEVICE_TRUST_GRANT_PREFIX = "grant:"
export const DEVICE_TRUST_GRANT_TTL_MS = 5 * 60 * 1000

export const TRUSTED_DEVICE_COOKIE = "trusted_device"
export const TRUSTED_DEVICE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

// Opaque per-device token. The raw value lives only in the httpOnly cookie;
// the DB stores hashDeviceToken(token) so a DB-only read can't reconstruct it.
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url")
}

// HMAC keyed with AUTH_SECRET (NEXTAUTH_SECRET fallback, same as hashOtp) so a
// DB compromise alone can't forge a cookie that validates server-side.
export function hashDeviceToken(token: string): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is required to hash device tokens")
  return createHmac("sha256", secret).update(token).digest("hex")
}

// Extract the trusted_device value from a raw Cookie request header. Returns
// null when absent — authorize() gets a Request, not parsed cookies.
export function parseTrustedDeviceCookie(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === TRUSTED_DEVICE_COOKIE) {
      return part.slice(eq + 1).trim() || null
    }
  }
  return null
}
