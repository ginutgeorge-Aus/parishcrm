import { render, screen } from "@testing-library/react"
import { PublishToggle } from "@/components/events/PublishToggle"

jest.mock("@/lib/actions/event", () => ({ publishEvent: jest.fn() }))

describe("PublishToggle — prop re-sync", () => {
  // Before the fix, `optimisticPublished` was seeded once via useState and never
  // re-synced when the `isPublished` prop changed on a later re-render of the
  // same mounted instance.
  it("reflects a server-side isPublished change on re-render without remounting", () => {
    const { rerender } = render(<PublishToggle eventId={1} isPublished={false} />)
    expect(screen.getByRole("button", { name: "Publish Event" })).toBeInTheDocument()

    rerender(<PublishToggle eventId={1} isPublished={true} />)
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument()
  })
})
