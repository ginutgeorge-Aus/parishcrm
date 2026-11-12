import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
jest.mock("@/lib/actions/sundaySchoolExam", () => ({ setExamScore: jest.fn() }))

import { setExamScore } from "@/lib/actions/sundaySchoolExam"
import { ExamMarksForm } from "@/components/sunday-school/ExamMarksForm"

const save = setExamScore as jest.Mock
const rows = [
  { personId: 1, name: "Child One", score: "7.5" },
  { personId: 3, name: "Child Three", score: null },
]
const input = (n: string) => screen.getByLabelText(`Score for ${n}`)
const type = (n: string, v: string) => fireEvent.change(input(n), { target: { value: v } })
const blur = async (n: string) => { await act(async () => { fireEvent.blur(input(n)) }) }

beforeEach(() => { jest.clearAllMocks(); save.mockResolvedValue(undefined) })

describe("ExamMarksForm saving", () => {
  it("saves a changed score on blur, trimmed, and refreshes", async () => {
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    type("Child Three", " 8 ")
    await blur("Child Three")
    expect(save).toHaveBeenCalledWith(9, 3, "8")
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(input("Child Three")).toHaveValue("8")
  })
  it("does not save when the value is unchanged", async () => {
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    await blur("Child One")
    type("Child One", "7.5 ")
    await blur("Child One")
    expect(save).not.toHaveBeenCalled()
  })
  it("saves a blank to clear a mark", async () => {
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    type("Child One", "")
    await blur("Child One")
    expect(save).toHaveBeenCalledWith(9, 1, "")
  })
  it("shows the server validation error on that row and does not refresh", async () => {
    save.mockResolvedValue({ error: "Score can't exceed 10" })
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    type("Child Three", "11")
    await blur("Child Three")
    expect(await screen.findByRole("alert")).toHaveTextContent("Score can't exceed 10")
    expect(input("Child Three")).toHaveAttribute("aria-invalid", "true")
    expect(refresh).not.toHaveBeenCalled()
  })
  it("retries after an error and clears the message on success", async () => {
    save.mockResolvedValueOnce({ error: "bad" })
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    type("Child Three", "x")
    await blur("Child Three")
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    type("Child Three", "5")
    await blur("Child Three")
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    expect(save).toHaveBeenLastCalledWith(9, 3, "5")
  })
  it("shows a general error when the action throws", async () => {
    save.mockRejectedValue(new Error("network"))
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    type("Child Three", "4")
    await blur("Child Three")
    expect(await screen.findByText("Couldn't save that mark. Please try again.")).toBeInTheDocument()
    expect(input("Child Three")).not.toBeDisabled()
  })
  it("disables the input while saving and ignores a second blur", async () => {
    let done!: (v?: unknown) => void
    save.mockReturnValue(new Promise(r => { done = r }))
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    type("Child Three", "6")
    await blur("Child Three")
    await waitFor(() => expect(input("Child Three")).toBeDisabled())
    await act(async () => { done() })
    await waitFor(() => expect(input("Child Three")).not.toBeDisabled())
    expect(save).toHaveBeenCalledTimes(1)
  })
  it("Enter blurs the field, triggering a save", async () => {
    render(<ExamMarksForm examId={9} totalMarks="10" rows={rows} readOnly={false} />)
    const el = input("Child Three")
    el.focus()
    type("Child Three", "3")
    await act(async () => { fireEvent.keyDown(el, { key: "Enter" }) })
    expect(save).toHaveBeenCalledWith(9, 3, "3")
  })
  it("shows an empty state with no children", () => {
    render(<ExamMarksForm examId={9} totalMarks="10" rows={[]} readOnly={false} />)
    expect(screen.getByText("No children enrolled in this class.")).toBeInTheDocument()
  })
})
