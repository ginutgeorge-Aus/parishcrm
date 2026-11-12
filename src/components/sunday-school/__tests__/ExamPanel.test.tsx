import { render, screen } from "@testing-library/react"

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock("@/lib/actions/sundaySchoolExam", () => ({ createExam: jest.fn(), archiveExam: jest.fn() }))

import { ExamPanel } from "@/components/sunday-school/ExamPanel"

const exams = [{ id: 5, name: "Term 2 Bible", date: "2026-06-14", totalMarks: "50", marked: 2 }]

describe("ExamPanel", () => {
  it("lists exams with a marks link and offers add/archive when editable", () => {
    render(<ExamPanel classId={1} year={2026} exams={exams} enrolledCount={3} hrefBase="/sunday-school/1/exams" readOnly={false} />)
    expect(screen.getByRole("link", { name: /Term 2 Bible/ })).toHaveAttribute("href", "/sunday-school/1/exams/5")
    expect(screen.getByText(/out of 50 · 2 of 3 marked/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add exam" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument()
  })
  it("is view-only when read-only", () => {
    render(<ExamPanel classId={1} year={2026} exams={exams} enrolledCount={3} hrefBase="/sunday-school/1/exams" readOnly />)
    expect(screen.getByRole("link", { name: /Term 2 Bible/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add exam" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
  })
})
