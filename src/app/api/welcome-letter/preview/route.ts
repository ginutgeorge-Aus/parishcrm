import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { renderWelcomeLetterPdf } from "@/lib/pdf/WelcomeLetterPdf"
import { exceedsBodyLimit } from "@/lib/bodyLimit"
import { featureNotFound } from "@/lib/featureFlags"
import { ModelSchema } from "@/lib/welcomeLetter"

// The full model (all fields at their max lengths) is well under this; wide
// headroom for real payloads. Reject before req.json() buffers the
// body — Zod's field .max()s run only after a full parse, which does nothing
// against an oversized extra top-level field (bodyLimit.ts).
const MAX_BODY_BYTES = 100 * 1024

/** POST /api/welcome-letter/preview. Editors only. */
export async function POST(req: Request) {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return new Response("Unauthorized", { status: 403 })
  const off = await featureNotFound("welcomeLetter")
  if (off) return off

  if (exceedsBodyLimit(req, MAX_BODY_BYTES)) return new Response("Payload too large", { status: 413 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  const parsed = ModelSchema.safeParse(body)
  if (!parsed.success) return new Response("Bad request", { status: 400 })

  const pdf = await renderWelcomeLetterPdf(parsed.data)
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=welcome-letter-preview.pdf",
    },
  })
}
