/** @jest-environment node */
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))

import { buildClearanceCard, clearanceSelectFor } from "@/lib/clearanceView"
import { DEFAULT_WWCC_VERIFY_URL } from "@/lib/clearanceSettings"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))

const TODAY = new Date("2026-10-06T00:00:00.000Z")
const wwcc = {
  id: "ckclearance000000000000001",
  type: "WWCC" as const,
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  number: "enc:WWC0000000E",
  expiresAt: new Date("2029-03-15T00:00:00.000Z"),
  documentName: "enc:wwcc.pdf",
  documentType: "application/pdf",
  verifiedAt: new Date("2026-09-01T03:00:00.000Z"),
  verificationNote: "enc:checked on portal",
  verifiedBy: { name: "Test Admin" },
}
const base = { personId: 3, today: TODAY, wwccVerifyUrl: DEFAULT_WWCC_VERIFY_URL, ministryRoleCount: 1 }

describe("clearanceSelectFor", () => {
  it("VIEWER query selects only status columns (no number/note/document name/verifier)", () => {
    expect(clearanceSelectFor("VIEWER")).toEqual({ id: true, type: true, expiresAt: true, verifiedAt: true })
  })
  it("managers also select the detail columns, never the document blob", () => {
    const sel = clearanceSelectFor("ADMIN") as Record<string, unknown>
    expect(sel).toMatchObject({ number: true, documentName: true, verificationNote: true, updatedAt: true })
    expect(sel.document).toBeUndefined()
  })
})

describe("buildClearanceCard", () => {
  it("returns null for roles that cannot view status (AUDITOR, EVENT_ORGANISER, none)", () => {
    for (const role of ["AUDITOR", "EVENT_ORGANISER", undefined] as const) {
      expect(buildClearanceCard({ ...base, role, rows: [wwcc] })).toBeNull()
    }
  })

  it("manager gets full detail for both types, decrypted, with the portal URL", () => {
    const card = buildClearanceCard({ ...base, role: "OFFICE_ADMIN", rows: [wwcc] })!
    expect(card.canManage).toBe(true)
    expect(card.wwccVerifyUrl).toBe(DEFAULT_WWCC_VERIFY_URL)
    expect(card.rows.map((r) => r.type)).toEqual(["WWCC", "SAFE_MINISTRY"])
    expect(card.rows[0]).toMatchObject({
      clearanceId: wwcc.id,
      updatedAt: "2026-10-01T00:00:00.000Z",
      status: "VERIFIED",
      number: "WWC0000000E",
      expiresYmd: "2029-03-15",
      documentName: "wwcc.pdf",
      hasDocument: true,
      verifiedByName: "Test Admin",
      verificationNote: "checked on portal",
    })
    expect(card.rows[1]).toMatchObject({ type: "SAFE_MINISTRY", status: "MISSING" })
  })

  it("VIEWER gets the status badge ONLY — no number, doc, id, note, verifier or URL", () => {
    const card = buildClearanceCard({ ...base, role: "VIEWER", rows: [wwcc] })!
    expect(card.canManage).toBe(false)
    expect(card.wwccVerifyUrl).toBeNull()
    expect(card.rows).toEqual([
      { type: "WWCC", status: "VERIFIED" },
      { type: "SAFE_MINISTRY", status: "MISSING" },
    ])
    const json = JSON.stringify(card)
    for (const secret of ["WWC0000000E", wwcc.id, "wwcc.pdf", "Test Admin", "checked on portal"]) {
      expect(json).not.toContain(secret)
    }
  })

  it("VIEWER sees no card when the person has no ministry roles and no clearances", () => {
    expect(buildClearanceCard({ ...base, role: "VIEWER", rows: [], ministryRoleCount: 0 })).toBeNull()
  })
  it("VIEWER sees the card if a clearance exists even with no ministry roles", () => {
    expect(buildClearanceCard({ ...base, role: "VIEWER", rows: [wwcc], ministryRoleCount: 0 })).not.toBeNull()
  })
  it("managers always get the card (so they can add the first clearance)", () => {
    expect(buildClearanceCard({ ...base, role: "ADMIN", rows: [], ministryRoleCount: 0 })).not.toBeNull()
  })

  it("computes EXPIRED / UNVERIFIED from dates", () => {
    const expired = { ...wwcc, expiresAt: new Date("2026-10-01T00:00:00.000Z") }
    const unverified = { ...wwcc, type: "SAFE_MINISTRY" as const, verifiedAt: null, verifiedBy: null, verificationNote: null }
    const card = buildClearanceCard({ ...base, role: "ADMIN", rows: [expired, unverified] })!
    expect(card.rows[0].status).toBe("EXPIRED")
    expect(card.rows[1].status).toBe("UNVERIFIED")
    expect(card.rows[1].verifiedByName).toBeNull()
  })
})
