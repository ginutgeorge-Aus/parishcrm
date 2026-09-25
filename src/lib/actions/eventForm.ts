import { z } from "zod"
import { CATEGORIES, RECURS } from "@/lib/eventConstants"
import { sydneyDatetimeLocalToUTC } from "@/lib/dates"
import { parseCustomQuestions, MAX_CUSTOM_QUESTIONS } from "@/lib/eventQuestions"
import { parseOrganizers } from "@/lib/eventOrganizers"
import { parseTiers } from "@/lib/eventTiers"
import { MONEY_DECIMAL_RE } from "@/lib/validation"
import { EventImageKind } from "@/lib/generated/prisma/enums"
import { Prisma } from "@/lib/generated/prisma/client"

export const EventSchema = z.object({
  title: z.string().min(1, "Title required").max(200),
  slug: z.string().min(1, "Slug required").max(200, "Slug is too long").regex(/^[a-z0-9-]+$/, "Slug: lowercase letters, numbers, hyphens only"),
  description: z.string().max(2000).optional(),
  kind: z.enum(["one_off", "recurring"]).default("one_off"),
  category: z.enum(CATEGORIES).catch("worship"),
  // Validate the exact string sydneyDatetimeLocalToUTC parses (`v + ":00.000Z"`),
  // not a bare `new Date(v)` — a date-only value like "2026-08-01" is valid to
  // `new Date` but becomes Invalid Date once the converter appends the time.
  date: z.string().optional().refine(v => !v || !isNaN(new Date(v + ":00.000Z").getTime()), "Invalid date"),
  endDate: z.string().optional().refine(v => !v || !isNaN(new Date(v + ":00.000Z").getTime()), "Invalid end date"),
  registrationDeadline: z.string().optional().refine(v => !v || !isNaN(new Date(v + ":00.000Z").getTime()), "Invalid registration deadline"),
  recurs: z.enum(RECURS).optional(),
  recursLabel: z.string().max(40).optional(),
  startTime: z.string().max(40).optional(),
  location: z.string().max(200).optional(),
  bankBsb: z.string().max(20).optional(),
  bankAccount: z.string().max(20).optional(),
  onlinePaymentEnabled: z.string().optional().transform((v) => v === "on"),
  passCardFee: z.string().optional().transform((v) => v === "on"),
  familyWaiverEnabled: z.string().optional().transform((v) => v === "on"),
  familyWaiverThreshold: z.coerce.number().int().min(0, "Threshold must be 0 or more").max(1000, "Threshold too large").optional(),
  tieredPricingEnabled: z.string().optional().transform((v) => v === "on"),
  imageUrl: z.string().trim().max(2048).regex(/^https:\/\//, "Image URL must start with https://").optional(),
  reminderDaysBefore: z.coerce.number().int().min(1, "Reminder days must be at least 1").max(90, "Reminder days too large").optional(),
}).superRefine((data, ctx) => {
  if (data.kind === "one_off" && !data.date) {
    ctx.addIssue({ code: "custom", message: "Date required for one-off events", path: ["date"] })
  }
  if (data.kind === "recurring" && !data.recurs) {
    ctx.addIssue({ code: "custom", message: "Recurrence pattern required for recurring events", path: ["recurs"] })
  }
  if (data.tieredPricingEnabled && data.familyWaiverEnabled) {
    ctx.addIssue({ code: "custom", message: "Enable either tiered pricing or the family waiver, not both", path: ["tieredPricingEnabled"] })
  }
  // Cross-field date ordering — each field is individually validated
  // as a parseable date string above, but nothing checked they made sense
  // together: an end before the start, or a registration deadline after the
  // event has already finished.
  const toTime = (v: string | undefined) => (v ? new Date(v + ":00.000Z").getTime() : undefined)
  const start = toTime(data.date)
  const end = toTime(data.endDate)
  const deadline = toTime(data.registrationDeadline)
  if (start !== undefined && end !== undefined && end < start) {
    ctx.addIssue({ code: "custom", message: "End date must not be before the start date", path: ["endDate"] })
  }
  const closesBy = end ?? start
  if (deadline !== undefined && closesBy !== undefined && deadline > closesBy) {
    ctx.addIssue({ code: "custom", message: "Registration deadline must not be after the event ends", path: ["registrationDeadline"] })
  }
})

// Sentinel thrown inside the updateEvent transaction to roll back when a
// removed ticket type still has registrations.
export const TICKET_TYPE_IN_USE = "TICKET_TYPE_IN_USE"

// Sentinel prefix thrown when a kept ticket type's capacity is lowered below
// its already-sold quantity. Carries "sold:name" after the prefix —
// sold first because the name itself may contain colons.
export const CAPACITY_BELOW_SOLD = "CAPACITY_BELOW_SOLD"

// Sentinel thrown inside the updateEvent transaction when the optimistic-
// concurrency guard matches 0 rows — rolls back any ticket type
// writes already applied earlier in the same transaction.
export const STALE_EVENT = "STALE_EVENT"

// Hard caps on form-driven loops — unbounded entries become unbounded DB
// writes inside one request.
const MAX_TICKET_TYPES = 20

// bankBsb/bankAccount are CRM-internal: they are excluded from SYNC_SELECT and
// must never appear in WebsiteEventPayload (website-sync.ts).
const EVENT_FIELDS: Array<keyof z.input<typeof EventSchema>> = ["title", "slug", "description", "kind", "category", "date", "endDate", "registrationDeadline", "recurs", "recursLabel", "startTime", "location", "bankBsb", "bankAccount", "onlinePaymentEnabled", "passCardFee", "familyWaiverEnabled", "familyWaiverThreshold", "tieredPricingEnabled", "imageUrl", "reminderDaysBefore"]

// Build the shared Event column payload from validated form data. `tiers`
// comes from parseTiers(formData) — EventSchema can't see it (it's not a
// Zod-parsed field, just repeated `tier.<i>.price` rows).
export function eventData(d: z.infer<typeof EventSchema>, tiers: number[]) {
  const recurring = d.kind === "recurring"
  return {
    title: d.title,
    slug: d.slug,
    description: d.description || null,
    kind: d.kind,
    category: d.category,
    date: !recurring && d.date ? sydneyDatetimeLocalToUTC(d.date) : null,
    endDate: d.endDate ? sydneyDatetimeLocalToUTC(d.endDate) : null,
    registrationDeadline: d.registrationDeadline ? sydneyDatetimeLocalToUTC(d.registrationDeadline) : null,
    recurs: recurring ? (d.recurs || null) : null,
    recursLabel: recurring ? (d.recursLabel || null) : null,
    startTime: recurring ? (d.startTime || null) : null,
    location: d.location || null,
    bankBsb: d.bankBsb || null,
    bankAccount: d.bankAccount || null,
    onlinePaymentEnabled: d.onlinePaymentEnabled,
    // Surcharge is meaningless without online card payment. Force it off when
    // online pay is off so a form-bypassing request can't persist dead data
    // that silently activates if online pay is later enabled.
    passCardFee: d.onlinePaymentEnabled && d.passCardFee,
    familyWaiverEnabled: d.familyWaiverEnabled,
    familyWaiverThreshold: d.familyWaiverThreshold ?? 4,
    tieredPricingEnabled: d.tieredPricingEnabled,
    familyPricingTiers: d.tieredPricingEnabled ? tiers : Prisma.JsonNull,
    imageUrl: d.imageUrl || null,
    reminderDaysBefore: !recurring && d.reminderDaysBefore ? d.reminderDaysBefore : null,
  }
}

type TicketTypeInput = { id: number | null; name: string; price: string; capacity: number | null; countsTowardWaiver: boolean }

// Postgres int4 upper bound — a capacity above this overflows the column and
// surfaces as a raw P2003 500 instead of a clean validation error.
const MAX_INT4 = 2147483647

// TicketType.price is Decimal(10,2) — 8 integer digits max. MONEY_DECIMAL_RE has
// no upper bound, so a 9+ digit price passes format validation and overflows the
// column, surfacing as a raw Postgres numeric-overflow 500 instead of a clean
// validation error.
const MAX_TICKET_PRICE = 99999999.99

// capped at 2 MB (down from 5 MB) so the two images together (banner +
// poster) fit under `serverActions.bodySizeLimit` — that Next.js setting has no
// per-action override, so raising it for this admin-only upload also raises it
// for the public unauth actions sharing the same config
// (submitMembershipApplication/submitFamilyUpdate/startEventCheckout). Those
// public actions no longer buffer up to that cap: middleware caps every
// public-path POST at MAX_PUBLIC_BODY_BYTES (1 MB) pre-buffer (`publicBodyTooLarge`
// in src/lib/bodyLimit.ts). This admin path is not public, so it keeps the 5mb cap.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"])

export type ImageOp =
  | { op: "skip" }
  | { op: "delete" }
  | { op: "upsert"; bytes: Uint8Array<ArrayBuffer>; mimeType: string }

// field = "banner" | "poster". Reads `<field>File` and `<field>.remove` from the
// form. Size is checked BEFORE arrayBuffer() (OOM guard, security.md).
// A newly-selected valid file wins over the Remove checkbox — checking
// Remove and picking a replacement in the same submit replaces, not deletes.
export async function parseImageUpload(
  formData: FormData,
  field: "banner" | "poster",
): Promise<{ error: string } | ImageOp> {
  const file = formData.get(`${field}File`)
  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_IMAGE_MIME.has(file.type)) return { error: "Image must be JPEG, PNG or WebP" }
    if (file.size > MAX_IMAGE_BYTES) return { error: "Image must be 2 MB or smaller" }
    const ab = await file.arrayBuffer()
    const bytes = new Uint8Array(ab.byteLength)
    bytes.set(new Uint8Array(ab))
    return { op: "upsert", bytes, mimeType: file.type }
  }
  if (formData.get(`${field}.remove`) === "true") return { op: "delete" }
  return { op: "skip" }
}

