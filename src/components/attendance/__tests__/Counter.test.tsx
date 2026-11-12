import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { Counter } from "../Counter"

/** Controlled harness so typing and tapping update the displayed value. */
function Harness({ start = 0, spy }: Readonly<{ start?: number; spy?: (n: number) => void }>) {
  const [v, setV] = useState(start)
  return (
    <Counter
      label="Adults"
      value={v}
      onChange={(n) => {
        spy?.(n)
        setV(n)
      }}
    />
  )
}

describe("Counter", () => {
  it("+ increments", async () => {
    render(<Harness start={3} />)
    await userEvent.click(screen.getByRole("button", { name: "Increase Adults" }))
    expect(screen.getByLabelText("Adults")).toHaveValue("4")
  })

  it("− decrements but stops at 0", async () => {
    render(<Harness start={1} />)
    const minus = screen.getByRole("button", { name: "Decrease Adults" })
    await userEvent.click(minus)
    expect(screen.getByLabelText("Adults")).toHaveValue("0")
    expect(minus).toBeDisabled()
    await userEvent.click(minus)
    expect(screen.getByLabelText("Adults")).toHaveValue("0")
  })

  it("typing 12 sets 12", async () => {
    render(<Harness />)
    const input = screen.getByLabelText("Adults")
    await userEvent.clear(input)
    await userEvent.type(input, "12")
    expect(input).toHaveValue("12")
  })

  it("ignores non-numeric input", async () => {
    const spy = jest.fn()
    render(<Harness start={5} spy={spy} />)
    const input = screen.getByLabelText("Adults")
    await userEvent.type(input, "ab-.")
    expect(spy).not.toHaveBeenCalled()
    expect(input).toHaveValue("5")
  })

  it("caps typed values at 100000", async () => {
    render(<Harness />)
    const input = screen.getByLabelText("Adults")
    await userEvent.clear(input)
    await userEvent.type(input, "999999")
    expect(Number((input as HTMLInputElement).value)).toBeLessThanOrEqual(100000)
  })
})
