/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react"
import { DetailPageSkeleton } from "@/components/shared/DetailPageSkeleton"

describe("DetailPageSkeleton", () => {
  it("renders a heading placeholder plus the default 4 field rows", () => {
    const { container } = render(<DetailPageSkeleton />)
    const pulses = container.querySelectorAll(".animate-pulse")
    // 1 heading placeholder + 4 default field rows
    expect(pulses).toHaveLength(5)
  })

  it("renders the requested number of field rows", () => {
    const { container } = render(<DetailPageSkeleton rows={6} />)
    const pulses = container.querySelectorAll(".animate-pulse")
    // 1 heading placeholder + 6 field rows
    expect(pulses).toHaveLength(7)
  })

  it("is hidden from assistive tech", () => {
    const { container } = render(<DetailPageSkeleton />)
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true")
  })
})
