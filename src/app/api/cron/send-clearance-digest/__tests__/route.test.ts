/** @jest-environment node */
// src/app/api/cron/send-clearance-digest/__tests__/route.test.ts
jest.mock("@/lib/clearanceDigest", () => ({ runClearanceDigestLocked: jest.fn() }))
import { POST } from "../route"
import { runClearanceDigestLocked } from "@/lib/clearanceDigest"

/** Builds a POST request with an optional Authorization header. */
function req(auth?: string, query = "") {
  return new Request(`http://x/api/cron/send-clearance-digest${query}`, {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  })
}

describe("POST /api/cron/send-clearance-digest", () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; jest.clearAllMocks() })

  it("503 when CRON_SECRET unset", async () => {
    delete process.env.CRON_SECRET
    expect((await POST(req("Bearer x"))).status).toBe(503)
    expect(runClearanceDigestLocked).not.toHaveBeenCalled()
  })
  it("401 with no or a bad bearer", async () => {
    process.env.CRON_SECRET = "s"
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("Bearer nope"))).status).toBe(401)
    expect(runClearanceDigestLocked).not.toHaveBeenCalled()
  })
  it("200 + counts on a good bearer, respecting this month's marker by default", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue({ flagged: 3, sent: 2, failed: 0 })
    const res = await POST(req("Bearer s"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ flagged: 3, sent: 2, failed: 0 })
    expect(runClearanceDigestLocked).toHaveBeenCalledWith(expect.any(Date), { force: false })
  })
  it("200 already-sent (and no resend) when this month already went out", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue("done")
    const res = await POST(req("Bearer s"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "already-sent", month: expect.stringMatching(/^\d{4}-\d{2}$/) })
  })
  it("?force=1 passes force through to resend", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue({ flagged: 1, sent: 1, failed: 0 })
    await POST(req("Bearer s", "?force=1"))
    expect(runClearanceDigestLocked).toHaveBeenCalledWith(expect.any(Date), { force: true })
    await POST(req("Bearer s", "?force=0"))
    expect(runClearanceDigestLocked).toHaveBeenLastCalledWith(expect.any(Date), { force: false })
  })
  it("409 when another run holds the lease", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue("locked")
    expect((await POST(req("Bearer s"))).status).toBe(409)
  })
})
