import { render, screen } from "@testing-library/react"
import { EventForm } from "@/components/events/EventForm"
import type { ActionResult } from "@/lib/actions/types"

const noopAction = async (_prev: ActionResult): Promise<ActionResult> => undefined

it("uses sentence case for the submit button", () => {
  render(<EventForm action={noopAction} />)
  expect(screen.getByRole("button", { name: "Save event" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Save Event" })).toBeNull()
})
