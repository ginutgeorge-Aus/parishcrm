import { isAttendeeScoped, validateAnswer, type CustomQuestion } from "@/lib/eventQuestions"

function q(overrides: Partial<CustomQuestion> = {}): CustomQuestion {
  return { id: "q0", label: "Q", required: false, type: "text", ...overrides }
}

describe("isAttendeeScoped", () => {
  it("is false when scope absent (back-compat)", () => {
    expect(isAttendeeScoped(q())).toBe(false)
  })
  it("is false for order scope", () => {
    expect(isAttendeeScoped(q({ scope: "order" }))).toBe(false)
  })
  it("is true for attendee scope", () => {
    expect(isAttendeeScoped(q({ scope: "attendee" }))).toBe(true)
  })
})

describe("validateAnswer — allowOther", () => {
  const OPTS = ["Parent"]

  it("select without allowOther rejects a non-option", () => {
    const r = validateAnswer(q({ type: "select", options: OPTS }), "Grandma")
    expect(r.ok).toBe(false)
  })

  it("select with allowOther accepts a write-in string", () => {
    const r = validateAnswer(q({ type: "select", options: OPTS, allowOther: true }), "Grandma")
    expect(r).toEqual({ ok: true, value: "Grandma" })
  })

  it("select with allowOther still accepts a predefined option", () => {
    const r = validateAnswer(q({ type: "select", options: OPTS, allowOther: true }), "Parent")
    expect(r).toEqual({ ok: true, value: "Parent" })
  })

  it("radio with allowOther accepts a write-in string", () => {
    const r = validateAnswer(q({ type: "radio", options: OPTS, allowOther: true }), "Uncle Joe")
    expect(r).toEqual({ ok: true, value: "Uncle Joe" })
  })

  it("checkbox with allowOther accepts predefined + one write-in", () => {
    const r = validateAnswer(q({ type: "checkbox", options: ["Not Applicable"], allowOther: true }), ["Peanuts"])
    expect(r).toEqual({ ok: true, value: ["Peanuts"] })
  })

  it("checkbox with allowOther rejects two write-ins", () => {
    const r = validateAnswer(q({ type: "checkbox", options: ["Not Applicable"], allowOther: true }), ["Peanuts", "Dairy"])
    expect(r.ok).toBe(false)
  })

  it("checkbox without allowOther rejects any unknown element", () => {
    const r = validateAnswer(q({ type: "checkbox", options: ["Not Applicable"] }), ["Peanuts"])
    expect(r.ok).toBe(false)
  })

  it("checkbox with allowOther rejects a blank/whitespace-only write-in", () => {
    const r = validateAnswer(q({ type: "checkbox", options: ["Not Applicable"], allowOther: true }), ["  "])
    expect(r.ok).toBe(false)
  })

  it("required select with allowOther but empty answer fails as required", () => {
    const r = validateAnswer(q({ type: "select", options: OPTS, allowOther: true, required: true }), "")
    expect(r).toEqual({ ok: false, error: "Answer required: Q" })
  })
})
