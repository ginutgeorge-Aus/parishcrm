/** @jest-environment node */
import { isP2002, isP2034 } from "@/lib/validation"

describe("isP2034", () => {
  it("matches a Prisma P2034 error", () => {
    expect(isP2034(Object.assign(new Error("x"), { code: "P2034" }))).toBe(true)
  })
  it("matches a raw driver-adapter serialization conflict (no P2034 code)", () => {
    // Shape observed from @prisma/adapter-pg when Postgres aborts a Serializable
    // txn with 40001 — Prisma surfaces it unwrapped, without `code`.
    const e = Object.assign(new Error("TransactionWriteConflict"), {
      name: "DriverAdapterError",
      cause: { originalCode: "40001", kind: "TransactionWriteConflict" },
    })
    expect(isP2034(e)).toBe(true)
  })
  it("rejects other errors", () => {
    expect(isP2034(Object.assign(new Error("x"), { code: "P2002" }))).toBe(false)
    expect(isP2034({ cause: { kind: "UniqueConstraintViolation" } })).toBe(false)
    expect(isP2034(null)).toBe(false)
    expect(isP2034("P2034")).toBe(false)
  })
})

describe("isP2002", () => {
  it("matches a Prisma P2002 error", () => {
    expect(isP2002(Object.assign(new Error("x"), { code: "P2002" }))).toBe(true)
  })
  it("matches a raw driver-adapter unique violation (no P2002 code)", () => {
    const e = Object.assign(new Error("UniqueConstraintViolation"), {
      name: "DriverAdapterError",
      cause: { originalCode: "23505", kind: "UniqueConstraintViolation" },
    })
    expect(isP2002(e)).toBe(true)
  })
  it("rejects other errors", () => {
    expect(isP2002(Object.assign(new Error("x"), { code: "P2034" }))).toBe(false)
    expect(isP2002({ cause: { kind: "TransactionWriteConflict" } })).toBe(false)
    expect(isP2002(null)).toBe(false)
  })
})
