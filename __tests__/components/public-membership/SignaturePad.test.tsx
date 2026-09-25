import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SignaturePad } from "@/components/public-membership/SignaturePad"

// jsdom ships no canvas backend, so getContext()/toDataURL() are unimplemented.
// The typed-name path renders onto the canvas and reads it back as a PNG data
// URL, so stub just enough of the 2D context (and a deterministic toDataURL) to
// exercise that logic without a real rasteriser.
beforeAll(() => {
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    lineWidth: 0,
    lineCap: "",
    textBaseline: "",
    clearRect: jest.fn(),
    fillText: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    measureText: jest.fn(() => ({ width: 120 })),
  }
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx) as never
  HTMLCanvasElement.prototype.toDataURL = jest.fn(() => "data:image/png;base64,TYPEDSIG")
})

it("gives the canvas an image role and a descriptive accessible name", () => {
  render(<SignaturePad onChange={() => {}} />)
  const canvas = screen.getByRole("img", { name: /signature/i })
  expect(canvas.tagName).toBe("CANVAS")
})

it("wires an aria-describedby hint on the signing controls", () => {
  render(<SignaturePad onChange={() => {}} />)
  const canvas = screen.getByRole("img", { name: /signature/i })
  const describedBy = canvas.getAttribute("aria-describedby")
  expect(describedBy).toBeTruthy()
  // Every referenced id must resolve to a real element (WCAG 4.1.2).
  for (const id of describedBy!.split(/\s+/)) {
    expect(document.getElementById(id)).not.toBeNull()
  }
})

it("merges an external describedById into aria-describedby", () => {
  render(
    <div>
      <span id="ext-hint">External hint</span>
      <SignaturePad onChange={() => {}} describedById="ext-hint" />
    </div>,
  )
  const canvas = screen.getByRole("img", { name: /signature/i })
  expect(canvas.getAttribute("aria-describedby")).toContain("ext-hint")
})

it("offers a keyboard-operable way to switch to typed signing", async () => {
  render(<SignaturePad onChange={() => {}} />)
  // No text input until the typed mode is selected.
  expect(screen.queryByLabelText(/type your full name/i)).not.toBeInTheDocument()
  const typeToggle = screen.getByRole("radio", { name: /type/i })
  await userEvent.click(typeToggle)
  expect(screen.getByLabelText(/type your full name/i)).toBeInTheDocument()
})

it("produces a valid image signature from a typed name", async () => {
  const onChange = jest.fn()
  render(<SignaturePad onChange={onChange} />)
  await userEvent.click(screen.getByRole("radio", { name: /type/i }))
  const input = screen.getByLabelText(/type your full name/i)
  await userEvent.type(input, "Jane Doe")
  const last = onChange.mock.calls.at(-1)?.[0]
  expect(last).toMatch(/^data:image\//)
  expect(last.length).toBeGreaterThan(0)
})

it("clears the signature when the typed name is emptied", async () => {
  const onChange = jest.fn()
  render(<SignaturePad onChange={onChange} />)
  await userEvent.click(screen.getByRole("radio", { name: /type/i }))
  const input = screen.getByLabelText(/type your full name/i)
  await userEvent.type(input, "Jane")
  onChange.mockClear()
  await userEvent.clear(input)
  expect(onChange).toHaveBeenLastCalledWith("")
})

it("resets the signature to empty when switching signing modes", async () => {
  const onChange = jest.fn()
  render(<SignaturePad onChange={onChange} />)
  await userEvent.click(screen.getByRole("radio", { name: /type/i }))
  await userEvent.type(screen.getByLabelText(/type your full name/i), "Jane")
  onChange.mockClear()
  await userEvent.click(screen.getByRole("radio", { name: /draw/i }))
  expect(onChange).toHaveBeenLastCalledWith("")
})

it("keeps the Clear control working", async () => {
  const onChange = jest.fn()
  render(<SignaturePad onChange={onChange} />)
  await userEvent.click(screen.getByRole("button", { name: /clear/i }))
  expect(onChange).toHaveBeenLastCalledWith("")
})
