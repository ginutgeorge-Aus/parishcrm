/**
 * @jest-environment jsdom
 *
 * AUD-8-01: a rejected family save keeps what was typed and focuses the error.
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FamilyForm } from "@/components/families/FamilyForm"

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn()
})

it("keeps typed values and focuses the alert when the server rejects the save", async () => {
  const action = jest.fn().mockResolvedValue({ error: "Member number already used" })
  render(<FamilyForm action={action} />)
  await userEvent.type(screen.getByLabelText(/Family name/), "Smith")
  await userEvent.type(screen.getByLabelText("Member No"), "42")
  await userEvent.type(screen.getByLabelText("Suburb"), "Newcastle")
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  const alert = await screen.findByRole("alert")
  expect(alert).toHaveTextContent("Member number already used")
  await waitFor(() => expect(alert).toHaveFocus())
  expect(screen.getByLabelText(/Family name/)).toHaveValue("Smith")
  expect(screen.getByLabelText("Member No")).toHaveValue("42")
  expect(screen.getByLabelText("Suburb")).toHaveValue("Newcastle")
})
