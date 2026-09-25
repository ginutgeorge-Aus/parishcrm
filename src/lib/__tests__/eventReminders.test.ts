import { isReminderDue } from "@/lib/eventReminders"

const base = {
  kind: "one_off",
  isPublished: true,
  reminderDaysBefore: 3,
  reminderSentAt: null as Date | null,
  date: new Date("2026-07-15T09:00:00Z") as Date | null,
}
const now = new Date("2026-07-13T09:00:00Z") // 2 days before → inside 3-day window

describe("isReminderDue", () => {
  it("is true for a published one-off inside the lead window", () => {
    expect(isReminderDue(base, now)).toBe(true)
  })
  it("is false before the window opens", () => {
    const early = new Date("2026-07-11T08:59:00Z") // >3 days before
    expect(isReminderDue(base, early)).toBe(false)
  })
  it("is true exactly at the window boundary", () => {
    const boundary = new Date("2026-07-12T09:00:00Z") // exactly 3 days before
    expect(isReminderDue(base, boundary)).toBe(true)
  })
  it("is false when the event date has passed", () => {
    const after = new Date("2026-07-15T09:00:01Z")
    expect(isReminderDue(base, after)).toBe(false)
  })
  it("is false when reminderDaysBefore is null", () => {
    expect(isReminderDue({ ...base, reminderDaysBefore: null }, now)).toBe(false)
  })
  it("is false when already reminded", () => {
    expect(isReminderDue({ ...base, reminderSentAt: new Date() }, now)).toBe(false)
  })
  it("is false for recurring events", () => {
    expect(isReminderDue({ ...base, kind: "recurring" }, now)).toBe(false)
  })
  it("is false when unpublished", () => {
    expect(isReminderDue({ ...base, isPublished: false }, now)).toBe(false)
  })
  it("is false when date is null", () => {
    expect(isReminderDue({ ...base, date: null }, now)).toBe(false)
  })
})
