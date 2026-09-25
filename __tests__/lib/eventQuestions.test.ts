import { validateAnswer, formatAnswerForCsv, CUSTOM_QUESTION_TYPES, QUESTION_PRESETS, isQuestionApplicable, parseCustomQuestions } from "@/lib/eventQuestions"
import type { CustomQuestion } from "@/lib/eventQuestions"

const q = (o: Partial<CustomQuestion>): CustomQuestion =>
  ({ id: "q0", label: "Q", required: false, type: "text", ...o })

describe("CUSTOM_QUESTION_TYPES", () => {
  it("includes the full type set", () => {
    expect(CUSTOM_QUESTION_TYPES).toEqual(
      expect.arrayContaining(["text","textarea","number","date","phone","email","select","radio","checkbox","consent"])
    )
  })
})

describe("validateAnswer", () => {
  it("required text missing -> error", () => {
    expect(validateAnswer(q({ required: true }), undefined)).toEqual({ ok: false, error: "Answer required: Q" })
  })
  it("optional missing -> ok undefined", () => {
    expect(validateAnswer(q({}), undefined)).toEqual({ ok: true, value: undefined })
  })
  it("select value must be in options", () => {
    const sel = q({ type: "select", options: ["A","B"] })
    expect(validateAnswer(sel, "C")).toEqual({ ok: false, error: "Invalid option: Q" })
    expect(validateAnswer(sel, "A")).toEqual({ ok: true, value: "A" })
  })
  it("checkbox values must all be in options; returns the array", () => {
    const cb = q({ type: "checkbox", options: ["A","B","C"] })
    expect(validateAnswer(cb, ["A","X"])).toEqual({ ok: false, error: "Invalid option: Q" })
    expect(validateAnswer(cb, ["A","C"])).toEqual({ ok: true, value: ["A","C"] })
  })
  it("number rejects non-numeric", () => {
    expect(validateAnswer(q({ type: "number" }), "x").ok).toBe(false)
    expect(validateAnswer(q({ type: "number" }), "42")).toEqual({ ok: true, value: "42" })
  })
  it("number rejects an over-long numeric string despite being finite", () => {
    // A long run of zeroes is `Number.isFinite` regardless of string length —
    // must still be capped like every other free-text answer.
    const huge = "0".repeat(2001)
    expect(validateAnswer(q({ type: "number" }), huge)).toEqual({ ok: false, error: "Answer too long: Q" })
  })
  it("number accepts a numeric string at the length limit", () => {
    const atLimit = "0".repeat(1999) + "1"
    expect(atLimit.length).toBe(2000)
    expect(validateAnswer(q({ type: "number" }), atLimit)).toEqual({ ok: true, value: atLimit })
  })
  it("date rejects garbage", () => {
    expect(validateAnswer(q({ type: "date" }), "nope").ok).toBe(false)
    expect(validateAnswer(q({ type: "date" }), "2026-07-01")).toEqual({ ok: true, value: "2026-07-01" })
  })
  it("date rejects a calendar-invalid date that Date.parse silently rolls over", () => {
    // Feb 30 doesn't exist — Date.parse normalizes it to Mar 2 instead of failing.
    expect(validateAnswer(q({ type: "date" }), "2014-02-30").ok).toBe(false)
  })
  it("date rejects a non-ISO format even though Date.parse would accept it", () => {
    expect(validateAnswer(q({ type: "date" }), "02/30/2014").ok).toBe(false)
  })
  it("email rejects malformed", () => {
    expect(validateAnswer(q({ type: "email" }), "bad").ok).toBe(false)
    expect(validateAnswer(q({ type: "email" }), "a@b.com")).toEqual({ ok: true, value: "a@b.com" })
  })
  it("email rejects an over-long local-part despite matching EMAIL_RE", () => {
    const huge = `${"x".repeat(2001)}@a.com`
    expect(validateAnswer(q({ type: "email" }), huge)).toEqual({ ok: false, error: "Answer too long: Q" })
  })
  it("email accepts an answer at the length limit", () => {
    const atLimit = `${"x".repeat(1994)}@a.com`
    expect(atLimit.length).toBe(2000)
    expect(validateAnswer(q({ type: "email" }), atLimit)).toEqual({ ok: true, value: atLimit })
  })
  it("rejects over-long open-ended answers", () => {
    const long = "x".repeat(2001)
    expect(validateAnswer(q({ type: "text" }), long)).toEqual({ ok: false, error: "Answer too long: Q" })
    expect(validateAnswer(q({ type: "textarea" }), long)).toEqual({ ok: false, error: "Answer too long: Q" })
    expect(validateAnswer(q({ type: "phone" }), long)).toEqual({ ok: false, error: "Answer too long: Q" })
  })
  it("accepts answers at the length limit", () => {
    const max = "x".repeat(2000)
    expect(validateAnswer(q({ type: "text" }), max)).toEqual({ ok: true, value: max })
  })
  it("required consent must be true, stamps timestamp", () => {
    const c = q({ type: "consent", required: true })
    expect(validateAnswer(c, false)).toEqual({ ok: false, error: "Answer required: Q" })
    const r = validateAnswer(c, true, () => new Date("2026-06-27T00:00:00.000Z"))
    expect(r).toEqual({ ok: true, value: "2026-06-27T00:00:00.000Z" })
  })
})

