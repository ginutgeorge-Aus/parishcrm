/** @jest-environment node */
import { readReviewNote } from "@/lib/reviewNote"

jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

describe("readReviewNote", () => {
  it("decrypts a stored note", () => {
    expect(readReviewNote("enc:Needs more detail")).toBe("Needs more detail")
  })
  it("returns null when there is no note", () => {
    expect(readReviewNote(null)).toBeNull()
    expect(readReviewNote(undefined)).toBeNull()
    expect(readReviewNote("")).toBeNull()
  })
})
