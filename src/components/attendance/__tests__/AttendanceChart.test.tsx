import { render, screen } from "@testing-library/react"

// Stub recharts so jsdom (zero-size) still renders: each primitive exposes its
// props as JSON so the tests can assert what the chart is fed.
jest.mock("recharts", () => {
  const stub = (name: string) =>
    function Stub(props: Record<string, unknown>) {
      const { children, data, ...rest } = props
      return (
        <div data-testid={name} data-props={JSON.stringify(rest)} data-data={data ? JSON.stringify(data) : undefined}>
          {children as React.ReactNode}
        </div>
      )
    }
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    BarChart: stub("BarChart"),
    LineChart: stub("LineChart"),
    Bar: stub("Bar"),
    Line: stub("Line"),
    XAxis: stub("XAxis"),
    YAxis: stub("YAxis"),
    CartesianGrid: stub("CartesianGrid"),
    Tooltip: stub("Tooltip"),
    Legend: stub("Legend"),
  }
})
jest.mock("@/components/NonceProvider", () => ({ useNonce: () => undefined }))

import { AttendanceChart } from "../AttendanceChart"
import { YearOverYearChart } from "../YearOverYearChart"

const pts = [
  { key: "2026-11-02", label: "2 Nov", adults: 50, children: 10 },
  { key: "2026-11-09", label: "9 Nov", adults: null, children: null },
  { key: "2026-11-16", label: "16 Nov", adults: 0, children: 0 },
]

describe("AttendanceChart", () => {
  it("stacks adults and children and passes gaps through as null (0 stays 0)", () => {
    render(<AttendanceChart points={pts} />)
    const bars = screen.getAllByTestId("Bar").map((b) => JSON.parse(b.dataset.props!))
    expect(bars.map((b) => b.dataKey)).toEqual(["adults", "children"])
    expect(new Set(bars.map((b) => b.stackId)).size).toBe(1)
    const data = JSON.parse(screen.getByTestId("BarChart").dataset.data!)
    expect(data[1]).toMatchObject({ adults: null, children: null })
    expect(data[2]).toMatchObject({ adults: 0, children: 0 })
  })

  it("has an aria-label with the range and total", () => {
    render(<AttendanceChart points={pts} />)
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Attendance from 2 Nov to 16 Nov, total 60 across 2 recorded periods",
    )
  })

  it("shows an empty state when nothing is recorded", () => {
    render(<AttendanceChart points={pts.map((p) => ({ ...p, adults: null, children: null }))} />)
    expect(screen.getByText(/no headcounts recorded/i)).toBeInTheDocument()
    expect(screen.queryByTestId("BarChart")).not.toBeInTheDocument()
  })

  it("shows the empty state for no points", () => {
    render(<AttendanceChart points={[]} />)
    expect(screen.getByText(/no headcounts recorded/i)).toBeInTheDocument()
  })
})

describe("YearOverYearChart", () => {
  const data = [
    { period: 1, thisYear: 100, lastYear: null },
    { period: 2, thisYear: null, lastYear: 90 },
    { period: 3, thisYear: 0, lastYear: 0 },
  ]

  it("draws two lines that do not connect across gaps", () => {
    render(<YearOverYearChart data={data} year={2026} granularity="month" />)
    const lines = screen.getAllByTestId("Line").map((l) => JSON.parse(l.dataset.props!))
    expect(lines.map((l) => l.dataKey)).toEqual(["thisYear", "lastYear"])
    expect(lines.every((l) => l.connectNulls === false)).toBe(true)
    const chart = JSON.parse(screen.getByTestId("LineChart").dataset.data!)
    expect(chart[0].lastYear).toBeNull()
    expect(chart[2].thisYear).toBe(0)
  })

  it("labels the periods by month name or week number", () => {
    const { rerender } = render(<YearOverYearChart data={data} year={2026} granularity="month" />)
    expect(JSON.parse(screen.getByTestId("LineChart").dataset.data!)[0].label).toBe("Jan")
    rerender(<YearOverYearChart data={data} year={2026} granularity="week" />)
    expect(JSON.parse(screen.getByTestId("LineChart").dataset.data!)[0].label).toBe("W1")
  })

  it("has an aria-label and an empty state", () => {
    const { rerender } = render(<YearOverYearChart data={data} year={2026} granularity="month" />)
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("2026 compared with 2025"))
    rerender(
      <YearOverYearChart data={data.map((d) => ({ ...d, thisYear: null, lastYear: null }))} year={2026} granularity="month" />,
    )
    expect(screen.getByText(/no headcounts recorded/i)).toBeInTheDocument()
  })
})
