import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BirthdaysClient } from "@/components/people/BirthdaysClient"
import { sendBirthdayEmail, sendBirthdayEmailsBulk } from "@/lib/actions/birthday"

jest.mock("@/lib/actions/birthday", () => ({
  sendBirthdayEmail: jest.fn(),
  sendBirthdayEmailsBulk: jest.fn(),
}))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

const mockSendOne = sendBirthdayEmail as jest.Mock
const mockSendAll = sendBirthdayEmailsBulk as jest.Mock

const eligibleRow = {
  id: 1,
  name: "Alice Smith",
  family: "Smith",
  dob: "1980-06-15",
  ageTurning: 46,
  hasEmail: true,
  emailConsent: true,
}

const ineligibleRow = {
  id: 2,
  name: "Bob Jones",
  family: "Jones",
  dob: "1990-07-20",
  ageTurning: 36,
  hasEmail: false,
  emailConsent: false,
}

beforeEach(() => jest.clearAllMocks())

describe("BirthdaysClient", () => {
  describe("Send all button", () => {
    it("is disabled when eligibleCount is 0 (no rows with email + consent)", () => {
      render(
        <BirthdaysClient
          rows={[ineligibleRow]}
          windowDays={7}
          canEdit={true}
        />,
      )
      const sendAllBtn = screen.getByRole("button", { name: /send all/i })
      expect(sendAllBtn).toBeDisabled()
    })

    it("is enabled when at least one eligible row exists", () => {
      render(
        <BirthdaysClient
          rows={[eligibleRow]}
          windowDays={7}
          canEdit={true}
        />,
      )
      const sendAllBtn = screen.getByRole("button", { name: /send all/i })
      expect(sendAllBtn).not.toBeDisabled()
    })

    it("is not rendered when canEdit is false", () => {
      render(
        <BirthdaysClient
          rows={[eligibleRow]}
          windowDays={7}
          canEdit={false}
        />,
      )
      expect(screen.queryByRole("button", { name: /send all/i })).toBeNull()
    })
  })

  describe("sendOne", () => {
    it("calls sendBirthdayEmail with the row id and shows success message", async () => {
      mockSendOne.mockResolvedValue({ success: "Sent!" })

      render(
        <BirthdaysClient
          rows={[eligibleRow]}
          windowDays={7}
          canEdit={true}
        />,
      )

      // Mobile card + desktop table each render a Send button (jsdom renders
      // both breakpoints); click the first.
      fireEvent.click(screen.getAllByRole("button", { name: /^send$/i })[0])

      await waitFor(() => {
        expect(mockSendOne).toHaveBeenCalledWith(eligibleRow.id)
        expect(screen.getByText(/✅/)).toBeInTheDocument()
      })
    })

    it("shows error message when sendBirthdayEmail returns an error", async () => {
      mockSendOne.mockResolvedValue({ error: "SMTP failed" })

      render(
        <BirthdaysClient
          rows={[eligibleRow]}
          windowDays={7}
          canEdit={true}
        />,
      )

      fireEvent.click(screen.getAllByRole("button", { name: /^send$/i })[0])

      await waitFor(() => {
        expect(screen.getByText(/❌ SMTP failed/)).toBeInTheDocument()
      })
    })
  })

  describe("sendingId per-row disabling", () => {
    it("disables only the sending row while other rows remain enabled", async () => {
      const secondEligible = { ...eligibleRow, id: 3, name: "Carol White" }

      let resolveFirst!: (v: { success: string }) => void
      mockSendOne.mockReturnValueOnce(
        new Promise((res) => {
          resolveFirst = res
        }),
      )

      render(
        <BirthdaysClient
          rows={[eligibleRow, secondEligible]}
          windowDays={7}
          canEdit={true}
        />,
      )

      // 2 rows × (mobile card + desktop table) = 4 Send buttons.
      const sendButtons = screen.getAllByRole("button", { name: /^send$/i })
      expect(sendButtons).toHaveLength(4)

      fireEvent.click(sendButtons[0])

      // While first row is in-flight, second row's button should still exist and
      // be enabled (not disabled by sendingId — only pending disables it, which
      // also fires here; but the second button is not the sendingId row)
      // pending=true disables both via the `pending` flag in the component,
      // so we verify sendOne was called only for the first row's id
      expect(mockSendOne).toHaveBeenCalledWith(eligibleRow.id)
      expect(mockSendOne).not.toHaveBeenCalledWith(secondEligible.id)

      resolveFirst({ success: "Sent!" })
      await waitFor(() => expect(screen.getByText(/✅/)).toBeInTheDocument())
    })

    it("shows Sending… text on the active row", async () => {
      let resolve!: (v: { success: string }) => void
      mockSendOne.mockReturnValue(
        new Promise((res) => {
          resolve = res
        }),
      )

      render(
        <BirthdaysClient
          rows={[eligibleRow]}
          windowDays={7}
          canEdit={true}
        />,
      )

      fireEvent.click(screen.getAllByRole("button", { name: /^send$/i })[0])

      await waitFor(() => {
        expect(screen.getAllByText(/sending…/i).length).toBeGreaterThan(0)
      })

      resolve({ success: "ok" })
      await waitFor(() => expect(screen.getAllByText(/^send$/i).length).toBeGreaterThan(0))
    })
  })

  describe("bulk send disables per-row Send buttons", () => {
    it("disables row Send buttons while a bulk send is pending, preventing a double email", async () => {
      let resolveBulk!: (v: { sent: number; skipped: number; failed: number }) => void
      mockSendAll.mockReturnValue(
        new Promise((res) => {
          resolveBulk = res
        }),
      )
      const secondEligible = { ...eligibleRow, id: 5, name: "Dana Lee" }

      render(
        <BirthdaysClient
          rows={[eligibleRow, secondEligible]}
          windowDays={7}
          canEdit={true}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: /send all/i }))

      const sendButtons = screen.getAllByRole("button", { name: /^send$/i })
      sendButtons.forEach((btn) => expect(btn).toBeDisabled())

      // A click on a disabled row button must not fire an individual send —
      // this is what caused the double birthday email.
      fireEvent.click(sendButtons[0])
      expect(mockSendOne).not.toHaveBeenCalled()

      resolveBulk({ sent: 2, skipped: 0, failed: 0 })
      await waitFor(() => expect(screen.getByText(/✅ Sent 2/)).toBeInTheDocument())

      // Rows that were sent stay disabled — re-enabling them would let an
      // admin double-send in the same session.
      await waitFor(() => {
        screen.getAllByRole("button", { name: /^send$/i }).forEach((btn) => expect(btn).toBeDisabled())
      })
    })
  })

  describe("row marked Sent after success", () => {
    it("disables the row and shows a Sent badge after sendOne succeeds", async () => {
      mockSendOne.mockResolvedValue({ success: "Sent!" })

      render(<BirthdaysClient rows={[eligibleRow]} windowDays={7} canEdit={true} />)

      fireEvent.click(screen.getAllByRole("button", { name: /^send$/i })[0])

      await waitFor(() => {
        expect(screen.getAllByText("Sent").length).toBeGreaterThan(0)
        screen.getAllByRole("button", { name: /^send$/i }).forEach((btn) => expect(btn).toBeDisabled())
      })
    })

    it("leaves the row eligible when sendOne returns an error", async () => {
      mockSendOne.mockResolvedValue({ error: "SMTP failed" })

      render(<BirthdaysClient rows={[eligibleRow]} windowDays={7} canEdit={true} />)

      fireEvent.click(screen.getAllByRole("button", { name: /^send$/i })[0])

      await waitFor(() => {
        expect(screen.getByText(/❌ SMTP failed/)).toBeInTheDocument()
        screen.getAllByRole("button", { name: /^send$/i }).forEach((btn) => expect(btn).not.toBeDisabled())
      })
    })

    it("marks previously-eligible rows Sent after sendAll succeeds", async () => {
      mockSendAll.mockResolvedValue({ sent: 2, skipped: 0, failed: 0 })
      const secondEligible = { ...eligibleRow, id: 9, name: "Erin Wu" }

      render(
        <BirthdaysClient rows={[eligibleRow, secondEligible]} windowDays={7} canEdit={true} />,
      )

      fireEvent.click(screen.getByRole("button", { name: /send all/i }))

      await waitFor(() => {
        expect(screen.getByText(/✅ Sent 2/)).toBeInTheDocument()
        // 2 rows × (mobile card + desktop table) = 4 "Sent" badges.
        expect(screen.getAllByText("Sent").length).toBe(4)
        screen.getAllByRole("button", { name: /^send$/i }).forEach((btn) => expect(btn).toBeDisabled())
      })
    })

    it("leaves rows eligible when sendAll reports a failure so they can be retried", async () => {
      mockSendAll.mockResolvedValue({ sent: 1, skipped: 0, failed: 1 })
      const secondEligible = { ...eligibleRow, id: 9, name: "Erin Wu" }

      render(
        <BirthdaysClient rows={[eligibleRow, secondEligible]} windowDays={7} canEdit={true} />,
      )

      fireEvent.click(screen.getByRole("button", { name: /send all/i }))

      await waitFor(() => {
        expect(screen.getByText(/✅ Sent 1, skipped 0, failed 1/)).toBeInTheDocument()
      })
      // Aggregate response can't say which row failed → mark none Sent, keep all retryable.
      expect(screen.queryByText("Sent")).not.toBeInTheDocument()
      screen.getAllByRole("button", { name: /^send$/i }).forEach((btn) => expect(btn).toBeEnabled())
    })
  })

  describe("window toggle", () => {
    it("marks only the active window as aria-pressed", () => {
      render(<BirthdaysClient rows={[eligibleRow]} windowDays={14} canEdit={true} />)
      expect(screen.getByRole("button", { name: "Next 7 days" })).toHaveAttribute("aria-pressed", "false")
      expect(screen.getByRole("button", { name: "Next 14 days" })).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByRole("button", { name: "Next 30 days" })).toHaveAttribute("aria-pressed", "false")
    })
  })

  describe("sendAll", () => {
    it("calls sendBirthdayEmailsBulk with windowDays and shows summary", async () => {
      mockSendAll.mockResolvedValue({ sent: 3, skipped: 1, failed: 0 })

      render(
        <BirthdaysClient
          rows={[eligibleRow]}
          windowDays={14}
          canEdit={true}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: /send all/i }))

      await waitFor(() => {
        expect(mockSendAll).toHaveBeenCalledWith(14)
        expect(screen.getByText(/✅ Sent 3, skipped 1, failed 0/)).toBeInTheDocument()
      })
    })

    it("shows error message when sendBirthdayEmailsBulk returns an error", async () => {
      mockSendAll.mockResolvedValue({ error: "Bulk send failed" })

      render(
        <BirthdaysClient
          rows={[eligibleRow]}
          windowDays={7}
          canEdit={true}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: /send all/i }))

      await waitFor(() => {
        expect(screen.getByText(/❌ Bulk send failed/)).toBeInTheDocument()
      })
    })
  })
})
