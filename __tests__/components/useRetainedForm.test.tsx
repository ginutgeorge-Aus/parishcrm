/**
 * @jest-environment jsdom
 *
 * useRetainedForm (AUD-8-01): a rejected save must leave every typed value in
 * place (React 19 would otherwise reset a form action's inputs to their
 * defaults), while a successful save still clears the form. The submit button
 * that triggered the form is part of the FormData.
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRetainedForm } from "@/components/shared/useRetainedForm"

type Result = { error: string } | { success: string } | undefined

function Demo({ action }: Readonly<{ action: (p: Result, f: FormData) => Promise<Result> }>) {
  const [state, onSubmit, isPending, errorSeq] = useRetainedForm(action)
  return (
    <form onSubmit={onSubmit}>
      <input aria-label="Name" name="name" defaultValue="" />
      <input aria-label="Date" name="date" type="date" defaultValue="2026-01-01" />
      <button type="submit">Save</button>
      <button type="submit" name="confirm" value="true">Confirm</button>
      <output data-testid="err">{state && "error" in state ? state.error : ""}</output>
      <output data-testid="seq">{errorSeq}</output>
      <output data-testid="pending">{String(isPending)}</output>
    </form>
  )
}

it("keeps typed values and bumps errorSeq when the action returns an error", async () => {
  const action = jest.fn().mockResolvedValue({ error: "nope" })
  render(<Demo action={action} />)
  await userEvent.type(screen.getByLabelText("Name"), "Alice")
  await userEvent.clear(screen.getByLabelText("Date"))
  await userEvent.type(screen.getByLabelText("Date"), "2026-03-04")
  await userEvent.click(screen.getByText("Save"))
  await waitFor(() => expect(screen.getByTestId("err")).toHaveTextContent("nope"))
  expect(screen.getByLabelText("Name")).toHaveValue("Alice")
  expect(screen.getByLabelText("Date")).toHaveValue("2026-03-04")
  expect(screen.getByTestId("seq")).toHaveTextContent("1")
  await userEvent.click(screen.getByText("Save"))
  await waitFor(() => expect(screen.getByTestId("seq")).toHaveTextContent("2"))
})

it("clears the form after a result without error", async () => {
  const action = jest.fn().mockResolvedValue({ success: "ok" })
  render(<Demo action={action} />)
  await userEvent.type(screen.getByLabelText("Name"), "Alice")
  await userEvent.click(screen.getByText("Save"))
  await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""))
})

it("sends the clicked submit button in the FormData", async () => {
  const action = jest.fn().mockResolvedValue({ error: "dup" })
  render(<Demo action={action} />)
  await userEvent.click(screen.getByText("Confirm"))
  await waitFor(() => expect(action).toHaveBeenCalled())
  const fd = action.mock.calls[0][1] as FormData
  expect(fd.get("confirm")).toBe("true")
})

it("turns a thrown action into an error and keeps the typed values", async () => {
  const action = jest.fn().mockRejectedValue(new Error("network down"))
  render(<Demo action={action} />)
  await userEvent.type(screen.getByLabelText("Name"), "Alice")
  await userEvent.click(screen.getByText("Save"))
  await waitFor(() =>
    expect(screen.getByTestId("err")).toHaveTextContent("Something went wrong. Please try again."),
  )
  expect(screen.getByLabelText("Name")).toHaveValue("Alice")
  expect(screen.getByTestId("seq")).toHaveTextContent("1")
})
