import { render, screen } from "@testing-library/react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

function open(showCloseButton?: boolean) {
  render(
    <Dialog open>
      <DialogContent showCloseButton={showCloseButton}>
        <DialogTitle>Title</DialogTitle>
        <input aria-label="first field" />
      </DialogContent>
    </Dialog>,
  )
}

describe("DialogContent close button (#150)", () => {
  it("renders the close button inside a sticky wrapper so it stays visible while content scrolls", () => {
    open()
    const close = screen.getByRole("button", { name: "Close" })
    const wrapper = close.closest('[data-slot="dialog-close-sticky"]')
    expect(wrapper).not.toBeNull()
    expect(wrapper).toHaveClass("sticky", "order-first")
    // Wrapper is a direct child of the scrolling content element.
    expect(wrapper!.parentElement).toHaveAttribute("data-slot", "dialog-content")
  })

  it("keeps Close last in DOM order so initial focus is not stolen from the first field", () => {
    open()
    const content = document.querySelector('[data-slot="dialog-content"]')!
    expect(content.lastElementChild).toHaveAttribute("data-slot", "dialog-close-sticky")
  })

  it("omits the wrapper and the gap-cancelling class when showCloseButton is false", () => {
    open(false)
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
    expect(document.querySelector('[data-slot="dialog-close-sticky"]')).toBeNull()
    expect(document.querySelector('[data-slot="dialog-content"]')!.className).not.toContain("first-child")
  })
})
