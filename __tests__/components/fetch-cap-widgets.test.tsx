import { render, screen } from "@testing-library/react"
import { BirthdayWidget } from "@/components/dashboard/BirthdayWidget"
import { AnniversaryWidget } from "@/components/dashboard/AnniversaryWidget"

describe("dashboard celebration widgets — fetch cap notice", () => {
  it("warns when the birthday scan was truncated", () => {
    render(<BirthdayWidget birthdays={[]} truncated />)
    expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
  })
  it("warns when the anniversary scan was truncated", () => {
    render(<AnniversaryWidget anniversaries={[]} truncated />)
    expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
  })
  it("stays quiet when complete", () => {
    render(<BirthdayWidget birthdays={[]} />)
    expect(screen.queryByText(/may be incomplete/i)).not.toBeInTheDocument()
  })
})
