import { act, fireEvent, render, screen } from "@testing-library/react"

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock("@/lib/actions/sundaySchoolExam", () => ({ createExam: jest.fn(), updateExam: jest.fn(), archiveExam: jest.fn() }))

import { ExamPanel } from "@/components/sunday-school/ExamPanel"

const exams = [{ id: 5, name: "Term 2 Bible", date: "2026-06-14", totalMarks: "50", marked: 2 }]

describe("ExamPanel", () => {
  it("lists exams with a marks link and offers add/archive when editable", () => {
    render(<ExamPanel classId={1} year={2026} exams={exams} enrolledCount={3} hrefBase="/sunday-school/1/exams" readOnly={false} />)
    expect(screen.getByRole("link", { name: /Term 2 Bible/ })).toHaveAttribute("href", "/sunday-school/1/exams/5")
    expect(screen.getByText(/out of 50 · 2 of 3 marked/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add exam" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument()
  })
  it("is view-only when read-only", () => {
    render(<ExamPanel classId={1} year={2026} exams={exams} enrolledCount={3} hrefBase="/sunday-school/1/exams" readOnly />)
    expect(screen.getByRole("link", { name: /Term 2 Bible/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add exam" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
  })
})

describe("ExamPanel edit", () => {
  const panel = () => render(<ExamPanel classId={1} year={2026} exams={exams} enrolledCount={3} hrefBase="/sunday-school/1/exams" readOnly={false} />)
  it("opens a prefilled form, calls updateExam and closes on success", async () => {
    const { updateExam } = jest.requireMock("@/lib/actions/sundaySchoolExam")
    ;(updateExam as jest.Mock).mockResolvedValue(undefined)
    panel()
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect((screen.getAllByLabelText("Name")[0] as HTMLInputElement).value).toBe("Term 2 Bible")
    fireEvent.change(screen.getAllByLabelText("Total marks")[0], { target: { value: "60" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })) })
    expect(updateExam).toHaveBeenCalledWith(5, undefined, expect.any(FormData))
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
  })
  it("keeps the form open and shows the error on a refused save", async () => {
    const { updateExam } = jest.requireMock("@/lib/actions/sundaySchoolExam")
    ;(updateExam as jest.Mock).mockResolvedValue({ error: "This class already has an exam with that name on that date" })
    panel()
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })) })
    expect(await screen.findByText(/already has an exam/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
  })
  it("keeps typed field values after a refused save", async () => {
    const { updateExam } = jest.requireMock("@/lib/actions/sundaySchoolExam")
    ;(updateExam as jest.Mock).mockResolvedValue({ error: "Total marks is below a score already entered" })
    panel()
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getAllByLabelText("Name")[0], { target: { value: "Renamed" } })
    fireEvent.change(screen.getAllByLabelText("Total marks")[0], { target: { value: "10" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })) })
    expect(await screen.findByText(/below a score/)).toBeInTheDocument()
    expect((screen.getAllByLabelText("Name")[0] as HTMLInputElement).value).toBe("Renamed")
    expect((screen.getAllByLabelText("Total marks")[0] as HTMLInputElement).value).toBe("10")
  })
})

describe("ExamPanel create feedback", () => {
  it("shows Exam added and clears the form after a successful create", async () => {
    const { createExam } = jest.requireMock("@/lib/actions/sundaySchoolExam")
    ;(createExam as jest.Mock).mockResolvedValue(undefined)
    render(<ExamPanel classId={1} year={2026} exams={[]} enrolledCount={0} hrefBase="/sunday-school/1/exams" readOnly={false} />)
    const name = screen.getByLabelText("Name") as HTMLInputElement
    fireEvent.change(name, { target: { value: "Term 3" } })
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-03-01" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add exam" })) })
    expect(await screen.findByText("Exam added")).toBeInTheDocument()
    expect(name.value).toBe("")
  })
})
