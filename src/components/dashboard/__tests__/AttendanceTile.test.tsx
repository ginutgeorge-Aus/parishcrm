import { render, screen } from "@testing-library/react"
import { AttendanceTile } from "../AttendanceTile"

const latest = (previousTotal: number | null) => ({
  date: "2026-11-08",
  serviceTypeId: 1,
  adults: 50,
  children: 12,
  previousTotal,
})

describe("AttendanceTile", () => {
  it("shows service, date, adults, children, total and links to trends", () => {
    render(<AttendanceTile latest={latest(null)} serviceName="Sunday Service" canEnter />)
    expect(screen.getByText("Sunday Service")).toBeInTheDocument()
    expect(screen.getByText("Sun 8 Nov 2026")).toBeInTheDocument()
    expect(screen.getByTestId("tile-total")).toHaveTextContent("62")
    expect(screen.getByText(/50 adults/)).toBeInTheDocument()
    expect(screen.getByText(/12 children/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /attendance trends/i })).toHaveAttribute("href", "/attendance/trends")
  })

  it("shows +12 versus last week", () => {
    render(<AttendanceTile latest={latest(50)} serviceName="Sunday" canEnter />)
    expect(screen.getByTestId("tile-delta")).toHaveTextContent("+12")
    expect(screen.getByTestId("tile-delta")).toHaveTextContent(/vs last week/i)
  })

  it("shows −5 (true minus sign) versus last week", () => {
    render(<AttendanceTile latest={latest(67)} serviceName="Sunday" canEnter />)
    expect(screen.getByTestId("tile-delta")).toHaveTextContent("−5")
  })

  it("shows no change text as 0 when equal", () => {
    render(<AttendanceTile latest={latest(62)} serviceName="Sunday" canEnter />)
    expect(screen.getByTestId("tile-delta")).toHaveTextContent("No change")
  })

  it("hides the delta when there is no previous headcount", () => {
    render(<AttendanceTile latest={latest(null)} serviceName="Sunday" canEnter />)
    expect(screen.queryByTestId("tile-delta")).not.toBeInTheDocument()
  })

  it("empty state links editors to the entry page", () => {
    render(<AttendanceTile latest={null} canEnter />)
    expect(screen.getByText("No headcounts yet")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /enter a headcount/i })).toHaveAttribute("href", "/attendance")
  })

  it("empty state has no entry link for viewers", () => {
    render(<AttendanceTile latest={null} canEnter={false} />)
    expect(screen.getByText("No headcounts yet")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /enter a headcount/i })).not.toBeInTheDocument()
  })
})
