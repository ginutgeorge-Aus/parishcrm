/** @jest-environment node */
// Real-Postgres race test for event capacity (StMarkCRM#3331 PR 4, links #3321/#3322 and
// the Serializable re-check in eventRegistrationPersist.ts). The mocked suite only asserts
// the transaction is opened at Serializable isolation; this fires parallel last-seat
// registrations through the real persistRegistration and checks Postgres admits exactly
// the seats that exist. Opt-in: runs only with INTEGRATION_DB=1 against a migrated,
// disposable database (see docs/integration-tests.md); skipped in the normal `npm test` run.

// Module scope: keeps this file's top-level names out of the shared global script scope.
export {}

jest.mock("server-only", () => ({}))
jest.mock("@/lib/email", () => ({ sendRegistrationConfirmationEmail: jest.fn().mockResolvedValue(undefined) }))

const RUN = process.env.INTEGRATION_DB === "1"
jest.setTimeout(60_000)

;(RUN ? describe : describe.skip)("registration last-seat races (real Postgres)", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let persist: typeof import("@/lib/eventRegistrationPersist")
  let include: typeof import("@/lib/eventCapacityInclude")
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const eventIds: number[] = []
  let seq = 0

  /**
   * Creates an event with one ticket type of the given capacity.
   * @param capacity - seats available
   */
  async function newEvent(capacity: number) {
    const event = await prisma.event.create({
      data: { title: `Race event ${tag}-${seq++}`, ticketTypes: { create: [{ name: "General", price: 0, capacity }] } },
    })
    eventIds.push(event.id)
    return prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: include.EVENT_CAPACITY_INCLUDE })
  }

  /**
   * Builds the priced request one registrant would submit (distinct email per caller).
   * @param event - the event being registered for
   * @param who - index making the email unique
   * @param quantity - seats requested
   */
  function priced(event: Awaited<ReturnType<typeof newEvent>>, who: number, quantity = 1): import("@/lib/eventRegistrationPricing").PricedRegistration {
    const ticket = event.ticketTypes[0]
    return {
      firstName: "Race",
      lastName: `Guest${who}`,
      email: `guest-${tag}-${who}@example.com`,
      emailHash: `race-${tag}-${event.id}-${who}`,
      items: [
        {
          ticketTypeId: ticket.id,
          quantity,
          unitPrice: 0,
          attendeeNames: Array.from({ length: quantity }, (_, i) => `Guest ${who}.${i}`),
          perAttendeeAnswers: Array.from({ length: quantity }, () => undefined),
        },
      ],
      totalAmount: 0,
      waivedCount: 0,
      capacityChecks: [{ ticketTypeId: ticket.id, quantity, name: ticket.name }],
    }
  }

  /**
   * Seats actually held (non-cancelled) on the event's ticket type.
   * @param ticketTypeId - ticket type to sum
   */
  async function seatsHeld(ticketTypeId: number): Promise<number> {
    const agg = await prisma.registrationItem.aggregate({
      where: { ticketTypeId, registration: { paymentStatus: { not: "CANCELLED" } } },
      _sum: { quantity: true },
    })
    return agg._sum.quantity ?? 0
  }

  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/prisma"))
    persist = await import("@/lib/eventRegistrationPersist")
    include = await import("@/lib/eventCapacityInclude")
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } })
    await prisma.$disconnect()
  })

  it("8 parallel registrations for the last seat: exactly one succeeds", async () => {
    const event = await newEvent(1)
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, who) => persist.persistRegistration(event as never, priced(event, who), { paymentStatus: "PENDING" })),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    // Losers get the friendly sold-out message, or "busy" once their Serializable retries run out.
    for (const loser of results.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)) {
      expect(loser.error).toMatch(/sold out|busy/)
    }
    expect(await seatsHeld(event.ticketTypes[0].id)).toBe(1)
  })

  it("10 parallel registrations for 3 seats: never oversells", async () => {
    const event = await newEvent(3)
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, who) => persist.persistRegistration(event as never, priced(event, who), { paymentStatus: "PENDING" })),
    )
    const ok = results.filter((r) => r.ok).length
    expect(ok).toBeGreaterThanOrEqual(1)
    expect(ok).toBeLessThanOrEqual(3)
    expect(await seatsHeld(event.ticketTypes[0].id)).toBe(ok)
  })

  it("the same registrant double-submitting in parallel creates one registration", async () => {
    const event = await newEvent(5)
    const same = priced(event, 0)
    const results = await Promise.all(Array.from({ length: 4 }, () => persist.persistRegistration(event as never, same, { paymentStatus: "PENDING" })))
    const refs = new Set(results.filter((r) => r.ok).map((r) => (r as { ref: string }).ref))
    expect(refs.size).toBe(1)
    expect(await prisma.registration.count({ where: { eventId: event.id } })).toBe(1)
  })
})
