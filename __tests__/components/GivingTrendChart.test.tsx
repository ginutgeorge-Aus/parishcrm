/**
 * @jest-environment jsdom
 */
import React from "react"
import { render, screen } from "@testing-library/react"

jest.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
}))

import { GivingTrendChart } from "@/components/accounting/GivingTrendChart"

const MONTHS = ["JUL","AUG","SEP","OCT","NOV","DEC","JAN","FEB","MAR","APR","MAY","JUN"]

describe("GivingTrendChart", () => {
  it("renders bar chart when data has non-zero values", () => {
    const data = MONTHS.map((month, i) => ({ month, amount: i === 0 ? 100 : 0 }))
    render(<GivingTrendChart data={data} />)
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument()
  })

  it("returns null when all amounts are zero", () => {
    const data = MONTHS.map((month) => ({ month, amount: 0 }))
    const { container } = render(<GivingTrendChart data={data} />)
    expect(container.firstChild).toBeNull()
  })

  it("exposes an accessible name summarizing the trend", () => {
    const data = MONTHS.map((month, i) => ({ month, amount: i === 0 ? 100 : 0 }))
    render(<GivingTrendChart data={data} />)
    const chart = screen.getByRole("img")
    expect(chart).toHaveAccessibleName(/monthly giving trend from jul to jun/i)
    expect(chart).toHaveAccessibleName(/\$100/)
  })
})
