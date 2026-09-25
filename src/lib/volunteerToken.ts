import { randomBytes } from "crypto"

// 18 bytes → 24 base64url chars. base64url so the token is URL-path-safe
// (no +/= to escape) and unguessable (144 bits CSPRNG).
export function generateVolunteerToken(): string {
  return randomBytes(18).toString("base64url")
}
