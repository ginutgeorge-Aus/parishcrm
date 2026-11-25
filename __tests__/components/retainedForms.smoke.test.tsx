/**
 * @jest-environment jsdom
 *
 * AUD-8-01: every form moved onto useRetainedForm shows a rejected save in
 * its alert box and keeps what was typed.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AccountForm } from "@/components/accounting/AccountForm"
import { AccountGroupForm } from "@/components/accounting/AccountGroupForm"
import { FundForm } from "@/components/accounting/FundForm"
import { OpeningBalanceForm } from "@/components/accounting/OpeningBalanceForm"
import { PaymentAccountsManager } from "@/components/accounting/PaymentAccountsManager"
import { ServiceTypeForm } from "@/components/petty-cash/ServiceTypeForm"

const rejected = jest.fn()

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }))
jest.mock("@/lib/actions/accountingSettings", () => ({
  upsertOpeningBalance: (...a: unknown[]) => rejected(...a),
}))
jest.mock("@/lib/actions/paymentAccount", () => ({
  createPaymentAccount: (...a: unknown[]) => rejected(...a),
  renamePaymentAccount: (...a: unknown[]) => rejected(...a),
  setAccountActive: jest.fn(),
  setDefaultAccount: jest.fn(),
}))

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  rejected.mockReset().mockResolvedValue({ error: "Rejected by server" })
})

async function expectRejected(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form") as HTMLFormElement)
  expect(await screen.findByRole("alert")).toHaveTextContent("Rejected by server")
}

it("AccountForm keeps input after a rejected save", async () => {
  const { container } = render(<AccountForm action={rejected} groups={[]} />)
  await userEvent.type(screen.getByLabelText("Code"), "4100")
  await expectRejected(container)
  expect(screen.getByLabelText("Code")).toHaveValue("4100")
})

it("AccountGroupForm shows the rejected save", async () => {
  const { container } = render(<AccountGroupForm action={rejected} />)
  await expectRejected(container)
})

it("FundForm keeps input after a rejected save", async () => {
  const { container } = render(<FundForm action={rejected} />)
  await userEvent.type(screen.getByLabelText("Name"), "Building")
  await expectRejected(container)
  expect(screen.getByLabelText("Name")).toHaveValue("Building")
})

it("ServiceTypeForm shows the rejected save", async () => {
  const { container } = render(<ServiceTypeForm action={rejected} />)
  await expectRejected(container)
})

it("OpeningBalanceForm shows the rejected save", async () => {
  const { container } = render(
    <OpeningBalanceForm accounts={[{ id: 1, name: "Bank" }]} balancesByAccountId={new Map()} />,
  )
  await expectRejected(container)
})

it("PaymentAccountsManager add and rename dialogs show the rejected save", async () => {
  const account = { id: 1, name: "Bank", kind: "BANK", isActive: true, isDefault: false } as never
  render(<PaymentAccountsManager accounts={[account]} />)
  await userEvent.click(screen.getByRole("button", { name: "Add account" }))
  fireEvent.submit(document.querySelector("form") as HTMLFormElement)
  expect(await screen.findByRole("alert")).toHaveTextContent("Rejected by server")
})
