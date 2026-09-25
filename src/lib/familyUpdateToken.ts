import "server-only"
import { randomBytes, createHash } from "crypto"

// Raw token lives ONLY in the emailed URL. The DB stores its SHA-256 hash, so a
// DB leak never exposes a live link (same pattern as password reset tokens).
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex")
}
