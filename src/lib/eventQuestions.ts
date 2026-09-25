import { formatDMY } from "@/lib/formatting"

// Ticket-type scoping travels through the event form as a JSON array so a ticket
// name containing a comma ("Adult, member") stays one name. A bare
// comma list is still accepted for a form rendered before that change.
export function parseTicketTypeNames(raw: string): string[] {
  const t = raw.trim()
  const legacy = () => t.split(",").map((s) => s.trim()).filter(Boolean)
  if (!t.startsWith("[")) return legacy()
  try {
    const v: unknown = JSON.parse(t)
    if (Array.isArray(v)) return v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
  } catch {
    // Not JSON — a legacy list whose first name starts with "[" (e.g. "[VIP]").
  }
  return legacy()
}

export const CUSTOM_QUESTION_TYPES = [
  "text", "textarea", "number", "date", "phone", "email",
  "select", "radio", "checkbox", "consent",
] as const
export type CustomQuestionType = (typeof CUSTOM_QUESTION_TYPES)[number]

export const MAX_CUSTOM_QUESTIONS = 20
const MAX_OPTIONS = 50
const MAX_OPTION_LENGTH = 200

// Returns null when the form exceeds MAX_CUSTOM_QUESTIONS.
// Lives here (a pure module) rather than in the "use server" actions file —
// every export of a "use server" file must be async, and this is a sync helper.
//
// Question ids are submitted by the client (customQuestion.<i>.id), not
// derived from the loop position — deleting/reordering a question no
// longer shifts every later question into a lower-index id, which used to
// silently relabel historical Registration.customAnswers (keyed by id) under
// the wrong question. A missing/blank/duplicate submitted id (a stray direct
// POST, or two rows racing to the same value) falls back to a fresh
// crypto.randomUUID() so every question in the result always has a unique id.
export function parseCustomQuestions(formData: FormData) {
  const questions: { id: string; label: string; type: string; required: boolean; options?: string[]; body?: string; ticketTypeNames?: string[]; scope?: "order" | "attendee"; allowOther?: boolean; statements?: string[] }[] = []
  const seenIds = new Set<string>()
  let i = 0
  while (formData.has(`customQuestion.${i}.label`)) {
    if (i >= MAX_CUSTOM_QUESTIONS) return null
    const label = (formData.get(`customQuestion.${i}.label`) as string).trim().slice(0, 500)
    const typeRaw = (formData.get(`customQuestion.${i}.type`) as string) || "text"
    const type = (CUSTOM_QUESTION_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "text"
    const required = formData.get(`customQuestion.${i}.required`) === "true"
    const optionsRaw = (formData.get(`customQuestion.${i}.options`) as string | null) || ""
    const hasOptions = type === "select" || type === "radio" || type === "checkbox"
    // Bounded like the sibling `statements` field below — an admin-supplied
    // comma-separated list with no cap would otherwise grow Event.customQuestions
    // JSON without limit.
    const options = hasOptions
      ? optionsRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, MAX_OPTIONS).map(s => s.slice(0, MAX_OPTION_LENGTH))
      : undefined
    const bodyRaw = (formData.get(`customQuestion.${i}.body`) as string | null) || ""
    const body = type === "consent" && bodyRaw.trim() ? bodyRaw.trim().slice(0, 2000) : undefined
    const stmtRaw = (formData.get(`customQuestion.${i}.statements`) as string | null) || ""
    const statements = type === "consent"
      ? stmtRaw.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 10).map(s => s.slice(0, 500))
      : []
    const ttNamesRaw = (formData.get(`customQuestion.${i}.ticketTypeNames`) as string | null) || ""
    const ticketTypeNames = parseTicketTypeNames(ttNamesRaw).map((s) => s.slice(0, 200))
    const scopeRaw = (formData.get(`customQuestion.${i}.scope`) as string | null) || ""
    const scope = scopeRaw === "attendee" ? "attendee" : undefined
    const allowOther = hasOptions && formData.get(`customQuestion.${i}.allowOther`) === "true" ? true : undefined
    const submittedId = ((formData.get(`customQuestion.${i}.id`) as string | null) || "").trim().slice(0, 100)
    const id = submittedId && !seenIds.has(submittedId) ? submittedId : crypto.randomUUID()
    seenIds.add(id)
    const q: { id: string; label: string; type: string; required: boolean; options?: string[]; body?: string; ticketTypeNames?: string[]; scope?: "order" | "attendee"; allowOther?: boolean; statements?: string[] } =
      { id, label, type, required }
    if (options) q.options = options
    if (body) q.body = body
    if (statements.length > 0) q.statements = statements
    if (ticketTypeNames.length > 0) q.ticketTypeNames = ticketTypeNames
    if (scope) q.scope = scope
    if (allowOther) q.allowOther = allowOther
    if (label) questions.push(q)
    i++
  }
  return questions
}

