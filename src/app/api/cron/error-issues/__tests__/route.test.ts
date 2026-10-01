/** @jest-environment node */
// src/app/api/cron/error-issues/__tests__/route.test.ts
jest.mock("@/lib/errorDigest", () => ({ runErrorDigestLocked: jest.fn() }))
import { POST } from "../route"
import { runErrorDigestLocked } from "@/lib/errorDigest"

function req(auth?: string) {
  return new Request("http://x/api/cron/error-issues", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  })
}

describe("POST /api/cron/error-issues", () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; jest.clearAllMocks() })

  it("503 when CRON_SECRET unset", async () => {
    delete process.env.CRON_SECRET
    expect((await POST(req("Bearer x"))).status).toBe(503)
  })
  it("401 on bad bearer", async () => {
    process.env.CRON_SECRET = "s"
    expect((await POST(req("Bearer nope"))).status).toBe(401)
  })
  it("200 + result on good bearer", async () => {
    process.env.CRON_SECRET = "s"
    ;(runErrorDigestLocked as jest.Mock).mockResolvedValue({ filed: 1, skipped: 0, purged: 2 })
    const res = await POST(req("Bearer s"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ filed: 1, skipped: 0, purged: 2 })
    // Manual trigger shares the scheduler's lock but runs even if this week already ran.
    expect(runErrorDigestLocked).toHaveBeenCalledWith(expect.any(Date), { force: true })
  })
  it("409 when another digest run holds the lock", async () => {
    process.env.CRON_SECRET = "s"
    ;(runErrorDigestLocked as jest.Mock).mockResolvedValue("locked")
    expect((await POST(req("Bearer s"))).status).toBe(409)
  })
})
