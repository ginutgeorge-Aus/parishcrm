/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }))

import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { rateLimit } from "@/lib/rateLimit"
import { guardAccountingExport } from "@/lib/reports/exportGuard"

const mockAuth = auth as unknown as jest.Mock
const mockRateLimit = rateLimit as jest.Mock

async function status(key = "trial-balance") {
  const r = await guardAccountingExport(key)
  return r instanceof NextResponse ? r.status : r
}

describe("guardAccountingExport", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRateLimit.mockReturnValue(true)
  })

  it("401s without a session", async () => {
    mockAuth.mockResolvedValue(null)
    expect(await status()).toBe(401)
  })

  it("403s for a role without accounting view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "7", role: "VIEWER" } })
    expect(await status()).toBe(403)
  })

  it("429s when rate-limited, keyed per report and actor", async () => {
    mockAuth.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    mockRateLimit.mockReturnValue(false)
    expect(await status("cash-flow")).toBe(429)
    expect(mockRateLimit).toHaveBeenCalledWith("export:cash-flow:7", 10, 60_000)
  })

  it("returns the actor id when allowed", async () => {
    mockAuth.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    expect(await status()).toEqual({ actor: 7 })
  })
})