// tx = a Prisma client or transaction client (both expose eventImage).
export async function applyImageOp(
  tx: Pick<Prisma.TransactionClient, "eventImage">,
  eventId: number,
  kind: EventImageKind,
  imgOp: ImageOp,
) {
  if (imgOp.op === "skip") return
  if (imgOp.op === "delete") {
    await tx.eventImage.deleteMany({ where: { eventId, kind } })
    return
  }
  await tx.eventImage.upsert({
    where: { eventId_kind: { eventId, kind } },
    create: { eventId, kind, data: imgOp.bytes, mimeType: imgOp.mimeType },
    update: { data: imgOp.bytes, mimeType: imgOp.mimeType },
  })
}

// Returns { error } for an over-limit form or an out-of-range capacity;
// otherwise { types }.
function parseTicketTypes(formData: FormData): { error: string } | { types: TicketTypeInput[] } {
  const types: TicketTypeInput[] = []
  let i = 0
  while (formData.has(`ticketType.${i}.name`)) {
    if (i >= MAX_TICKET_TYPES) return { error: `Too many ticket types (max ${MAX_TICKET_TYPES})` }
    const idRaw = ((formData.get(`ticketType.${i}.id`) as string | null) ?? "").trim()
    // Digit-only: rejects "5abc"/"1e9"-style strings that parseInt would truncate.
    const id = /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : null
    const name = (formData.get(`ticketType.${i}.name`) as string).trim()
    // Validate the money format on the raw string and store it as-is in the
    // Decimal(10,2) column — never parseFloat (rejects "1e3"/"9.999" that would
    // otherwise be silently coerced or truncated by Postgres).
    const price = ((formData.get(`ticketType.${i}.price`) as string | null) ?? "").trim()
    const capRaw = ((formData.get(`ticketType.${i}.capacity`) as string | null) ?? "").trim()
    // A fully-blank row is a trailing form slot — skip it. But a NAMED row with
    // a bad/blank price is a user typo: surface it instead of silently dropping
    // the row, which on update reads as a ticket-type removal (delete/FK error).
    if (name) {
      if (!MONEY_DECIMAL_RE.test(price)) return { error: `Invalid price for ticket type "${name}"` }
      if (Number(price) > MAX_TICKET_PRICE) return { error: `Invalid price for ticket type "${name}"` }
      let capacity: number | null = null
      if (capRaw) {
        const n = parseInt(capRaw, 10)
        if (isNaN(n) || n <= 0 || n > MAX_INT4)
          return { error: `Capacity for "${name}" must be a whole number between 1 and ${MAX_INT4}` }
        capacity = n
      }
      const countsTowardWaiver = formData.get(`ticketType.${i}.countsToward`) === "on"
      types.push({ id, name, price, capacity, countsTowardWaiver })
    }
    i++
  }
  return { types }
}

