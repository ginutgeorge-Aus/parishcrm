/**
 * TDD: / — petty-cash form date defaults must use the Sydney local
 * calendar day, not the UTC toISOString() which shows yesterday for AEST users
 * after ~14:00 UTC (i.e. after ~midnight Sydney time).
 *
 * Strategy: fake the clock to a UTC time where the UTC date (2026-06-21) and
 * the Sydney date (2026-06-22) differ. The mocked sydneyTodayYMD returns the
 * correct Sydney date. The bug produces the UTC date; the fix produces the
 * Sydney date.
 */
import { render, screen } from "@testing-library/react"

// Fix clock at 2026-06-21T15:00:00Z = 2026-06-22T01:00:00 AEST
// UTC date = "2026-06-21", Sydney date = "2026-06-22"
const FIXED_UTC = new Date("2026-06-21T15:00:00Z")
beforeAll(() => jest.useFakeTimers({ now: FIXED_UTC }))
afterAll(() => jest.useRealTimers())

// --- Mock react's useActionState so the form renders without a real action ---
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useActionState: (_action: unknown, initial: unknown) => [initial, jest.fn()],
}))

// --- Mock @/lib/dates so sydneyTodayYMD returns the correct Sydney day ---
jest.mock("@/lib/dates", () => ({
  sydneyTodayYMD: jest.fn(() => "2026-06-22"),
}))

// --- Mock next/navigation: the forms' Cancel buttons use router.back() ---
jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
}))

// --- Mock shadcn/ui Popover stack (used by SessionForm) ---
jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandInput: () => null,
  CommandItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandList: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))
jest.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))
jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { children?: React.ReactNode }) => (
    <label {...props}>{children}</label>
  ),
}))
jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))
jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}))
jest.mock("lucide-react", () => ({
  Check: () => null,
  ChevronsUpDown: () => null,
}))

import { SessionForm } from "@/components/petty-cash/SessionForm"
import { TransferForm } from "@/components/petty-cash/TransferForm"

describe("SessionForm — date default", () => {
  it("defaults session date to Sydney local date, not UTC ISO date", () => {
    render(
      <SessionForm
        action={jest.fn()}
        people={[{ id: 1, firstName: "John", lastName: "Smith" }]}
      />
    )
    const dateInput = screen.getByLabelText(/session date/i) as HTMLInputElement
    // Must be the mocked Sydney date, not new Date().toISOString().slice(0,10)
    expect(dateInput.defaultValue).toBe("2026-06-22")
  })
})

describe("TransferForm — date default", () => {
  it("defaults transfer date to Sydney local date, not UTC ISO date", () => {
    render(<TransferForm action={jest.fn()} maxAmount={500} />)
    // The label is "Transfer date"
    const dateInput = screen.getByLabelText(/transfer date/i) as HTMLInputElement
    expect(dateInput.defaultValue).toBe("2026-06-22")
  })
})
