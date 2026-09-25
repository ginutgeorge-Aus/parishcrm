jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { toAnswerMap } from "@/lib/eventAnswers"

describe("toAnswerMap", () => {
  it("decrypts + parses an encrypted JSON-string blob", () => {
    // safeDecrypt strips the enc: prefix, leaving the JSON string.
    const enc = `enc:${JSON.stringify({ q1: "Vegan", q2: ["A", "B"] })}`
    expect(toAnswerMap(enc)).toEqual({ q1: "Vegan", q2: ["A", "B"] })
  })

  it("passes through a legacy plaintext object unchanged", () => {
    expect(toAnswerMap({ q1: "None" })).toEqual({ q1: "None" })
  })

  it("coerces non-string scalars and array members to strings", () => {
    expect(toAnswerMap({ n: 5, arr: [1, 2] })).toEqual({ n: "5", arr: ["1", "2"] })
  })

  it("returns null for null, arrays, and undecryptable strings", () => {
    expect(toAnswerMap(null)).toBeNull()
    expect(toAnswerMap([1, 2])).toBeNull()
    expect(toAnswerMap("enc:not-json{")).toBeNull()
  })
})
