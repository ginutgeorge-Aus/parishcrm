import { render, screen } from "@testing-library/react"
import { SessionTransfersTable } from "@/components/petty-cash/SessionTransfersTable"
import type { SessionTransfer } from "@/app/(dashboard)/accounting/petty-cash/sessions/[id]/page.data"

jest.mock("@/components/petty-cash/DeleteTransferButton", () => ({
  DeleteTransferButton: ({ id }: { id: number }) => <button>Delete {id}</button>,
}))
jest.mock("@/lib/accountingLock", () => ({
  isDateLocked: (d: Date, lock: Date | null) => lock !== null && d.getTime() <= lock.getTime(),
}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: (v: string) => v }))

const transfer = {
  id: 4,
  date: new Date("2026-07-31T00:00:00.000Z"),
  amount: "100.00",
  retainedFloat: "0",
  depositSlipRef: null,
  depositedByName: "Treasurer",
} as unknown as SessionTransfer

function setup(over: Partial<Parameters<typeof SessionTransfersTable>[0]> = {}) {
  return render(
    <SessionTransfersTable
      sessionId={1}
      transfers={[transfer]}
      totalTransfers={100}
      userCanEdit
      userIsAdmin
      isOpen
      lockDate={null}
      {...over}
    />,
  )
}

test("shows Edit links and Delete for an admin on an open session, with a named actions column", () => {
  setup()
  const links = screen.getAllByRole("link", { name: "Edit" })
  expect(links[0]).toHaveAttribute("href", "/accounting/petty-cash/sessions/1/transfer/4/edit")
  expect(screen.getAllByText("Delete 4").length).toBeGreaterThan(0)
  expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument()
})

test("PASTOR sees Edit but not Delete", () => {
  setup({ userIsAdmin: false })
  expect(screen.getAllByRole("link", { name: "Edit" }).length).toBeGreaterThan(0)
  expect(screen.queryByText("Delete 4")).not.toBeInTheDocument()
})

test("Edit is disabled inside a locked period", () => {
  setup({ lockDate: new Date("2026-08-31T00:00:00.000Z") })
  expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: "Edit — period locked" })[0]).toBeDisabled()
})

test("no actions on a closed session", () => {
  setup({ isOpen: false })
  expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument()
  expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument()
})
