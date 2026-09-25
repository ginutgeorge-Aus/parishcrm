import { generateCsv } from "@/lib/eventExport"

type Reg = Parameters<typeof generateCsv>[0][number] & {
  customAnswers?: Record<string, string | string[]> | null
}

function makeReg(overrides: Partial<Reg> = {}): Reg {
  return {
    id: 1,
    publicToken: "REG-A1B2C3D4E5F6",
    firstName: "Alice",
    lastName: "Smith",
    email: "alice@example.com",
    phone: null,
    totalAmount: 50,
    paymentStatus: "PAID",
    createdAt: new Date("2026-05-22T00:00:00.000Z"),
    items: [{ quantity: 1, ticketType: { name: "Adult" }, attendees: [{ name: "Alice Smith", answers: null }] }],
    customAnswers: null,
    ...overrides,
  }
}

const HEADER =
  "Ref,Attendee Name,Ticket Type,Registrant First,Registrant Last,Email,Phone,Amount,Status,Registered At"

describe("generateCsv", () => {
  it("returns header row only for empty registrations", () => {
    expect(generateCsv([], [])).toBe(HEADER)
  })

  it("Ref column shows the registrant-facing publicToken, not the internal id", () => {
    const csv = generateCsv([makeReg({ id: 42, publicToken: "REG-DEADBEEF01" })], [])
    const dataRow = csv.split("\n")[1]
    expect(dataRow.split(",")[0]).toBe("REG-DEADBEEF01")
    expect(csv).not.toContain("REG-00042")
  })

  it("emits one row per attendee with attendee name and ticket type", () => {
    const csv = generateCsv(
      [
        makeReg({
          totalAmount: 90,
          items: [
            { quantity: 3, ticketType: { name: "Adult" }, attendees: [{ name: "Al G", answers: null }, { name: "Bo G", answers: null }, { name: "Ca G", answers: null }] },
            { quantity: 2, ticketType: { name: "Child" }, attendees: [{ name: "Da G", answers: null }, { name: "Ev G", answers: null }] },
          ],
        }),
      ],
      []
    )
    const lines = csv.split("\n")
    expect(lines).toHaveLength(6) // header + 5 attendees
    expect(lines[1]).toContain("Al G")
    expect(lines[1]).toContain("Adult")
    expect(lines[4]).toContain("Da G")
    expect(lines[4]).toContain("Child")
  })

  it("puts Amount only on the first attendee row of a registration", () => {
    const csv = generateCsv(
      [
        makeReg({
          totalAmount: 90,
          items: [{ quantity: 2, ticketType: { name: "Adult" }, attendees: [{ name: "Al G", answers: null }, { name: "Bo G", answers: null }] }],
        }),
      ],
      []
    )
    const lines = csv.split("\n")
    expect(lines[1].split(",")).toContain("90.00")
    expect(lines[2].split(",")[7]).toBe("")
  })

  it("falls back to blank attendee name for items with no attendee rows", () => {
    const csv = generateCsv(
      [makeReg({ items: [{ quantity: 2, ticketType: { name: "Adult" }, attendees: [] }] })],
      []
    )
    const lines = csv.split("\n")
    expect(lines).toHaveLength(3) // header + 2 blank-name rows
    expect(lines[1].split(",")[1]).toBe("")
    expect(lines[1]).toContain("Adult")
  })

  it("repeats registrant contact on every attendee row", () => {
    const csv = generateCsv(
      [makeReg({ items: [{ quantity: 2, ticketType: { name: "Adult" }, attendees: [{ name: "Al G", answers: null }, { name: "Bo G", answers: null }] }] })],
      []
    )
    const lines = csv.split("\n")
    expect(lines[1]).toContain("alice@example.com")
    expect(lines[2]).toContain("alice@example.com")
  })

  it("prefixes formula-injection attendee name with apostrophe", () => {
    const csv = generateCsv(
      [makeReg({ items: [{ quantity: 1, ticketType: { name: "Adult" }, attendees: [{ name: '=HYPERLINK("evil")', answers: null }] }] })],
      []
    )
    expect(csv).toContain("'=HYPERLINK")
  })

  it("adds custom question labels as extra columns, answered on first row only", () => {
    const csv = generateCsv(
      [
        makeReg({
          customAnswers: { q1: "Vegetarian" },
          items: [{ quantity: 2, ticketType: { name: "Adult" }, attendees: [{ name: "Al G", answers: null }, { name: "Bo G", answers: null }] }],
        }),
      ],
      [{ id: "q1", label: "Dietary" }]
    )
    const lines = csv.split("\n")
    expect(lines[0]).toContain("Dietary")
    expect(lines[1]).toContain("Vegetarian")
    expect(lines[2]).not.toContain("Vegetarian")
  })

  it("outputs empty string for missing custom answer (not 'undefined')", () => {
    const csv = generateCsv([makeReg()], [{ id: "q1", label: "Dietary" }])
    expect(csv).not.toContain("undefined")
  })

  it("renders checkbox arrays and consent timestamps", () => {
    const csv = generateCsv(
      [makeReg({
        customAnswers: { q0: ["Veg", "Non-veg"], q1: "2026-06-27T00:00:00.000Z" },
      })],
      [{ id: "q0", label: "Meal", type: "checkbox" }, { id: "q1", label: "Waiver", type: "consent" }],
    )
    const dataRow = csv.split("\n")[1]
    expect(dataRow).toContain("Veg; Non-veg")
    expect(dataRow).toContain("Yes (27/06/2026)")
  })

  it("shows attendee-scoped answer on each attendee row; order-scoped first-row only", () => {
    const csv = generateCsv(
      [
        {
          id: 1,
          publicToken: "REG-ZZZ",
          firstName: "A",
          lastName: "B",
          email: "a@b.com",
          phone: null,
          totalAmount: "0",
          paymentStatus: "PENDING",
          createdAt: new Date("2026-01-01"),
          customAnswers: { qNotes: "hi" },
          items: [
            {
              quantity: 2,
              ticketType: { name: "Adult" },
              attendees: [
                { name: "Ann", answers: { qDiet: "Vegan" } },
                { name: "Bob", answers: { qDiet: "None" } },
              ],
            },
          ],
        },
      ],
      [
        { id: "qDiet", label: "Diet", scope: "attendee" },
        { id: "qNotes", label: "Notes", scope: "order" },
      ],
    )
    const lines = csv.split("\n")
    expect(lines[1]).toContain("Ann")
    expect(lines[1]).toContain("Vegan")
    expect(lines[1]).toContain("hi")
    expect(lines[2]).toContain("Bob")
    expect(lines[2]).toContain("None")
    expect(lines[2]).not.toContain("hi") // order answer first-row only
  })
})
