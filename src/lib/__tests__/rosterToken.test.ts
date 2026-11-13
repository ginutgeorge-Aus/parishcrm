/** @jest-environment node */
import { createHmac } from "node:crypto"
import { issueRosterToken, verifyRosterToken } from "@/lib/rosterToken"

const SECRET = "test-secret-1"
const NOW = 1_700_000_000_000
const TTL = 60_000

const resign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("base64url")

describe("rosterToken", () => {
  it("roundtrips a valid token", () => {
    const t = issueRosterToken("asg_1", "confirm", SECRET, NOW, TTL)
    expect(verifyRosterToken(t, SECRET, NOW + 1)).toEqual({
      assignmentId: "asg_1",
      action: "confirm",
      expiresAt: NOW + TTL,
    })
  })

  it("rejects an expired token (at and after expiry)", () => {
    const t = issueRosterToken("asg_1", "decline", SECRET, NOW, TTL)
    expect(verifyRosterToken(t, SECRET, NOW + TTL - 1)).not.toBeNull()
    expect(verifyRosterToken(t, SECRET, NOW + TTL)).toBeNull()
    expect(verifyRosterToken(t, SECRET, NOW + TTL + 1)).toBeNull()
  })

  it("fails closed when nowMs is NaN or Infinity", () => {
    const t = issueRosterToken("asg_1", "confirm", SECRET, NOW, TTL)
    expect(verifyRosterToken(t, SECRET, NaN)).toBeNull()
    expect(verifyRosterToken(t, SECRET, Infinity)).toBeNull()
    expect(verifyRosterToken(t, SECRET, -Infinity)).toBeNull()
  })

  it("rejects a tampered payload (action flipped, signature kept)", () => {
    const t = issueRosterToken("asg_1", "confirm", SECRET, NOW, TTL)
    const [body, sig] = t.split(".")
    const obj = JSON.parse(Buffer.from(body, "base64url").toString())
    obj.c = "decline"
    const forged = Buffer.from(JSON.stringify(obj)).toString("base64url")
    expect(verifyRosterToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull()
  })

  it("rejects a tampered signature", () => {
    const t = issueRosterToken("asg_1", "confirm", SECRET, NOW, TTL)
    const last = t.slice(-1)
    const bad = t.slice(0, -1) + (last === "A" ? "B" : "A")
    expect(verifyRosterToken(bad, SECRET, NOW)).toBeNull()
    expect(verifyRosterToken(t.split(".")[0] + ".", SECRET, NOW)).toBeNull()
  })

  it("rejects the wrong secret and an empty secret", () => {
    const t = issueRosterToken("asg_1", "confirm", SECRET, NOW, TTL)
    expect(verifyRosterToken(t, "other-secret", NOW)).toBeNull()
    expect(verifyRosterToken(t, "", NOW)).toBeNull()
  })

  it("refuses to issue with an empty secret", () => {
    expect(() => issueRosterToken("asg_1", "confirm", "", NOW, TTL)).toThrow()
  })

  it.each([undefined, null, 42, {}, "", "abc", "a.b.c", ".", "a.", ".b", "x".repeat(600)])(
    "rejects malformed input %p",
    (input) => {
      expect(verifyRosterToken(input, SECRET, NOW)).toBeNull()
    },
  )

  it("rejects validly-signed but malformed or wrong-purpose payloads", () => {
    const enc = (o: unknown) =>
      Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url")
    const cases = [
      enc("not json"),
      enc("null"),
      enc({ p: "other:v1", a: "x", c: "confirm", e: NOW + TTL }),
      enc({ p: "roster:v1", a: "", c: "confirm", e: NOW + TTL }),
      enc({ p: "roster:v1", a: "x", c: "maybe", e: NOW + TTL }),
      enc({ p: "roster:v1", a: "x", c: "confirm", e: "soon" }),
    ]
    for (const body of cases) {
      expect(verifyRosterToken(`${body}.${resign(body)}`, SECRET, NOW)).toBeNull()
    }
  })
})
