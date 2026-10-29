/** @jest-environment node */
import { adoptionMismatch, ymd } from "../pettyCashAdoption"

const amt = (v: string) => ({ toFixed: () => v })
const leg = { reconciled: false, paymentAccountId: 2, amount: amt("50.00"), date: new Date("2026-07-31T10:00:00Z") }
const target = { amount: "50", date: new Date("2026-07-31") }

it("ymd returns the UTC calendar day", () => {
  expect(ymd(new Date("2026-07-31T23:59:59Z"))).toBe("2026-07-31")
})

it("accepts an unreconciled cash leg matching amount and day (ignoring time)", () => {
  expect(adoptionMismatch(leg, target, 2)).toBeNull()
})

it.each([
  ["reconciled", { ...leg, reconciled: true }, "reconciled"],
  ["account", { ...leg, paymentAccountId: 3 }, "account"],
  ["amount", { ...leg, amount: amt("60.00") }, "amount"],
  ["date", { ...leg, date: new Date("2026-08-01") }, "date"],
] as const)("reports %s mismatch", (_n, l, expected) => {
  expect(adoptionMismatch(l, target, 2)).toBe(expected)
})
