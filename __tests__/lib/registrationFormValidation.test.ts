import {
  isConsentAnswered,
  allConsentChecked,
  allRequiredChoicesMade,
  allAttendeeRequiredAnswered,
  allNamesFilled,
  computePricing,
} from "@/lib/registrationFormValidation"
import type { CustomQuestion, TicketType } from "@/lib/registrationFormValidation"

const q = (over: Partial<CustomQuestion>): CustomQuestion => ({
  id: "q1", label: "Q", type: "text", required: false, ...over,
})
const tt = (over: Partial<TicketType>): TicketType => ({
  id: 1, name: "Adult", price: 10, capacity: null, ...over,
})

describe("isConsentAnswered", () => {
  it("plain consent needs a single true", () => {
    const c = q({ type: "consent", required: true })
    expect(isConsentAnswered(c, true)).toBe(true)
    expect(isConsentAnswered(c, false)).toBe(false)
    expect(isConsentAnswered(c, undefined)).toBe(false)
  })

  it("statements consent needs every box (N statements + final agree) ticked", () => {
    const c = q({ type: "consent", required: true, statements: ["a", "b"] })
    expect(isConsentAnswered(c, [true, true, true])).toBe(true)
    // /: a lone [true] on a multi-statement question must fail
    expect(isConsentAnswered(c, [true])).toBe(false)
    expect(isConsentAnswered(c, [true, false, true])).toBe(false)
    expect(isConsentAnswered(c, [true, true])).toBe(false) // missing final agree
  })
})

describe("allConsentChecked", () => {
  it("only gates required consent questions", () => {
    const required = q({ id: "c1", type: "consent", required: true })
    const optional = q({ id: "c2", type: "consent", required: false })
    expect(allConsentChecked([required, optional], { c2: false })).toBe(false)
    expect(allConsentChecked([required, optional], { c1: true })).toBe(true)
    expect(allConsentChecked([optional], {})).toBe(true)
  })
})

describe("allRequiredChoicesMade", () => {
  it("checkbox needs at least one selection", () => {
    const cb = q({ id: "cb", type: "checkbox", required: true })
    expect(allRequiredChoicesMade([cb], { cb: [] })).toBe(false)
    expect(allRequiredChoicesMade([cb], { cb: ["x"] })).toBe(true)
  })

  it("radio/select need a non-empty string — blocks the empty 'Other' write-in", () => {
    const r = q({ id: "r", type: "radio", required: true })
    expect(allRequiredChoicesMade([r], { r: "" })).toBe(false)
    expect(allRequiredChoicesMade([r], { r: "  " })).toBe(false)
    expect(allRequiredChoicesMade([r], { r: "yes" })).toBe(true)
  })

  it("ignores non-choice and optional questions", () => {
    const text = q({ id: "t", type: "text", required: true })
    const optSelect = q({ id: "s", type: "select", required: false })
    expect(allRequiredChoicesMade([text, optSelect], {})).toBe(true)
  })
})

describe("allAttendeeRequiredAnswered", () => {
  const adult = tt({ id: 1, name: "Adult" })

  it("passes when a ticket type has no selected quantity", () => {
    const aq = q({ id: "aq", type: "text", required: true, scope: "attendee" })
    expect(allAttendeeRequiredAnswered([adult], { 1: 0 }, [aq], {})).toBe(true)
  })

  it("requires every attendee to answer a required attendee-scoped question", () => {
    const aq = q({ id: "aq", type: "text", required: true, scope: "attendee" })
    expect(allAttendeeRequiredAnswered([adult], { 1: 2 }, [aq], { 1: [{ aq: "x" }] })).toBe(false)
    expect(allAttendeeRequiredAnswered([adult], { 1: 2 }, [aq], { 1: [{ aq: "x" }, { aq: "y" }] })).toBe(true)
  })

  it("a multi-statement consent needs all boxes per attendee ([true] fails)", () => {
    const c = q({ id: "c", type: "consent", required: true, scope: "attendee", statements: ["a", "b"] })
    expect(allAttendeeRequiredAnswered([adult], { 1: 1 }, [c], { 1: [{ c: [true] }] })).toBe(false)
    expect(allAttendeeRequiredAnswered([adult], { 1: 1 }, [c], { 1: [{ c: [true, true, true] }] })).toBe(true)
  })
})

describe("allNamesFilled", () => {
  const adult = tt({ id: 1, name: "Adult" })
  it("every selected seat needs a non-blank name", () => {
    expect(allNamesFilled([adult], { 1: 2 }, { 1: ["A"] })).toBe(false)
    expect(allNamesFilled([adult], { 1: 2 }, { 1: ["A", " "] })).toBe(false)
    expect(allNamesFilled([adult], { 1: 2 }, { 1: ["A", "B"] })).toBe(true)
    expect(allNamesFilled([adult], { 1: 0 }, {})).toBe(true)
  })
})

describe("computePricing", () => {
  const adult = tt({ id: 1, name: "Adult", price: 20 })
  const base = {
    ticketTypes: [adult], quantities: { 1: 2 },
    tieredPricingEnabled: false, familyPricingTiers: [], familyWaiverEnabled: false,
    passCardFee: false, method: "bank" as const, cardFeePct: 1.7, cardFeeFixedCents: 30,
  }

  it("sums ticket price × qty by default", () => {
    expect(computePricing(base).totalAmount).toBe(40)
  })

  it("tiered pricing looks up the per-headcount schedule and flags over-max", () => {
    const tiered = computePricing({ ...base, tieredPricingEnabled: true, familyPricingTiers: [10, 15], quantities: { 1: 2 } })
    expect(tiered.totalAmount).toBe(15)
    expect(tiered.overMax).toBe(false)
    const over = computePricing({ ...base, tieredPricingEnabled: true, familyPricingTiers: [10, 15], quantities: { 1: 3 } })
    expect(over.overMax).toBe(true)
    expect(over.totalAmount).toBe(0)
  })

  it("shows the card fee only when passing the fee AND paying by card", () => {
    expect(computePricing({ ...base, passCardFee: true, method: "card" }).showFee).toBe(true)
    expect(computePricing({ ...base, passCardFee: true, method: "bank" }).showFee).toBe(false)
    expect(computePricing({ ...base, passCardFee: false, method: "card" }).showFee).toBe(false)
  })

  it("suppresses the fee preview when the family waiver applies", () => {
    const p = computePricing({ ...base, passCardFee: true, method: "card", familyWaiverEnabled: true })
    expect(p.showFee).toBe(false)
    expect(p.feeCents).toBe(0)
  })
})
