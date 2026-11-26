/**
 * @jest-environment jsdom
 *
 * FormError (AUD-8-01): an alert that scrolls itself into view and takes focus
 * when an error appears, so a phone user sees why a save was rejected.
 */
import { render, screen } from "@testing-library/react"
import { FormError } from "@/components/shared/FormError"

it("renders nothing without an error", () => {
  const { container } = render(<FormError error={undefined} />)
  expect(container).toBeEmptyDOMElement()
})

it("shows the message, scrolls to centre and focuses itself", () => {
  const scroll = jest.fn()
  window.HTMLElement.prototype.scrollIntoView = scroll
  render(<FormError error="Pick a category" />)
  const alert = screen.getByRole("alert")
  expect(alert).toHaveTextContent("Pick a category")
  expect(alert).toHaveFocus()
  expect(scroll).toHaveBeenCalledWith({ block: "center" })
})

it("re-scrolls when errorKey changes for an identical message", () => {
  const scroll = jest.fn()
  window.HTMLElement.prototype.scrollIntoView = scroll
  const { rerender } = render(<FormError error="same" errorKey={1} />)
  rerender(<FormError error="same" errorKey={2} />)
  expect(scroll).toHaveBeenCalledTimes(2)
})
