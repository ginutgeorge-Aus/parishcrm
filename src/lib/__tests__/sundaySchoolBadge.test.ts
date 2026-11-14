/** @jest-environment node */
import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { signBadge, verifyBadge } from "@/lib/sundaySchoolBadge"

describe("sundaySchoolBadge", () => {
  it("round-trips a person id", () => {
    const text = signBadge(42)
    expect(text).toMatch(/^ss1\.42\.[A-Za-z0-9_-]{22}$/)
    expect(verifyBadge(text)).toBe(42)
    expect(verifyBadge(`  ${text}\n`)).toBe(42)
  })
  it("is deterministic and differs per person", () => {
    expect(signBadge(7)).toBe(signBadge(7))
    expect(signBadge(7).split(".")[2]).not.toBe(signBadge(8).split(".")[2])
  })
  it("rejects a tampered signature or swapped id", () => {
    const [p, id, sig] = signBadge(5).split(".")
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1)
    expect(verifyBadge(`${p}.${id}.${flipped}`)).toBeNull()
    expect(verifyBadge(`${p}.6.${sig}`)).toBeNull()
  })
  it("rejects wrong prefix, non-numeric/odd ids and bad lengths", () => {
    const sig = signBadge(5).split(".")[2]
    for (const bad of [`ss2.5.${sig}`, `REG-5.${sig}`, `ss1.abc.${sig}`, `ss1.05.${sig}`, `ss1.-5.${sig}`, `ss1.5.${sig}x`, `ss1.5.${sig.slice(1)}`, "ss1.5", "", `ss1.99999999999.${sig}`, `ss1.5.${sig}.extra`]) {
      expect(verifyBadge(bad)).toBeNull()
    }
    expect(verifyBadge(undefined as unknown as string)).toBeNull()
  })
  it("rejects a signature made with a different key", () => {
    const other = createHmac("sha256", Buffer.alloc(32, 1)).update("ss-badge:5").digest().subarray(0, 16).toString("base64url")
    expect(verifyBadge(`ss1.5.${other}`)).toBeNull()
  })
  it("rejects a signature made with the raw encryption key (no domain separation)", () => {
    const raw = createHmac("sha256", Buffer.from(process.env.ENCRYPTION_KEY!, "base64")).update("ss-badge:5").digest().subarray(0, 16).toString("base64url")
    expect(verifyBadge(`ss1.5.${raw}`)).toBeNull()
  })
  it("refuses to sign an invalid id", () => {
    expect(() => signBadge(0)).toThrow()
    expect(() => signBadge(1.5)).toThrow()
  })
  it("compares in constant time", () => {
    const src = readFileSync(require.resolve("@/lib/sundaySchoolBadge"), "utf8")
    expect(src).toContain("timingSafeEqual")
    expect(src).not.toMatch(/===\s*want|want\s*===/)
  })
})
