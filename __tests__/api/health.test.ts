/** @jest-environment node */
import { prisma } from "@/lib/prisma"
import { GET } from "@/app/api/health/route"

jest.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: jest.fn() },
}))

const mockQueryRaw = prisma.$queryRaw as jest.Mock

describe("GET /api/health", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }])
  })

  it("returns 200 with status ok when DB reachable", async () => {
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
  })

  it("does not expose version or db detail to unauthenticated callers", async () => {
    const res = await GET()
    const body = await res.json()
    expect(body).not.toHaveProperty("version")
    expect(body).not.toHaveProperty("db")
  })

  it("returns 503 when DB unreachable", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused"))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.status).toBe("error")
    expect(body).not.toHaveProperty("db")
  })

  it("does not leak the DB error detail in the response body", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused at 10.0.0.5:5432"))
    const res = await GET()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain("10.0.0.5")
  })
})