describe("formatAnswerForCsv", () => {
  it("joins arrays with semicolons", () => {
    expect(formatAnswerForCsv(["A","B"])).toBe("A; B")
  })
  it("renders consent timestamp as Yes (date)", () => {
    expect(formatAnswerForCsv("2026-06-27T00:00:00.000Z", "consent")).toBe("Yes (27/06/2026)")
  })
  it("empty for null", () => {
    expect(formatAnswerForCsv(null)).toBe("")
  })
})

describe("QUESTION_PRESETS", () => {
  it("offers dietary/accessibility/emergency/tshirt", () => {
    expect(QUESTION_PRESETS.map(p => p.label)).toEqual(
      expect.arrayContaining(["Dietary requirements","Accessibility needs","Emergency contact","T-shirt size"])
    )
  })
})

function fd(pairs: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(pairs)) f.append(k, v)
  return f
}

describe("parseCustomQuestions — stable ids", () => {
  it("uses the client-submitted id, not a position-derived one", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.id": "dietary-abc123",
      "customQuestion.0.label": "Dietary",
      "customQuestion.0.type": "text",
    }))
    expect(qs![0].id).toBe("dietary-abc123")
  })

  it("keeps a later question's id stable when an earlier row is omitted (simulating a delete)", () => {
    // Row 0 (Dietary) deleted client-side; Emergency contact now submits at
    // index 0 but keeps its OWN id, not "q0".
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.id": "emergency-xyz",
      "customQuestion.0.label": "Emergency contact",
      "customQuestion.0.type": "text",
    }))
    expect(qs![0].id).toBe("emergency-xyz")
    expect(qs![0].id).not.toBe("q0")
  })

  it("falls back to a generated id when none is submitted", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Dietary",
      "customQuestion.0.type": "text",
    }))
    expect(qs![0].id).toBeTruthy()
  })

  it("falls back to a generated id when a duplicate id is submitted across rows", () => {
    const f = fd({
      "customQuestion.0.id": "dup",
      "customQuestion.0.label": "First",
      "customQuestion.0.type": "text",
    })
    f.append("customQuestion.1.id", "dup")
    f.append("customQuestion.1.label", "Second")
    f.append("customQuestion.1.type", "text")
    const qs = parseCustomQuestions(f)
    expect(qs![0].id).toBe("dup")
    expect(qs![1].id).not.toBe("dup")
    expect(qs![0].id).not.toBe(qs![1].id)
  })
})

