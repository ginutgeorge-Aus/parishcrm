import { render, screen, fireEvent } from "@testing-library/react"
import { CloseSessionForm } from "@/components/petty-cash/CloseSessionForm"

jest.mock("next/navigation", () => ({ useRouter: () => ({ back: jest.fn() }) }))

const noop = async () => undefined

test("renders optional counted-cash input", () => {
  render(<CloseSessionForm action={noop} balance={100} />)
  expect(screen.getByLabelText(/counted cash/i)).toBeInTheDocument()
})

test("shows short variance when counted below balance", () => {
  render(<CloseSessionForm action={noop} balance={100} />)
  fireEvent.change(screen.getByLabelText(/counted cash/i), { target: { value: "95" } })
  expect(screen.getByText(/short/i)).toBeInTheDocument()
})

test("shows balanced when counted equals balance", () => {
  render(<CloseSessionForm action={noop} balance={100} />)
  fireEvent.change(screen.getByLabelText(/counted cash/i), { target: { value: "100" } })
  expect(screen.getByText(/balanced/i)).toBeInTheDocument()
})
