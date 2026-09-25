import { render, screen } from "@testing-library/react"
import { TransactionForm } from "@/components/accounting/TransactionForm"

const noop = async () => undefined
const accounts = [{ id: 1, code: "100", name: "Offering", type: "INCOME" as const }]
const funds = [{ id: 7, name: "General" }, { id: 8, name: "Building" }]
const paymentAccounts = [{ id: 1, name: "ANZ Church", kind: "BANK" as const, isDefault: true, isActive: true }]

test("renders a Fund selector with the provided funds", () => {
  render(<TransactionForm action={noop} accounts={accounts} families={[]} funds={funds} paymentAccounts={paymentAccounts} />)
  // Radix Select's trigger is a labelable <button> — the hidden native
  // <option>/BubbleSelect mirror also carries the text "General", so scope
  // to the trigger itself rather than screen.getByText (would match twice).
  const fundTrigger = screen.getByLabelText("Fund")
  expect(fundTrigger.tagName).toBe("BUTTON")
  expect(fundTrigger).toHaveTextContent("General")
})

test("keeps the linked member when editing an existing giving transaction", () => {
  // A mount-time useEffect keyed on familyId used to wipe personId to "" on the
  // very first render, silently unlinking the member on save. Editing a row that
  // already has a family+person must preserve the person.
  const families = [{ id: 5, name: "Smith", people: [{ id: 99, firstName: "Jon", lastName: "Smith" }] }]
  const transaction = {
    id: 1, date: new Date("2026-07-01"), description: "Tithe", amount: 50,
    type: "INCOME" as const, accountId: 1, paymentAccountId: null,
    familyId: 5, personId: 99, reference: null, notes: null, reconciled: false,
  }
  const { container } = render(
    <TransactionForm action={noop} transaction={transaction} accounts={accounts} families={families} funds={funds} paymentAccounts={paymentAccounts} />
  )
  const personInput = container.querySelector('input[name="personId"]') as HTMLInputElement
  expect(personInput.value).toBe("99")
})

test("preserves a null fundId when editing an existing transaction", () => {
  // A transaction with fundId === null (unassigned) must stay unassigned on
  // edit — defaulting the select to General here would silently reassign the
  // fund on save if the user submits without touching the Fund field.
  const transaction = {
    id: 2, date: new Date("2026-07-01"), description: "Legacy entry", amount: 25,
    type: "INCOME" as const, accountId: 1, paymentAccountId: null,
    familyId: null, personId: null, reference: null, notes: null,
    reconciled: false, fundId: null,
  }
  const { container } = render(
    <TransactionForm action={noop} transaction={transaction} accounts={accounts} families={[]} funds={funds} paymentAccounts={paymentAccounts} />
  )
  const fundInput = container.querySelector('input[name="fundId"]') as HTMLInputElement
  expect(fundInput.value).toBe("")
  const fundTrigger = screen.getByLabelText("Fund")
  expect(fundTrigger).toHaveTextContent("— unassigned —")
})