describe("consent statements", () => {
  it("parses newline-separated statements onto a consent question", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Event consent",
      "customQuestion.0.type": "consent",
      "customQuestion.0.required": "true",
      "customQuestion.0.body": "Please agree:",
      "customQuestion.0.statements": "Photo consent\nLiability waiver\n\n  Privacy  ",
    }))
    expect(qs).not.toBeNull()
    expect(qs![0].statements).toEqual(["Photo consent", "Liability waiver", "Privacy"])
    expect(qs![0].body).toBe("Please agree:")
  })

  it("ignores statements on a non-consent question", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Name",
      "customQuestion.0.type": "text",
      "customQuestion.0.required": "false",
      "customQuestion.0.statements": "a\nb",
    }))
    expect(qs![0].statements).toBeUndefined()
  })

  it("caps statements at 10 and 500 chars each", () => {
    const many = Array.from({ length: 15 }, (_, i) => `s${i}`).join("\n")
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "C",
      "customQuestion.0.type": "consent",
      "customQuestion.0.required": "true",
      "customQuestion.0.statements": many + "\n" + "x".repeat(600),
    }))
    expect(qs![0].statements!.length).toBe(10)
    expect(qs![0].statements!.every(s => s.length <= 500)).toBe(true)
  })

  const now = () => new Date("2026-07-31T00:00:00.000Z")
  const q: CustomQuestion = { id: "q0", label: "Consent", type: "consent", required: true, statements: ["a", "b"] }
  // `options` had no cap on count or per-item length, unlike the
  // `statements` field just above — an admin-supplied comma-separated list
  // could otherwise grow Event.customQuestions JSON without limit.
  it("parses comma-separated options for a select question", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Size",
      "customQuestion.0.type": "select",
      "customQuestion.0.required": "false",
      "customQuestion.0.options": "S, M, L",
    }))
    expect(qs![0].options).toEqual(["S", "M", "L"])
  })

  it("caps options at 50 entries and 200 chars each", () => {
    const many = Array.from({ length: 60 }, (_, i) => `opt${i}`).join(",")
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Big list",
      "customQuestion.0.type": "select",
      "customQuestion.0.required": "false",
      "customQuestion.0.options": many + "," + "x".repeat(300),
    }))
    expect(qs![0].options!.length).toBe(50)
    expect(qs![0].options!.every(o => o.length <= 200)).toBe(true)
  })

  it("stamps one ISO timestamp when every statement + final box is true", () => {
    const r = validateAnswer(q, [true, true, true], now)
    expect(r).toEqual({ ok: true, value: "2026-07-31T00:00:00.000Z" })
  })

  it("rejects a required statements-consent when not every box is true", () => {
    const r = validateAnswer(q, [true, false, true], now)
    expect(r.ok).toBe(false)
  })

  it("rejects a wrong-length array", () => {
    const r = validateAnswer(q, [true, true], now)
    expect(r.ok).toBe(false)
  })

  it("passes an untouched optional statements-consent", () => {
    const opt: CustomQuestion = { ...q, required: false }
    expect(validateAnswer(opt, undefined, now)).toEqual({ ok: true, value: undefined })
  })

  it("still stamps a single-box consent (no regression)", () => {
    const single: CustomQuestion = { id: "q1", label: "C", type: "consent", required: true }
    expect(validateAnswer(single, true, now)).toEqual({ ok: true, value: "2026-07-31T00:00:00.000Z" })
  })
})

describe("isQuestionApplicable", () => {
  const q = (over: Partial<CustomQuestion> = {}): CustomQuestion => ({
    id: "q0", label: "L", required: false, type: "text", ...over,
  })
  it("applies to all when ticketTypeNames is absent", () => {
    expect(isQuestionApplicable(q(), [])).toBe(true)
    expect(isQuestionApplicable(q(), ["Adult"])).toBe(true)
  })
  it("applies to all when ticketTypeNames is empty", () => {
    expect(isQuestionApplicable(q({ ticketTypeNames: [] }), ["Adult"])).toBe(true)
  })
  it("applies only when a selected name matches", () => {
    expect(isQuestionApplicable(q({ ticketTypeNames: ["Child"] }), ["Child"])).toBe(true)
    expect(isQuestionApplicable(q({ ticketTypeNames: ["Child"] }), ["Adult"])).toBe(false)
    expect(isQuestionApplicable(q({ ticketTypeNames: ["Child"] }), [])).toBe(false)
  })
  it("matches when any of multiple targets is selected", () => {
    expect(isQuestionApplicable(q({ ticketTypeNames: ["Child", "Student"] }), ["Adult", "Student"])).toBe(true)
  })
  it("is exact (case-sensitive) name match", () => {
    expect(isQuestionApplicable(q({ ticketTypeNames: ["Child"] }), ["child"])).toBe(false)
  })
})
