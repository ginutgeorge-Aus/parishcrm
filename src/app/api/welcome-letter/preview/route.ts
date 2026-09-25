import { z } from "zod"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { renderWelcomeLetterPdf } from "@/lib/pdf/WelcomeLetterPdf"
import { exceedsBodyLimit } from "@/lib/bodyLimit"

// The full model (all fields at their max lengths) is well under this; wide
// headroom for real payloads. Reject before req.json() buffers the
// body — Zod's field .max()s run only after a full parse, which does nothing
// against an oversized extra top-level field (bodyLimit.ts).
const MAX_BODY_BYTES = 100 * 1024

// Bound every field before it reaches pdfkit — any canEdit user can POST here,
// so an unbounded/malformed payload must not throw a 500 or render a huge PDF.
const BankAccountSchema = z.object({
  fundLabel: z.string().max(120),
  bank: z.string().max(100),
  bsb: z.string().max(20),
  account: z.string().max(30),
  accountName: z.string().max(120),
  taxDeductible: z.boolean(),
})

const ModelSchema = z.object({
  date: z.string().max(40),
  addresseeName: z.string().max(200),
  addressLines: z.array(z.string().max(200)).max(10),
  greetingName: z.string().max(200),
  memberNo: z.string().max(40).nullable(),
  includeTransfer: z.boolean(),
  transferChurch: z.string().max(200),
  members: z.array(z.string().max(200)).max(30),
  bodyIntro: z.string().max(8000),
  contributionsIntro: z.string().max(4000),
  bodyClosing: z.string().max(4000),
  bankAccounts: z.array(BankAccountSchema).max(4),
  signerName: z.string().max(120),
  signerTitle: z.string().max(120),
  church: z.object({
    name: z.string().max(200),
    address: z.string().max(200),
    abn: z.string().max(40),
    email: z.string().max(200),
  }),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return new Response("Unauthorized", { status: 403 })

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
