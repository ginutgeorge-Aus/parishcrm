import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MergeClient } from "@/components/families/MergeClient"
import { previewMerge, mergeFamilies } from "@/lib/actions/family"

jest.mock("@/lib/actions/family", () => ({
  previewMerge: jest.fn(),
  mergeFamilies: jest.fn(),
}))

// Render the shadcn Select as a plain native <select> — this test drives
// MergeClient's source/target selection logic, not Radix internals (same
// pattern as petty-cash-ImportClient.test.tsx). Select pulls the `id` off its
// SelectTrigger child and puts it on the real <select> so getByLabelText
// keeps resolving it via the existing <Label htmlFor>.
jest.mock("@/components/ui/select", () => {
  const ReactLib = jest.requireActual("react")
  function SelectTrigger({ children }: any) {
    return <>{children}</>
  }
  function Select({ value, onValueChange, children }: any) {
    let id: string | undefined
    ReactLib.Children.forEach(children, (child: any) => {
      if (child?.type === SelectTrigger) id = child.props.id
    })
    return (
      <select id={id} value={value ?? ""} onChange={(e: any) => onValueChange?.(e.target.value)}>
        {children}
      </select>
    )
  }
  return {
    Select,
    SelectTrigger,
    SelectValue: ({ placeholder }: any) => (placeholder ? <option value="">{placeholder}</option> : null),
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  }
})

const mockPush = jest.fn()
const mockRefresh = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const mockPreview = previewMerge as jest.Mock
const mockMerge = mergeFamilies as jest.Mock

const families = [
  { id: 1, name: "Smith Family", memberNo: "M001" },
  { id: 2, name: "Jones Family", memberNo: null },
  { id: 3, name: "Brown Family", memberNo: "M003" },
]

function selectSource(value: string) {
  fireEvent.change(screen.getByLabelText(/source/i), { target: { value } })
}

function selectTarget(value: string) {
  fireEvent.change(screen.getByLabelText(/target/i), { target: { value } })
}

describe("MergeClient", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("selection screen", () => {
    it("renders family options in both dropdowns", () => {
      render(<MergeClient families={families} />)
      const sourceOptions = screen.getAllByRole("option", { name: /smith family/i })
      expect(sourceOptions.length).toBeGreaterThanOrEqual(1)
    })

    it("shows warning and disables Preview button when same family selected for source and target", () => {
      render(<MergeClient families={families} />)
      selectSource("1")
      selectTarget("1")
      expect(screen.getByText(/source and target must be different/i)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /preview merge/i })).toBeDisabled()
    })

    it("disables Preview button when source is empty", () => {
      render(<MergeClient families={families} />)
      selectTarget("2")
      expect(screen.getByRole("button", { name: /preview merge/i })).toBeDisabled()
    })

    it("disables Preview button when target is empty", () => {
      render(<MergeClient families={families} />)
      selectSource("1")
      expect(screen.getByRole("button", { name: /preview merge/i })).toBeDisabled()
    })

    it("does not show same-family warning when different families selected", () => {
      render(<MergeClient families={families} />)
      selectSource("1")
      selectTarget("2")
      expect(screen.queryByText(/source and target must be different/i)).not.toBeInTheDocument()
    })
  })

  describe("preview", () => {
    const successPreview = {
      source: { id: 1, name: "Smith Family" },
      target: { id: 2, name: "Jones Family" },
      peopleCount: 3,
      transactionCount: 7,
      conflicts: [],
    }

    it("renders people and transaction counts after successful preview", async () => {
      mockPreview.mockResolvedValue(successPreview)
      render(<MergeClient families={families} />)
      selectSource("1")
      selectTarget("2")
      fireEvent.click(screen.getByRole("button", { name: /preview merge/i }))

      await waitFor(() => expect(screen.getByText(/confirm merge/i)).toBeInTheDocument())
      expect(screen.getByText(/3 people will be reassigned/i)).toBeInTheDocument()
      expect(screen.getByText(/7 transactions will be reassigned/i)).toBeInTheDocument()
    })

    it("shows conflict names and disables Confirm button when conflicts present", async () => {
      mockPreview.mockResolvedValue({
        ...successPreview,
        conflicts: ["Alice Smith", "Bob Smith"],
      })
      render(<MergeClient families={families} />)
      selectSource("1")
      selectTarget("2")
      fireEvent.click(screen.getByRole("button", { name: /preview merge/i }))

      // Wait for the button itself to settle, not just the conflict text. Preview
      // and Confirm share one useTransition, so `isPending` can still be true when
      // the conflict block first renders — the button then reads "Merging…", and a
      // role query for /confirm merge/i races and misses under CI CPU contention
      //. findByRole waits until the label flips back to "Confirm merge".
      await screen.findByRole("button", { name: /confirm merge/i })
      expect(screen.getByText(/cannot merge/i)).toBeInTheDocument()
      expect(screen.getByText("Alice Smith")).toBeInTheDocument()
      expect(screen.getByText("Bob Smith")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /confirm merge/i })).toBeDisabled()
    })

    it("shows error message when previewMerge returns an error", async () => {
      mockPreview.mockResolvedValue({ error: "Families not found" })
      render(<MergeClient families={families} />)
      selectSource("1")
      selectTarget("2")
      fireEvent.click(screen.getByRole("button", { name: /preview merge/i }))

      await waitFor(() => expect(screen.getByText("Families not found")).toBeInTheDocument())
      // stays on selection screen (no confirm heading)
      expect(screen.queryByText(/confirm merge/i)).not.toBeInTheDocument()
    })
  })

  describe("confirm / merge", () => {
    const successPreview = {
      source: { id: 1, name: "Smith Family" },
      target: { id: 2, name: "Jones Family" },
      peopleCount: 2,
      transactionCount: 4,
      conflicts: [],
    }

    async function reachConfirmScreen() {
      mockPreview.mockResolvedValue(successPreview)
      render(<MergeClient families={families} />)
      selectSource("1")
      selectTarget("2")
      fireEvent.click(screen.getByRole("button", { name: /preview merge/i }))
      // Wait for the exact element the callers then click — not just the heading
      // text. getByText could resolve a render before the button is queryable by
      // role, so a synchronous getByRole afterwards races under CPU contention
      // on the 2-core CI runner.
      await screen.findByRole("button", { name: /confirm merge/i })
    }

    it("navigates to /families on successful merge", async () => {
      await reachConfirmScreen()
      mockMerge.mockResolvedValue(null)
      fireEvent.click(screen.getByRole("button", { name: /confirm merge/i }))
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/families"))
    })

    it("shows error and does not navigate when mergeFamilies returns an error", async () => {
      await reachConfirmScreen()
      mockMerge.mockResolvedValue({ error: "Merge failed" })
      fireEvent.click(screen.getByRole("button", { name: /confirm merge/i }))
      await waitFor(() => expect(screen.getByText("Merge failed")).toBeInTheDocument())
      expect(mockPush).not.toHaveBeenCalled()
    })

    it("shows conflict error and does not navigate when merge returns conflicts", async () => {
      await reachConfirmScreen()
      mockMerge.mockResolvedValue({ conflicts: ["Alice Smith"] })
      fireEvent.click(screen.getByRole("button", { name: /confirm merge/i }))
      await waitFor(() => expect(screen.getByText(/conflicts/i)).toBeInTheDocument())
      expect(mockPush).not.toHaveBeenCalled()
    })

    it("Cancel button returns to selection screen", async () => {
      await reachConfirmScreen()
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
      expect(screen.getByRole("button", { name: /preview merge/i })).toBeInTheDocument()
    })
  })
})