export type ParsedEventForm = {
  parsed: z.infer<typeof EventSchema>
  ticketTypes: TicketTypeInput[]
  customQuestions: NonNullable<ReturnType<typeof parseCustomQuestions>>
  organizers: ReturnType<typeof parseOrganizers>
  tiers: number[]
}

// Shared form validation for createEvent/updateEvent — Zod parse + ticket
// types + custom questions, with the exact same error strings and ordering.
export function parseEventForm(formData: FormData): { error: string } | ParsedEventForm {
  const parsed = EventSchema.safeParse(Object.fromEntries(
    EVENT_FIELDS.map(k => [k, formData.get(k) || undefined])
  ))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const ttResult = parseTicketTypes(formData)
  if ("error" in ttResult) return { error: ttResult.error }

  const tierResult = parseTiers(formData)
  if ("error" in tierResult) return { error: tierResult.error }
  if (parsed.data.tieredPricingEnabled && tierResult.tiers.length === 0) {
    return { error: "Add at least one pricing tier" }
  }

  const customQuestions = parseCustomQuestions(formData)
  if (!customQuestions) return { error: `Too many questions (max ${MAX_CUSTOM_QUESTIONS})` }

  const organizers = parseOrganizers(formData)

  return { parsed: parsed.data, ticketTypes: ttResult.types, customQuestions, organizers, tiers: tierResult.tiers }
}
