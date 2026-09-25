import { render, screen, fireEvent, act } from "@testing-library/react"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"

const noop = async () => undefined

test("Cancel is disabled while the delete is in flight", async () => {
  // A never-resolving-yet onConfirm keeps the transition pending so we can
  // observe the Cancel state mid-flight.
  let resolve: () => void = () => {}
  const onConfirm = jest.fn(() => new Promise<void>((r) => { resolve = r }))
  render(
    <DeleteConfirmButton
      onConfirm={onConfirm}
      title="Delete this?"
      description="Cannot be undone."
      confirmLabel="Confirm"
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Delete" })) // open dialog
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" })) // dispatch delete

  // Delete is in flight: Cancel must be disabled so it can't give a false
  // "cancelled" impression while the record is actually being deleted.
  expect(onConfirm).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()

  await act(async () => { resolve() }) // let the transition settle
})

test("disabled state shows the reason as visible text (not title-only)", () => {
  render(
    <DeleteConfirmButton
      onConfirm={noop}
      title="Delete this?"
      description="Cannot be undone."
      disabled
      disabledReason="Period locked"
    />,
  )
  // Reason must be perceivable to sighted touch/keyboard users, not hidden in a title attribute.
  expect(screen.getByText("Period locked")).toBeVisible()
})

test("disabled trigger is described by the visible reason for screen readers", () => {
  render(
    <DeleteConfirmButton
      onConfirm={noop}
      triggerLabel="Delete"
      title="Delete this?"
      description="Cannot be undone."
      disabled
      disabledReason="Period locked"
    />,
  )
  const trigger = screen.getByRole("button", { name: "Delete" })
  const describedBy = trigger.getAttribute("aria-describedby")
  expect(describedBy).toBeTruthy()
  expect(document.getElementById(describedBy!)).toHaveTextContent("Period locked")
})
