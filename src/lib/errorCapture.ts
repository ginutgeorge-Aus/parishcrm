import { createHash } from "node:crypto"

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const LONGHEX = /\b[0-9a-f]{8,}\b/gi
const DIGITS = /\d+/g
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/gi
// Redact a sensitive value together with its separator. The separator may be
// `:`, `=`, or whitespace (or a mix), so `password: hunter2`, `token=abc`, and
// `bearer abc` all redact the value — not just the label.
const TOKEN = /\b(token|bearer|password|secret)\s*[:=]?\s*\S+/gi
// AU phone: optional +61/0 trunk, then a valid leading digit (mobile 4,
// landline 2/3/7/8) + 8 more, separators optional. Redacts a member's number
// echoed into an error string. Only touches the stored message, not the
// fingerprint (normalizeMessage already collapses digits independently).
const AU_PHONE = /(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}\b/g

export function normalizeMessage(msg: string): string {
  return msg.replace(UUID, "#").replace(LONGHEX, "#").replace(DIGITS, "#")
}

export function scrubMessage(msg: string): string {
  return msg
    .replace(EMAIL, "[email]")
    .replace(AU_PHONE, "[phone]")
    .replace(TOKEN, "$1=[redacted]")
    .slice(0, 500)
}

export function fingerprintError(input: { message: string; route?: string | null }): string {
  const basis = `${normalizeMessage(input.message)}|${input.route ?? ""}`
  return createHash("sha256").update(basis).digest("hex").slice(0, 12)
}

type CaptureInput = {
  errorType: string
  message: string
  route?: string | null
  method?: string | null
  correlationId?: string | null
}

// Fire-and-forget. NEVER throws, NEVER calls logger.error (a DB-down insert
// calling logger.error would insert again → loop). Guarded to the Node runtime
// so the Edge middleware bundle never pulls @prisma/adapter-pg (build break);
// prisma is dynamically imported, matching src/lib/maintenance.ts.
export function captureError(input: CaptureInput): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  void (async () => {
    try {
      const { prisma } = await import("@/lib/prisma")
      await prisma.errorLog.create({
        data: {
          fingerprint: fingerprintError({ message: input.message, route: input.route }),
          errorType: input.errorType,
          message: scrubMessage(input.message),
          route: input.route ?? null,
          method: input.method ?? null,
          correlationId: input.correlationId ?? null,
        },
      })
    } catch {
      // Swallow — the stdout log line already carries this error. Re-logging
      // here would recurse. Dropping one capture row is acceptable.
    }
  })()
}
