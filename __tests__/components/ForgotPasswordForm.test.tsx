/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm"
import { requestPasswordReset } from "@/lib/actions/auth"

jest.mock("@/lib/actions/auth", () => ({ requestPasswordReset: jest.fn() }))
const mockRequest = requestPasswordReset as jest.Mock

beforeEach(() => mockRequest.mockReset())

async function submit(email: string) {
  render(<ForgotPasswordForm />)
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } })
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /send reset link/i }).closest("form")!) })
}

test("keeps the typed email when the server returns an error", async () => {
  mockRequest.mockResolvedValue({ error: "Too many requests. Please try again later." })
  await submit("someone@example.com")
  expect(screen.getByText(/too many requests/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/email address/i)).toHaveValue("someone@example.com")
})

test("a thrown action shows a retry message instead of crashing", async () => {
  mockRequest.mockRejectedValue(new Error("db down"))
  await submit("someone@example.com")
  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/email address/i)).toHaveValue("someone@example.com")
})
