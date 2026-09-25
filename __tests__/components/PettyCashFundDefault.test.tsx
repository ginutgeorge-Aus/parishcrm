/**
 * @jest-environment jsdom
 *
 * /: editing a petty-cash expense/receipt that has an UNASSIGNED fund
 * (stored fundId === "") must keep it unassigned, not silently re-default to the
 * General fund. A falsy `expense?.fundId ? … : General` check got this wrong.
 * These drive the hidden `fundId` input the form actually submits.
 */
import { render } from "@testing-library/react"
import { ExpenseForm } from "@/components/petty-cash/ExpenseForm"
import { ReceiptForm } from "@/components/petty-cash/ReceiptForm"

jest.mock("next/navigation", () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }))

// Render the shadcn Select/Command/Popover as inert passthroughs — these tests
// assert the hidden fundId input's initial value, not Radix/cmdk internals.
jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <>{children}</>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <>{children}</>,
}))
jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <>{children}</>,
}))
jest.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <>{children}</>,
  CommandEmpty: ({ children }: any) => <>{children}</>,
  CommandGroup: ({ children }: any) => <>{children}</>,
  CommandInput: () => null,
  CommandItem: ({ children }: any) => <>{children}</>,
  CommandList: ({ children }: any) => <>{children}</>,
}))

const noopAction = async () => undefined
const funds = [
  { id: 10, name: "General" },
  { id: 20, name: "Building" },
]
const accounts = [{ id: 1, code: "5000", name: "Utilities" }]
const persons = [{ id: 1, firstName: "Al", lastName: "Jones" }]

function fundInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[name="fundId"]') as HTMLInputElement
}

describe("ExpenseForm fund default", () => {
  it("defaults a NEW expense to the General fund", () => {
    const { container } = render(<ExpenseForm action={noopAction} accounts={accounts} funds={funds} />)
    expect(fundInput(container).value).toBe("10")
  })

  it("keeps an edited expense's unassigned fund unassigned", () => {
    const expense = { amount: "5.00", payee: "X", accountId: "1", description: "d", receiptRef: "", fundId: "" }
    const { container } = render(<ExpenseForm action={noopAction} accounts={accounts} funds={funds} expense={expense} />)
    expect(fundInput(container).value).toBe("")
  })

  it("preserves an edited expense's assigned fund", () => {
    const expense = { amount: "5.00", payee: "X", accountId: "1", description: "d", receiptRef: "", fundId: "20" }
    const { container } = render(<ExpenseForm action={noopAction} accounts={accounts} funds={funds} expense={expense} />)
    expect(fundInput(container).value).toBe("20")
  })
})

describe("ReceiptForm fund default", () => {
  it("defaults a NEW receipt to the General fund", () => {
    const { container } = render(<ReceiptForm action={noopAction} accounts={accounts} persons={persons} funds={funds} />)
    expect(fundInput(container).value).toBe("10")
  })

  it("keeps an edited receipt's unassigned fund unassigned", () => {
    const receipt = { amount: "5.00", accountId: "1", personId: "", serviceTypeId: "", notes: "", fundId: "" }
    const { container } = render(<ReceiptForm action={noopAction} accounts={accounts} persons={persons} funds={funds} receipt={receipt} />)
    expect(fundInput(container).value).toBe("")
  })

  it("preserves an edited receipt's assigned fund", () => {
    const receipt = { amount: "5.00", accountId: "1", personId: "", serviceTypeId: "", notes: "", fundId: "20" }
    const { container } = render(<ReceiptForm action={noopAction} accounts={accounts} persons={persons} funds={funds} receipt={receipt} />)
    expect(fundInput(container).value).toBe("20")
  })
})
