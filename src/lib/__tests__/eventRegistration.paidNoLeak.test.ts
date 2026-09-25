// Task 5 follow-up (carried from Task 3b review): a PAID registration's
// confirmation email must NEVER include the bank-transfer block. The gate in
// persistRegistration is `paymentStatus === "PENDING" && totalAmount > 0` — a
// webhook-created PAID registration must fall through to `payment: undefined`
// so the confirmation email never shows bank BSB/account for a card payment
// that's already settled.

jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
}))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => true),
}))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))
jest.mock("@/lib/email", () => ({
  sendRegistrationConfirmationEmail: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/ics", () => ({
  buildIcs: jest.fn(() => "BEGIN:VCALENDAR..."),
  googleCalendarUrl: jest.fn(() => "https://calendar.google.com/render"),
}))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))

import { persistRegistration } from "@/lib/eventRegistrationPersist"
import type { EventWithTickets, PricedRegistration } from "@/lib/eventRegistrationPricing"
import { prisma } from "@/lib/prisma"
import { sendRegistrationConfirmationEmail } from "@/lib/email"

const $transaction = prisma.$transaction as jest.Mock
const sendConfirmationMock = sendRegistrationConfirmationEmail as jest.Mock

function makeEvent(overrides: Record<string, unknown> = {}): EventWithTickets {
  return {
    id: 1,
    slug: "fete",
    title: "Spring Fete",
    isPublished: true,
    date: null,
    endDate: null,
    description: null,
    location: null,
    bankBsb: "062-000",
    bankAccount: "12345678",
    customQuestions: [],
    ticketTypes: [
      { id: 1, name: "Adult", price: 10, capacity: null, registrationItems: [] },
    ],
    ...overrides,
  } as unknown as EventWithTickets
}

function makePriced(overrides: Partial<PricedRegistration> = {}): PricedRegistration {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    emailHash: "hash:jane@example.com",
    items: [{ ticketTypeId: 1, quantity: 1, unitPrice: 10, attendeeNames: ["Jane Doe"], perAttendeeAnswers: [] }],
    totalAmount: 20,
    waivedCount: 0,
    capacityChecks: [],
    ...overrides,
  }
}

let tx: {
  registration: { findFirst: jest.Mock; create: jest.Mock }
  registrationItem: { aggregate: jest.Mock; create: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  tx = {
    registration: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1, publicToken: "REG-PAID1" }),
    },
    registrationItem: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      create: jest.fn().mockResolvedValue({}),
    },
  }
  $transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))
})

it("omits the bank-details block from the confirmation email for a PAID (webhook) registration", async () => {
  const event = makeEvent()
  const priced = makePriced()

  const result = await persistRegistration(event, priced, { paymentStatus: "PAID", paymentRef: "pi_123" })

  expect(result).toEqual({ ok: true, ref: "REG-PAID1" })
  expect(sendConfirmationMock).toHaveBeenCalledTimes(1)
  const emailArg = sendConfirmationMock.mock.calls[0][1]
  // The PENDING-bank-transfer gate must not fire for PAID — no BSB/account leak.
  expect(emailArg.payment).toBeUndefined()
})

it("still shows the bank-details block for a PENDING bank-transfer registration (contrast case)", async () => {
  const event = makeEvent()
  const priced = makePriced()

  await persistRegistration(event, priced, { paymentStatus: "PENDING" })

  const emailArg = sendConfirmationMock.mock.calls[0][1]
  expect(emailArg.payment).toEqual({ bankBsb: "062-000", bankAccount: "12345678", reference: "REG-PAID1" })
})
