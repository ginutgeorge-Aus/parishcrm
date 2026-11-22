jest.mock("@/lib/featureFlags")
import { buildWelcomeLetterDraft, sendWelcomeLetter } from "@/lib/actions/welcomeLetter"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { sendWelcomeLetterEmail } from "@/lib/email"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { family: { findUnique: jest.fn() }, person: { findMany: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/cryptoCore", () => ({ safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn().mockResolvedValue({ name: "Example Church", address: "3 Example St", abn: "1", email: "c@x.com" }) }))
jest.mock("@/lib/letterSettings", () => ({
  getLetterSettings: jest.fn().mockResolvedValue({
    general: { fundLabel: "General Fund", bank: "ANZ", bsb: "1", account: "1", accountName: "n", taxDeductible: false },
    building: { fundLabel: "Tithe / School Building Fund", bank: "ANZ", bsb: "2", account: "2", accountName: "n2", taxDeductible: true },
    signerName: "Sec", signerTitle: "Secretary",
    introTemplate: "", contributionsTemplate: "", closingTemplate: "",
  }),
}))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: true, minDues: null }) }))
jest.mock("@/lib/pdf/WelcomeLetterPdf", () => ({ renderWelcomeLetterPdf: jest.fn().mockResolvedValue(Buffer.from("%PDF-x")) }))
jest.mock("@/lib/email", () => ({ sendWelcomeLetterEmail: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))

const mockAuth = auth as unknown as jest.Mock
const mockFamily = prisma.family.findUnique as jest.Mock
const mockPersons = prisma.person.findMany as jest.Mock

const FAMILY = {
  id: 7, name: "Carter", memberNo: "A10/12",
  address: "enc:5 Sample Avenue", suburb: "enc:Exampleton", state: "enc:NSW", postcode: "enc:2999",
  people: [
    { id: 1, title: "Mr.", firstName: "Daniel", middleName: "Taylor", lastName: "Carter", suffix: null, role: "HEAD", motherParish: "St. James, London", email: "enc:daniel@x.com" },
    { id: 2, title: "Mrs.", firstName: "Grace", middleName: null, lastName: "Garcia", suffix: null, role: "SPOUSE", motherParish: null, email: null },
  ],
}

describe("buildWelcomeLetterDraft", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects non-editor roles", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
    const r = await buildWelcomeLetterDraft(7)
    expect(r).toEqual({ error: "Unauthorized" })
  })

  it("builds a model + recipients from decrypted family data", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    mockFamily.mockResolvedValue(FAMILY)
    const r = await buildWelcomeLetterDraft(7)
    if ("error" in r) throw new Error(r.error)
    expect(r.model.addresseeName).toBe("Mr. Daniel Carter & Family")
    expect(r.model.includeTransfer).toBe(true)
    expect(r.recipients).toEqual([{ personId: 1, name: "Mr. Daniel Taylor Carter", email: "daniel@x.com" }])
    expect(r.familyName).toBe("Carter")
  })
})

const VALID_MODEL = {
  date: "1 January 2026", addresseeName: "Mr. Daniel Carter & Family", addressLines: ["5 Sample Avenue"],
  greetingName: "Daniel", memberNo: "A10/12", includeTransfer: false, transferChurch: "",
  members: ["Mr. Daniel Carter"], bodyIntro: "a", contributionsIntro: "b", bodyClosing: "c", bankAccounts: [],
  signerName: "Sec", signerTitle: "Secretary",
  church: { name: "Example Church", address: "3 Example St", abn: "1", email: "c@x.com" },
}

describe("sendWelcomeLetter", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFamily.mockResolvedValue({ id: 7, archivedAt: null })
  })

  it("rejects non-editor roles", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR" } })
    const r = await sendWelcomeLetter({ familyId: 7, model: {} as never, recipientPersonIds: [1] })
    expect(r).toEqual({ error: "Unauthorized" })
  })

  it("re-resolves recipient emails server-side, sends, and audits", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    mockPersons.mockResolvedValue([{ id: 1, email: "enc:daniel@x.com" }])
    const r = await sendWelcomeLetter({ familyId: 7, model: VALID_MODEL, recipientPersonIds: [1] })
    expect(sendWelcomeLetterEmail).toHaveBeenCalledWith("daniel@x.com", expect.anything(), expect.any(Buffer))
    expect(r).toEqual({ success: expect.stringContaining("sent") })
  })

  it("errors when no recipient has an email", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    mockPersons.mockResolvedValue([{ id: 1, email: null }])
    const r = await sendWelcomeLetter({ familyId: 7, model: VALID_MODEL, recipientPersonIds: [1] })
    expect(r).toEqual({ error: expect.stringContaining("email") })
  })

  describe("input validation (AUD-2-02)", () => {
    beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } }))

    const expectNothingSent = () => {
      expect(mockPersons).not.toHaveBeenCalled()
      expect(sendWelcomeLetterEmail).not.toHaveBeenCalled()
    }

    it("rejects a missing familyId", async () => {
      const r = await sendWelcomeLetter({ model: VALID_MODEL, recipientPersonIds: [1] } as never)
      expect(r).toEqual({ error: "Invalid family" })
      expectNothingSent()
    })

    it("rejects an object familyId", async () => {
      const r = await sendWelcomeLetter({ familyId: { not: 0 }, model: VALID_MODEL, recipientPersonIds: [1] } as never)
      expect(r).toEqual({ error: "Invalid family" })
      expectNothingSent()
    })

    it("rejects a non-integer recipient id", async () => {
      const r = await sendWelcomeLetter({ familyId: 7, model: VALID_MODEL, recipientPersonIds: [1, 1.5] })
      expect(r).toEqual({ error: "Invalid recipient" })
      expectNothingSent()
    })

    it("rejects an archived family", async () => {
      mockFamily.mockResolvedValue({ id: 7, archivedAt: new Date() })
      const r = await sendWelcomeLetter({ familyId: 7, model: VALID_MODEL, recipientPersonIds: [1] })
      expect(r).toEqual({ error: "Family not found" })
      expectNothingSent()
    })

    it("rejects a missing family", async () => {
      mockFamily.mockResolvedValue(null)
      const r = await sendWelcomeLetter({ familyId: 7, model: VALID_MODEL, recipientPersonIds: [1] })
      expect(r).toEqual({ error: "Family not found" })
      expectNothingSent()
    })

    it("rejects an invalid model", async () => {
      const r = await sendWelcomeLetter({ familyId: 7, model: { members: [] } as never, recipientPersonIds: [1] })
      expect(r).toEqual({ error: "Invalid letter" })
      expectNothingSent()
    })
  })
})
