/** @jest-environment node */
import { adoptionProblem, depositRefOfLeg, xferOutRef, ymd } from "../pettyCashAdoption"

const amt = (v: string) => ({ toFixed: () => v })
const deposit = { accountId: 9, type: "INCOME", amount: amt("50.00"), date: new Date("2026-07-31") }
const leg = {
  type: "EXPENSE", accountId: 9, reconciled: false, paymentAccountId: 2, pettyCashTransferId: null,
  amount: amt("50.00"), date: new Date("2026-07-31T10:00:00Z"),
}
const transfer = { amount: "50", date: new Date("2026-07-31") }
const ctx = { xferAccountId: 9, cashAccountId: 2 }

it("ymd returns the UTC calendar day", () => {
  expect(ymd(new Date("2026-07-31T23:59:59Z"))).toBe("2026-07-31")
})

it("xferOutRef and depositRefOfLeg round-trip", () => {
  expect(xferOutRef("ANZ_1")).toBe("XFER_OUT_ANZ_1")
  expect(depositRefOfLeg("XFER_OUT_ANZ_1")).toBe("ANZ_1")
})

it("accepts a matching pair (ignoring time of day)", () => {
  expect(adoptionProblem(deposit, leg, transfer, ctx)).toBeNull()
})

it.each([
  ["missing deposit", null, leg, "unavailable"],
  ["deposit on another account", { ...deposit, accountId: 4 }, leg, "unavailable"],
  ["non-INCOME deposit", { ...deposit, type: "EXPENSE" }, leg, "unavailable"],
  ["missing leg", deposit, null, "unavailable"],
  ["leg already linked", deposit, { ...leg, pettyCashTransferId: 2 }, "unavailable"],
  ["reconciled leg", deposit, { ...leg, reconciled: true }, "reconciled"],
  ["leg off the cash account", deposit, { ...leg, paymentAccountId: 3 }, "legMismatch"],
  ["non-EXPENSE leg", deposit, { ...leg, type: "INCOME" }, "legMismatch"],
  ["leg on another account", deposit, { ...leg, accountId: 4 }, "legMismatch"],
  ["leg amount differs", deposit, { ...leg, amount: amt("60.00") }, "legMismatch"],
  ["deposit amount differs", { ...deposit, amount: amt("60.00") }, leg, "depositMismatch"],
  ["deposit date differs", { ...deposit, date: new Date("2026-07-30") }, leg, "depositMismatch"],
  ["leg date differs", deposit, { ...leg, date: new Date("2026-08-01") }, "legDate"],
] as const)("%s", (_n, d, l, expected) => {
  expect(adoptionProblem(d, l, transfer, ctx)).toBe(expected)
})
