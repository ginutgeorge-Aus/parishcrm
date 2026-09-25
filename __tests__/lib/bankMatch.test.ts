import { wordBoundaryMatch } from "@/lib/bankMatch"

describe("wordBoundaryMatch", () => {
  // --- positive: normal mid-string match with spaces on both sides ---
  it("matches needle surrounded by non-alpha chars", () => {
    expect(wordBoundaryMatch("PAYMENT FROM JON SMITH", "JON SMITH")).toBe(true)
  })

  // --- positive: match at start of string ---
  it("matches needle at start of string", () => {
    expect(wordBoundaryMatch("JON SMITH PAID", "JON SMITH")).toBe(true)
  })

  // --- positive: match at end of string ---
  it("matches needle at end of string", () => {
    expect(wordBoundaryMatch("RECEIPT JON SMITH", "JON SMITH")).toBe(true)
  })

  // --- positive: exact string match ---
  it("matches when needle equals haystack", () => {
    expect(wordBoundaryMatch("JON SMITH", "JON SMITH")).toBe(true)
  })

  // --- trailing-boundary reject (pre-existing behaviour) ---
  it("rejects when needle is a prefix of a longer word (trailing letter)", () => {
    expect(wordBoundaryMatch("SMITHSON 60.00", "SMITH")).toBe(false)
  })

  // --- NEW: leading-boundary reject (the bug fixed in) ---
  it("rejects when needle is preceded immediately by an uppercase letter", () => {
    expect(wordBoundaryMatch("BENJON SMITH 60.00", "JON SMITH")).toBe(false)
  })

  // --- leading-boundary reject: embedded in longer word ---
  it("rejects needle embedded inside a single word", () => {
    expect(wordBoundaryMatch("ABCJONSMITHABC", "JON")).toBe(false)
  })

  // --- case-insensitive: needle in mixed case ---
  it("matches case-insensitively when needle is lower-case", () => {
    expect(wordBoundaryMatch("PAYMENT FROM JON SMITH", "jon smith")).toBe(true)
  })

  // --- not found ---
  it("returns false when needle is not present at all", () => {
    expect(wordBoundaryMatch("PAYMENT FROM ALICE", "JON SMITH")).toBe(false)
  })

  // --- digit boundary is acceptable (not an uppercase letter) ---
  it("matches when needle is followed by a digit", () => {
    expect(wordBoundaryMatch("JON SMITH60.00", "JON SMITH")).toBe(true)
  })

  // --- NEW: a later occurrence at a word boundary still matches even
  // when an earlier occurrence is embedded mid-word ---
  it("matches a boundary occurrence that follows an embedded one", () => {
    expect(wordBoundaryMatch("BENJON PAYMENT JON SMITH", "JON")).toBe(true)
  })

  it("still rejects when every occurrence is embedded mid-word", () => {
    expect(wordBoundaryMatch("BENJON ENJONX", "JON")).toBe(false)
  })

  it("returns false for an empty needle", () => {
    expect(wordBoundaryMatch("JON SMITH", "")).toBe(false)
  })

  // --- NEW: a non-ASCII uppercase letter is a word char, not a boundary ---
  it("rejects when needle is preceded by an accented uppercase letter", () => {
    expect(wordBoundaryMatch("ÉSMITH 60.00", "SMITH")).toBe(false)
  })
})
