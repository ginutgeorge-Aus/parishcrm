import type { Session } from "next-auth"
import { actorId } from "@/lib/actor"

function sess(id: unknown): Session {
  return { user: { id, role: "ADMIN" }, expires: "" } as unknown as Session
}

describe("actorId", () => {
  it("parses a valid numeric id string", () => {
    expect(actorId(sess("42"))).toBe(42)
  })

  it("throws on null session", () => {
    expect(() => actorId(null)).toThrow(/valid user id/)
  })

  it("throws when id is absent", () => {
    expect(() => actorId(sess(undefined))).toThrow(/valid user id/)
  })

  it("throws when id is non-numeric", () => {
    expect(() => actorId(sess("abc"))).toThrow(/valid user id/)
  })

  it("throws when id is zero or negative", () => {
    expect(() => actorId(sess("0"))).toThrow(/valid user id/)
    expect(() => actorId(sess("-3"))).toThrow(/valid user id/)
  })
})
