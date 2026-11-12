import { render, screen } from "@testing-library/react"

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock("@/lib/actions/sundaySchoolExam", () => ({ setExamScore: jest.fn() }))

import { ExamMarksForm } from "@/components/sunday-school/ExamMarksForm"

const rows = [
  { personId: 1, name: "Child One", score: "7.5" },
  { personId: 2, name: "Child Two", score: "0" },
  { personId: 3, name: "Child Three", score: null },
]

describe("ExamMarksForm", () => {
  it("renders one row per child with / total; blank = not marked, 0 is a mark", () => {
    render(<ExamMarksForm examId={1} totalMarks="10" rows={rows} readOnly={false} />)
    expect(screen.getAllByRole("textbox")).toHaveLength(3)
    expect(screen.getAllByText("/ 10")).toHaveLength(3)
    expect(screen.getByLabelText("Score for Child One")).toHaveValue("7.5")
    expect(screen.getByLabelText("Score for Child Two")).toHaveValue("0")
    expect(screen.getByLabelText("Score for Child Three")).toHaveValue("")
  })
  it("read-only shows text, no inputs", () => {
    render(<ExamMarksForm examId={1} totalMarks="10" rows={rows} readOnly />)
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByText("7.5 / 10")).toBeInTheDocument()
    expect(screen.getByText("0 / 10")).toBeInTheDocument()
    expect(screen.getByText("Not marked")).toBeInTheDocument()
  })
})
