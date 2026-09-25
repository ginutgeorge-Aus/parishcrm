jest.mock("@/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "1", role: "ADMIN" } })) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn(), findMany: jest.fn() },
    celebrationSend: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")), safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(async () => {}),
  isAmbiguousDeliveryError: (e: unknown) =>
    typeof (e as { code?: string })?.code === "string" &&
    ["ETIMEDOUT", "ECONNRESET", "ESOCKET", "EPIPE"].includes((e as { code: string }).code),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("@/lib/actions/settings", () => ({ getAnniversaryTemplate: jest.fn(async () => ({ subject: "For {names}", body: "Bless {names}, {years} years." })) }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))

import { sendAnniversaryEmail } from "@/lib/actions/anniversary"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"

const create = prisma.celebrationSend.create as jest.Mock
const updateMany = prisma.celebrationSend.updateMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  create.mockResolvedValue({ id: 1 })
  updateMany.mockResolvedValue({ count: 0 })
})

test("sends to both consenting spouses, names both", async () => {
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
    id: 10, archivedAt: null, marriageDate: new Date("2020-06-15T00:00:00.000Z"),
    people: [
      { id: 1, firstName: "Sam", role: "HEAD", email: "enc:sam@x.com", emailConsent: true },
      { id: 2, firstName: "Pat", role: "SPOUSE", email: "enc:pat@x.com", emailConsent: true },
    ],
  })
  const res = await sendAnniversaryEmail(10)
  expect(res).toHaveProperty("success")
  expect(sendEmail).toHaveBeenCalledTimes(2)
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toContain("Bless Sam and Pat")
})

test("error when no spouse has a consented email", async () => {
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
    id: 11, archivedAt: null, marriageDate: new Date("2020-06-15T00:00:00.000Z"),
    people: [{ id: 3, firstName: "Sam", role: "HEAD", email: null, emailConsent: false }],
  })
  const res = await sendAnniversaryEmail(11)
  expect(res).toEqual({ error: expect.stringContaining("consented email") })
  expect(sendEmail).not.toHaveBeenCalled()
})

test("error on missing/archived family or no marriage date", async () => {
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue(null)
  expect(await sendAnniversaryEmail(99)).toEqual({ error: "Family not found" })
})

test(" already sent today (claim collision on every recipient) is reported, not silently re-sent", async () => {
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
    id: 10, archivedAt: null, marriageDate: new Date("2020-06-15T00:00:00.000Z"),
    people: [
      { id: 1, firstName: "Sam", role: "HEAD", email: "enc:sam@x.com", emailConsent: true },
      { id: 2, firstName: "Pat", role: "SPOUSE", email: "enc:pat@x.com", emailConsent: true },
    ],
  })
  create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
  updateMany.mockResolvedValue({ count: 0 }) // no FAILED slot to reclaim — already SENT/PENDING
  const res = await sendAnniversaryEmail(10)
  expect(res).toEqual({ error: "Anniversary email already sent to Sam and Pat today" })
  expect(sendEmail).not.toHaveBeenCalled()
})