export type CustomQuestion = {
  id: string
  label: string
  required: boolean
  type: CustomQuestionType
  options?: string[]
  body?: string
  ticketTypeNames?: string[]
  scope?: "order" | "attendee"
  /** Only meaningful for select | radio | checkbox — enables an "Other" write-in. */
  allowOther?: boolean
  /** Only meaningful for consent — a list of separately-ticked statements plus a final agree box. */
  statements?: string[]
}

export type CustomAnswer = string | string[] | boolean | boolean[]

/**
 * A question with no `ticketTypeNames` applies to the whole registration.
 * Otherwise it applies only when at least one selected ticket-type name is in
 * its target list. Used by both the public form and the register route so the
 * rule lives in one place.
 */
export function isQuestionApplicable(
  q: CustomQuestion,
  selectedTicketNames: Iterable<string>,
): boolean {
  if (!q.ticketTypeNames || q.ticketTypeNames.length === 0) return true
  const selected = selectedTicketNames instanceof Set ? selectedTicketNames : new Set(selectedTicketNames)
  return q.ticketTypeNames.some((n) => selected.has(n))
}

export const QUESTION_PRESETS: { label: string; question: Omit<CustomQuestion, "id"> }[] = [
  { label: "Dietary requirements", question: { label: "Dietary requirements", required: false, type: "select", options: ["None", "Vegetarian", "Vegan", "Gluten-free", "Other"] } },
  { label: "Accessibility needs", question: { label: "Accessibility needs", required: false, type: "textarea" } },
  { label: "Emergency contact", question: { label: "Emergency contact (name & phone)", required: false, type: "text" } },
  { label: "T-shirt size", question: { label: "T-shirt size", required: false, type: "select", options: ["XS", "S", "M", "L", "XL", "XXL"] } },
]

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const MAX_ANSWER_LENGTH = 2000

function isPresent(raw: CustomAnswer | undefined): boolean {
  if (raw === undefined || raw === null) return false
  if (typeof raw === "string") return raw.trim().length > 0
  if (Array.isArray(raw)) return raw.length > 0
  if (typeof raw === "boolean") return raw === true
  return false
}

