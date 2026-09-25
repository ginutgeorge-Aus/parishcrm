/** @jest-environment node */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn().mockResolvedValue(false) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    registration: { findUnique: jest.fn(), findFirst: jest.fn() },
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { canManageEvent } from "@/lib/eventManager"
import { getRegistrationDetail } from "@/lib/actions/registration"

const mockAuth = auth as jest.Mock
const findUnique = (prisma as unknown as { registration: { findUnique: jest.Mock } }).registration.findUnique
const findFirst = (prisma as unknown as { registration: { findFirst: jest.Mock } }).registration.findFirst

// A registration row as Prisma returns it (encrypted email/phone, JSON answers).
function encReg() {
  return {
    id: 7,
    eventId: 3,
    firstName: "Jane",
    lastName: "Doe",
    email: "enc:jane@x.com",
    phone: "enc:0400000000",
    totalAmount: "20",
    paymentStatus: "PAID",
    paymentRef: "pi_123",             // → Card
    customAnswers: `enc:${JSON.stringify({ diet: "Vegan" })}`,
    items: [
      {
        quantity: 1,
        ticketType: { name: "Adult" },
        attendees: [
          { name: "Jane Doe", checkedInAt: new Date("2026-01-01"), answers: `enc:${JSON.stringify({ tshirt: "L" })}` },
        ],
      },
    ],
    event: {
      customQuestions: [
        { id: "diet", label: "Dietary", type: "select", scope: "order" },
        { id: "tshirt", label: "T-shirt size", type: "select", scope: "attendee" },
      ],
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(canManageEvent as jest.Mock).mockResolvedValue(false)
})

describe("getRegistrationDetail", () => {
  it("denies AUDITOR (not canViewPeople, not organiser) with a generic not-found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    findUnique.mockResolvedValue({ eventId: 3 })       // existence probe
    const res = await getRegistrationDetail(7)
    expect(res).toEqual({ error: "Registration not found" })
    expect(findFirst).not.toHaveBeenCalled()           // never fetched/decrypted PII
  })

  it("allows VIEWER and returns decrypted, labelled data", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    findUnique.mockResolvedValue({ eventId: 3 })
    findFirst.mockResolvedValue(encReg())
    const res = await getRegistrationDetail(7)
    if ("error" in res) throw new Error(res.error)
    expect(res.data.email).toBe("jane@x.com")
    expect(res.data.phone).toBe("0400000000")
    expect(res.data.paymentMethod).toBe("Card")
    expect(res.data.totalAmount).toBe(20)
    // order-scoped answer at registration level
    expect(res.data.orderAnswers).toEqual([{ label: "Dietary", value: "Vegan" }])
    // attendee-scoped answer under the attendee, not at order level
    expect(res.data.attendees[0]).toMatchObject({
      name: "Jane Doe",
      ticketType: "Adult",
      checkedIn: true,
      answers: [{ label: "T-shirt size", value: "L" }],
    })
  })

  it("returns not-found when the registration row is missing (IDOR)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    findUnique.mockResolvedValue(null)
    const res = await getRegistrationDetail(999)
    expect(res).toEqual({ error: "Registration not found" })
  })

  it("allows an assigned EVENT_ORGANISER via canManageEvent", async () => {
    mockAuth.mockResolvedValue({ user: { id: "9", role: "EVENT_ORGANISER" } })
    ;(canManageEvent as jest.Mock).mockResolvedValue(true)
    findUnique.mockResolvedValue({ eventId: 3 })
    findFirst.mockResolvedValue(encReg())
    const res = await getRegistrationDetail(7)
    expect("data" in res).toBe(true)
  })

  it("writes a VIEW_REGISTRATION audit row on a successful view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    findUnique.mockResolvedValue({ eventId: 3 })
    findFirst.mockResolvedValue(encReg())
    await getRegistrationDetail(7)
    expect(logAudit).toHaveBeenCalledWith(1, "VIEW_REGISTRATION", "Registration", 7, { eventId: 3 })
  })

  it("rejects an invalid id without touching the DB", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    const res = await getRegistrationDetail(-1)
    expect(res).toEqual({ error: "Registration not found" })
    expect(findUnique).not.toHaveBeenCalled()
  })
})
