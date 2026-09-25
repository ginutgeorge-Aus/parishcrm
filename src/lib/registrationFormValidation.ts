// Pure submit-gate + pricing logic for the public event RegistrationForm,
// extracted from the component so the branchy validation rules can be
// unit-tested without React/Turnstile/fetch. No DOM, no hooks — mirrors the
// server-side enforcement in the registration API.

import { isQuestionApplicable, isAttendeeScoped } from "@/lib/eventQuestions"
import { computeTieredTotal } from "@/lib/eventTieredPricing"
import { grossUpTotal } from "@/lib/cardFee"
import type { CustomQuestionType } from "@/lib/eventQuestions"

export type TicketType = { id: number; name: string; price: number; capacity: number | null }
export type CustomQuestion = { id: string; label: string; type: CustomQuestionType; required: boolean; options?: string[]; body?: string; ticketTypeNames?: string[]; scope?: "order" | "attendee"; statements?: string[] }
export type AnswerValue = string | string[] | boolean | boolean[]
export type Quantities = Record<number, number>
export type Answers = Record<string, AnswerValue>
export type Names = Record<number, string[]>
export type AttendeeAnswers = Record<number, Array<Record<string, AnswerValue>>>

// Required consent questions must be explicitly checked before submit. A
// statements-consent question is only "answered" when its boolean[] is the
// full length (N statements + final agree) and every box is true; a plain
// consent stays a single `true`.
export function isConsentAnswered(q: CustomQuestion, v: unknown): boolean {
  if (q.statements && q.statements.length > 0) {
    return Array.isArray(v) && v.length === q.statements.length + 1 && v.every(Boolean)
  }
  return v === true
}

export function allConsentChecked(orderQuestions: CustomQuestion[], answers: Answers): boolean {
  return orderQuestions
    .filter(q => q.type === "consent" && q.required)
    .every(q => isConsentAnswered(q, answers[q.id]))
}

// Required choice questions must be answered before submit. Checkbox groups
// never had a native "at least one" guard; radio/select lost their
// native `required` when the "Other" write-in moved rendering into QuestionField
// sub-components, so the gate is enforced here instead — this also blocks the
// "Other selected but text left empty" case (answer is an empty string).
export function allRequiredChoicesMade(orderQuestions: CustomQuestion[], answers: Answers): boolean {
  return orderQuestions
    .filter(q => q.required && (q.type === "checkbox" || q.type === "radio" || q.type === "select"))
    .every(q => {
      const a = answers[q.id]
      if (q.type === "checkbox") return Array.isArray(a) && a.length > 0
      return typeof a === "string" && a.trim().length > 0
    })
}

// Required attendee-scoped questions must be answered for every attendee.
export function allAttendeeRequiredAnswered(
  ticketTypes: TicketType[],
  quantities: Quantities,
  customQuestions: CustomQuestion[],
  attendeeAnswers: AttendeeAnswers,
): boolean {
  return ticketTypes.every(tt => {
    const qty = quantities[tt.id] ?? 0
    if (qty === 0) return true
    const attQuestions = customQuestions.filter(
      q => isAttendeeScoped(q) && isQuestionApplicable(q, new Set([tt.name])) && q.required
    )
    if (attQuestions.length === 0) return true
    return Array.from({ length: qty }, (_, i) => i).every(i =>
      attQuestions.every(q => {
        const ans = attendeeAnswers[tt.id]?.[i]?.[q.id]
        if (ans === undefined || ans === null) return false
        if (typeof ans === "string") return ans.trim().length > 0
        // Consent statements answer as boolean[] (one box per statement + the
        // final agree). A consent answer is only complete when it has the full
        // statements.length + 1 boxes and every one is ticked — `[true]` on a
        // multi-statement question must NOT pass. Reuse the same
        // isConsentAnswered helper the order-level gate uses. Non-consent array
        // answers (e.g. a multi-select checkbox question) keep "at least one".
        if (Array.isArray(ans)) return q.type === "consent" ? isConsentAnswered(q, ans) : ans.length > 0
        if (typeof ans === "boolean") return ans === true
        return false
      })
    )
  })
}

// Every selected ticket needs a non-empty name before submit is allowed.
export function allNamesFilled(ticketTypes: TicketType[], quantities: Quantities, names: Names): boolean {
  return ticketTypes.every(tt => {
    const qty = quantities[tt.id] ?? 0
    if (qty === 0) return true
    const typeNames = names[tt.id] ?? []
    return typeNames.length === qty && typeNames.every(n => n.trim().length > 0)
  })
}

export type PricingInput = {
  ticketTypes: TicketType[]
  quantities: Quantities
  tieredPricingEnabled: boolean
  familyPricingTiers: number[]
  familyWaiverEnabled: boolean
  passCardFee: boolean
  method: "card" | "bank"
  cardFeePct: number
  cardFeeFixedCents: number
}

export type Pricing = {
  totalAmount: number
  tiered: ReturnType<typeof computeTieredTotal> | null
  overMax: boolean
  showFee: boolean
  feeCents: number
}

// Order total + tiered-schedule lookup + card-surcharge preview. Tiered
// ("family pricing") events look up the total from a per-headcount schedule
// instead of summing ticket prices — mirrors server-side enforcement in the
// registration API (Task 3, CRM-1599).
export function computePricing(input: PricingInput): Pricing {
  const { ticketTypes, quantities, tieredPricingEnabled, familyPricingTiers, familyWaiverEnabled, passCardFee, method, cardFeePct, cardFeeFixedCents } = input

  const attendeeCount = ticketTypes.reduce((s, tt) => s + (quantities[tt.id] ?? 0), 0)
  const tiered = tieredPricingEnabled ? computeTieredTotal(familyPricingTiers, attendeeCount) : null
  const overMax = tiered !== null && !tiered.ok

  const totalAmount = tieredPricingEnabled
    ? (tiered && tiered.ok ? tiered.totalCents / 100 : 0)
    : ticketTypes.reduce((s, tt) => {
        const qty = quantities[tt.id] ?? 0
        return s + tt.price * qty
      }, 0)

  // Display-only card surcharge preview — the real charge is recomputed
  // server-side in checkout. Shown only when the event passes the fee AND the
  // registrant is paying by card (never on the bank-transfer path). Suppressed
  // when the family waiver applies: this client total doesn't subtract the
  // waiver discount, so the fee preview would overstate. The correct
  // fee is still computed and charged server-side at checkout.
  const showFee = passCardFee && method === "card" && totalAmount > 0 && !familyWaiverEnabled
  const feeCents = showFee
    ? grossUpTotal(Math.round(totalAmount * 100), cardFeePct, cardFeeFixedCents).feeCents
    : 0

  return { totalAmount, tiered, overMax, showFee, feeCents }
}