export function validateAnswer(
  q: CustomQuestion,
  raw: CustomAnswer | undefined,
  now: () => Date = () => new Date(),
): { ok: true; value?: CustomAnswer } | { ok: false; error: string } {
  const label = q.label || q.id
  if (!isPresent(raw)) {
    if (q.required) return { ok: false, error: `Answer required: ${label}` }
    return { ok: true, value: undefined }
  }
  switch (q.type) {
    case "consent":
      if (q.statements && q.statements.length > 0) {
        const need = q.statements.length + 1
        const complete = Array.isArray(raw) && raw.length === need && raw.every(v => v === true)
        if (complete) return { ok: true, value: now().toISOString() }
        // Partial/empty array: required → error; optional → treat as unanswered
        // (mirrors single-box optional consent, which never errors on a stray false).
        if (q.required) return { ok: false, error: `Answer required: ${label}` }
        return { ok: true, value: undefined }
      }
      if (raw !== true) return { ok: false, error: `Answer required: ${label}` }
      return { ok: true, value: now().toISOString() }
    case "checkbox": {
      if (!Array.isArray(raw) || raw.some(v => typeof v !== "string")) return { ok: false, error: `Invalid answer: ${label}` }
      const values = raw as string[]
      const opts = q.options ?? []
      if (q.allowOther) {
        // Accept the predefined options plus at most one free-text write-in.
        const unknown = values.filter(v => !opts.includes(v))
        if (unknown.length > 1) return { ok: false, error: `Invalid option: ${label}` }
        // A blank/whitespace-only write-in is junk — the browser UI trims and
        // drops it, but a direct API POST can still send `[""]`.
        if (unknown.some(v => v.trim().length === 0)) return { ok: false, error: `Invalid option: ${label}` }
        if (unknown.some(v => v.length > MAX_ANSWER_LENGTH)) return { ok: false, error: `Answer too long: ${label}` }
        return { ok: true, value: values }
      }
      if (!values.every(v => opts.includes(v))) return { ok: false, error: `Invalid option: ${label}` }
      return { ok: true, value: values }
    }
    case "select":
    case "radio": {
      if (typeof raw !== "string") return { ok: false, error: `Invalid option: ${label}` }
      if ((q.options ?? []).includes(raw)) return { ok: true, value: raw }
      if (q.allowOther) {
        if (raw.length > MAX_ANSWER_LENGTH) return { ok: false, error: `Answer too long: ${label}` }
        return { ok: true, value: raw }
      }
      return { ok: false, error: `Invalid option: ${label}` }
    }
    case "number":
      if (typeof raw !== "string" || raw.trim() === "" || !Number.isFinite(Number(raw))) return { ok: false, error: `Invalid number: ${label}` }
      // A long run of digits (e.g. all zeroes) is still `Number.isFinite` no
      // matter how long the string is — cap it like every other free-text
      // answer type, or an unbounded numeric string bloats the stored
      // registration.
      if (raw.length > MAX_ANSWER_LENGTH) return { ok: false, error: `Answer too long: ${label}` }
      return { ok: true, value: raw }
    case "date": {
      // Require an exact YYYY-MM-DD input, then verify the components
      // round-trip through a UTC date — `Date.parse`/`new Date(string)` happily
      // normalizes an impossible date like "2014-02-30" to Mar 2 instead of
      // rejecting it, and its non-ISO parsing is runtime-dependent.
      if (typeof raw !== "string") return { ok: false, error: `Invalid date: ${label}` }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
      if (!m) return { ok: false, error: `Invalid date: ${label}` }
      const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
      const d = new Date(Date.UTC(year, month - 1, day))
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        return { ok: false, error: `Invalid date: ${label}` }
      }
      return { ok: true, value: raw }
    }
    case "email":
      if (typeof raw !== "string" || !EMAIL_RE.test(raw)) return { ok: false, error: `Invalid email: ${label}` }
      // EMAIL_RE has no length bound (unbounded `+` segments) — cap it like every
      // other free-text type; public form, encrypted + stored, rendered later.
      if (raw.length > MAX_ANSWER_LENGTH) return { ok: false, error: `Answer too long: ${label}` }
      return { ok: true, value: raw }
    default: // text, textarea, phone
      if (typeof raw !== "string") return { ok: false, error: `Invalid answer: ${label}` }
      // Cap open-ended answers — public form, encrypted + stored, later rendered
      // in admin UI/CSV. No other length guard upstream.
      if (raw.length > MAX_ANSWER_LENGTH) return { ok: false, error: `Answer too long: ${label}` }
      return { ok: true, value: raw }
  }
}

const ISO_RE = /^\d{4}-\d\d-\d\dT/

export function formatAnswerForCsv(answer: unknown, type?: string): string {
  if (answer === null || answer === undefined) return ""
  if (Array.isArray(answer)) return answer.join("; ")
  if (type === "consent" && typeof answer === "string" && ISO_RE.test(answer)) {
    const d = new Date(answer)
    return Number.isNaN(d.getTime()) ? String(answer) : `Yes (${formatDMY(d)})`
  }
  return String(answer)
}

/** A question is per-attendee only when explicitly scoped so; absent = order-level (back-compat). */
export function isAttendeeScoped(q: CustomQuestion): boolean {
  return q.scope === "attendee"
}
