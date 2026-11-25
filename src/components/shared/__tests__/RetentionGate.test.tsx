import { render, screen } from "@testing-library/react"
import { RetentionGate } from "@/components/shared/RetentionGate"

const btn = <button>Delete</button>

test("hides the delete button and explains inside the retention period", () => {
  render(<RetentionGate date={new Date()}>{btn}</RetentionGate>)
  expect(screen.queryByText("Delete")).not.toBeInTheDocument()
  expect(screen.getByText(/Kept for 7 years/)).toBeInTheDocument()
  expect(screen.getByText(/Edit it to correct it/)).toBeInTheDocument()
})

test("renders the delete button once past the retention period", () => {
  render(<RetentionGate date={new Date("2000-01-01T00:00:00.000Z")}>{btn}</RetentionGate>)
  expect(screen.getByText("Delete")).toBeInTheDocument()
  expect(screen.queryByText(/Kept for 7 years/)).not.toBeInTheDocument()
})
