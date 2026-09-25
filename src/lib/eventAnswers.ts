import { safeDecrypt } from "@/lib/crypto"

// customAnswers / Attendee.answers are encrypted at rest as a serialized JSON
// string scalar. Decrypt + parse back to an object; legacy plaintext-
// object rows (pre-encryption) arrive as objects and fall through unchanged.
// safeDecrypt returns plaintext unchanged; a malformed value parses to null → skip.
// Server-only: imports node crypto via safeDecrypt — never import into a client module.
export function toAnswerMap(v: unknown): Record<string, string | string[]> | null {
  if (typeof v === "string") {
    try {
      v = JSON.parse(safeDecrypt(v))
    } catch {
      return null
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const out: Record<string, string | string[]> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = Array.isArray(val) ? val.map(String) : typeof val === "string" ? val : String(val ?? "")
  }
  return out
}
