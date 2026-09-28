import { pickDefaultAccount } from "@/lib/reports/pickDefaultAccount"

type Acc = { id: number; kind: string }

test("prefers the requested id when present", () => {
  const accounts: Acc[] = [{ id: 1, kind: "CASH" }, { id: 2, kind: "BANK" }]
  expect(pickDefaultAccount(accounts, 1)).toEqual({ id: 1, kind: "CASH" })
})

test("falls back to the first BANK account when the requested id isn't found", () => {
  const accounts: Acc[] = [{ id: 1, kind: "CASH" }, { id: 2, kind: "BANK" }]
  expect(pickDefaultAccount(accounts, 999)).toEqual({ id: 2, kind: "BANK" })
})

test("falls back to the first account when there's no BANK account", () => {
  const accounts: Acc[] = [{ id: 1, kind: "CASH" }, { id: 3, kind: "CASH" }]
  expect(pickDefaultAccount(accounts, 999)).toEqual({ id: 1, kind: "CASH" })
})

test("returns null when there are no accounts", () => {
  expect(pickDefaultAccount([], 1)).toBeNull()
})
