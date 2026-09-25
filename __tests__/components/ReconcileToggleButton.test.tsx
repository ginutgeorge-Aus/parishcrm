import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ReconcileToggleButton } from "@/components/accounting/ReconcileToggleButton"
import { toggleReconciled } from "@/lib/actions/transactionReconcile"

jest.mock("@/lib/actions/transactionReconcile", () => ({ toggleReconciled: jest.fn() }))

describe("ReconcileToggleButton — transport failure", () => {
  beforeEach(() => jest.clearAllMocks())

  // Before the fix, a thrown/rejected action bypassed the `{error}` branch, so
  // the optimistic flip stuck and the badge showed a false Reconciled state.
  it("reverts the optimistic flip and shows an error when the action throws", async () => {
    ;(toggleReconciled as jest.Mock).mockRejectedValueOnce(new Error("network"))
    render(<ReconcileToggleButton id={1} reconciled={false} paymentAccountId={1} />)

    expect(screen.getByText("Pending")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button"))

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong, try again")
    )
    // Optimistic "Reconciled" flip was reverted back to Pending.
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.queryByText("Reconciled")).not.toBeInTheDocument()
  })
})
