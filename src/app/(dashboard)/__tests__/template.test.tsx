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
})
