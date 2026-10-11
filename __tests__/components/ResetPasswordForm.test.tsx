/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm"
import { resetPassword } from "@/lib/actions/auth"

jest.mock("@/lib/actions/auth", () => ({ resetPassword: jest.fn() }))
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))

const mockReset = resetPassword as jest.Mock

beforeEach(() => {
  mockReset.mockReset()
})

async function submitForm(password: string, confirm: string) {
  render(<ResetPasswordForm token="test-token-123" />)
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } })
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirm } })
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /set new password/i }).closest("form")!)
  })
}

describe("ResetPasswordForm", () => {
  it("shows an error when passwords do not match (client-side)", async () => {
    await submitForm("ValidPass123!", "DifferentPass123!")
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument()
    expect(mockReset).not.toHaveBeenCalled()
  })

  it("displays error message from server", async () => {
    mockReset.mockResolvedValue({ error: "Token expired" })
    await submitForm("ValidPass123!", "ValidPass123!")
    expect(screen.getByText("Token expired")).toBeInTheDocument()
  })

  it("shows a retry message when the action throws", async () => {
    mockReset.mockRejectedValue(new Error("db down"))
    await submitForm("ValidPass123!", "ValidPass123!")
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument()
  })

  it("toggles password visibility with the eye button", async () => {
    render(<ResetPasswordForm token="test-token" />)
    const pwInput = screen.getByLabelText("New password") as HTMLInputElement
    expect(pwInput.type).toBe("password")
    
    fireEvent.click(screen.getAllByRole("button", { name: /show|hide password/i })[0])
    expect(pwInput.type).toBe("text")
    
    fireEvent.click(screen.getAllByRole("button", { name: /show|hide password/i })[0])
    expect(pwInput.type).toBe("password")
  })

  it("toggles confirm password visibility independently", async () => {
    render(<ResetPasswordForm token="test-token" />)
    const buttons = screen.getAllByRole("button", { name: /show|hide password/i })
    const confirmInput = screen.getByLabelText("Confirm password") as HTMLInputElement
    
    expect(confirmInput.type).toBe("password")
    fireEvent.click(buttons[1])
    expect(confirmInput.type).toBe("text")
  })

  it("disables submit button while pending", async () => {
    mockReset.mockImplementation(() => new Promise(() => {}))
    render(<ResetPasswordForm token="test-token" />)
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "ValidPass123!" } })
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "ValidPass123!" } })
    
    const submitBtn = screen.getByRole("button", { name: /set new password/i })
    expect(submitBtn).not.toBeDisabled()
    
    await act(async () => {
      fireEvent.submit(submitBtn.closest("form")!)
    })
    
    expect(submitBtn).toBeDisabled()
  })

  it("passes matching password and token to resetPassword action", async () => {
    mockReset.mockResolvedValue({ success: true })
    await submitForm("ValidPass123!", "ValidPass123!")
    expect(mockReset).toHaveBeenCalledWith("test-token-123", "ValidPass123!")
  })
})
