/**
 * @jest-environment jsdom
 */
import React from "react"
import { render, screen } from "@testing-library/react"

jest.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { EventAnalytics } from "@/components/events/EventAnalytics"

describe("EventAnalytics", () => {
  it("renders fill-rate, revenue, and time sections with data", () => {
    render(
      <EventAnalytics
        fillRates={[{ name: "Adult", sold: 50, capacity: 100, pct: 50 }]}
        revenueByType={[{ name: "Adult", revenue: 500 }]}
        regsOverTime={[{ date: "2026-07-01", cumulative: 1 }]}
      />
    )
    expect(screen.getByText("Fill Rate")).toBeInTheDocument()
    expect(screen.getByText("Revenue by Ticket")).toBeInTheDocument()
    expect(screen.getByTestId("area-chart")).toBeInTheDocument()
    expect(screen.queryByText("No cap")).not.toBeInTheDocument()
  })

  it("shows 'No cap' for null-capacity ticket types", () => {
    render(
      <EventAnalytics
        fillRates={[{ name: "Free", sold: 5, capacity: null, pct: null }]}
        revenueByType={[]}
        regsOverTime={[{ date: "2026-07-01", cumulative: 5 }]}
      />
    )
    expect(screen.getByText(/No cap/)).toBeInTheDocument()
  })

  it("returns null when there is nothing to show", () => {
    const { container } = render(
      <EventAnalytics fillRates={[]} revenueByType={[]} regsOverTime={[]} />
    )
    expect(container.firstChild).toBeNull()
  })
})
