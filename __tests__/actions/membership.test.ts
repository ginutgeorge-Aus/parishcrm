/** @jest-environment node */

// Regression for: merging an approved membership application into an
// existing family must decrypt the family's existing (encrypted) notes,
// concatenate the new note, then RE-ENCRYPT — never store ciphertext+plaintext
// unencrypted (which corrupts the old note and leaks the new PII in cleartext).

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), info: jest.fn() } }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: false, minDues: null }) }))
jest.mock("@/lib/letterSettings", () => ({ getLetterSettings: jest.fn().mockResolvedValue({ signerTitle: "" }) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))
jest.mock("next/headers", () => ({ headers: jest.fn() }))
jest.mock("@/lib/turnstile", () => ({ verifyTurnstile: jest.fn() }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendMembershipNotificationEmail: jest.fn() }))
jest.mock("@/lib/pdf/MembershipPdf", () => ({ renderMembershipPdf: jest.fn() }))
jest.mock("@/lib/familyFields", () => ({ encryptFamilyFields: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => (v.startsWith("enc:") ? v.slice(4) : v)),
  hmacEmail: jest.fn((v: string) => `hash:${v}`),
  hmacMobile: jest.fn((v: string) => `mhash:${v}`),
}))
jest.mock("@/lib/membership", () => ({
  membershipPayloadSchema: {},
  encryptPayload: jest.fn(),
  readPayload: jest.fn(() => ({
    personal: { name: "John Doe", gender: null, dateOfBirth: null, email: null, mobile: null, qualificationProfession: null, motherParish: null, maritalStatus: null },
    spouse: undefined,
    children: [],
    dependents: [],
  })),
  buildNotesBlock: jest.fn(() => "new note"),
  deriveFamilyName: jest.fn(() => "Doe"),
}))

const tx = {
  family: {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  person: {
    findMany: jest.fn().mockResolvedValue([{ firstName: "John", lastName: "Doe" }]),
    createMany: jest.fn().mockResolvedValue({}),
  },
  membershipApplication: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
}

jest.mock("@/lib/prisma", () => ({
  prisma: {
    membershipApplication: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { approveMembershipApplication } from "@/lib/actions/membership"

const mockAuth = auth as jest.Mock
const mockAppFindUnique = prisma.membershipApplication.findUnique as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  tx.person.findMany.mockResolvedValue([{ firstName: "John", lastName: "Doe" }])
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
  mockAppFindUnique.mockResolvedValue({ id: 1, status: "PENDING", payload: "{}", monthlyDues: null, linkedFamilyId: null })
})

describe("approveMembershipApplication — merge notes encryption", () => {
  it("decrypts existing family notes, appends the new note, and re-encrypts the result", async () => {
    tx.family.findUnique.mockResolvedValue({
      id: 42, notes: "enc:old note",
      address: "1 St", suburb: "Town", state: "NSW", postcode: "2000",
      marriageDate: new Date("2000-01-01"), monthlyDues: 10,
    })

    await approveMembershipApplication(1, { mode: "merge", familyId: 42 })

    // Existing ciphertext was decrypted before concatenation…
    expect(safeDecrypt).toHaveBeenCalledWith("enc:old note")
    // …and the merged plaintext block was re-encrypted as a whole.
    expect(encrypt).toHaveBeenCalledWith("old note\n\nnew note")
    const updateArg = tx.family.update.mock.calls[0][0]
    expect(updateArg.data.notes).toBe("enc:old note\n\nnew note")
  })

  it("encrypts the new note even when the family had no prior notes", async () => {
    tx.family.findUnique.mockResolvedValue({
      id: 42, notes: null,
      address: "1 St", suburb: "Town", state: "NSW", postcode: "2000",
      marriageDate: new Date("2000-01-01"), monthlyDues: 10,
    })

    await approveMembershipApplication(1, { mode: "merge", familyId: 42 })

    expect(encrypt).toHaveBeenCalledWith("new note")
    const updateArg = tx.family.update.mock.calls[0][0]
    expect(updateArg.data.notes).toBe("enc:new note")
  })
})
