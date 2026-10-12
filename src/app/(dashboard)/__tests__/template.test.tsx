/** @jest-environment node */
const mockGet = jest.fn()
jest.mock("next/headers", () => ({ headers: async () => ({ get: mockGet }) }))
jest.mock("@/lib/routeViews", () => ({ recordRouteView: jest.fn() }))

import DashboardTemplate from "../template"
import { recordRouteView } from "@/lib/routeViews"

describe("DashboardTemplate route-view counter", () => {
  beforeEach(() => jest.clearAllMocks())

  it("records the route from x-pathname on every render (fires per navigation)", async () => {
    mockGet.mockReturnValue("/reports")
    await DashboardTemplate({ children: null })
    expect(recordRouteView).toHaveBeenCalledWith("/reports")
  })

  it("records nothing when x-pathname is absent", async () => {
    mockGet.mockReturnValue(null)
    await DashboardTemplate({ children: null })
    expect(recordRouteView).not.toHaveBeenCalled()
  })

  it("renders children when present (returns children in output)", async () => {
    mockGet.mockReturnValue(null)
    const testChild = <div data-testid="test-child" />
    const result = await DashboardTemplate({ children: testChild })
    
    // Server component returns JSX, which has children property
    expect(result?.props?.children).toBeDefined()
    expect(result?.props?.children).toBe(testChild)
  })

  it("renders multiple children nodes in fragment", async () => {
    mockGet.mockReturnValue("/dashboard")
    const children = (
      <>
        <div data-testid="child-1" />
        <div data-testid="child-2" />
      </>
    )
    
    const result = await DashboardTemplate({ children })
    
    // Verify template still calls recordRouteView
    expect(recordRouteView).toHaveBeenCalledWith("/dashboard")
    // Verify children are passed through
    expect(result?.props?.children).toBe(children)
  })
})
