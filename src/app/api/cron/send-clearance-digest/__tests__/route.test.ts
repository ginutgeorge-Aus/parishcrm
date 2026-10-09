/** @jest-environment node */
// src/app/api/cron/send-clearance-digest/__tests__/route.test.ts
jest.mock("@/lib/clearanceDigest", () => ({ runClearanceDigestLocked: jest.fn() }))
import { POST } from "../route"
import { runClearanceDigestLocked } from "@/lib/clearanceDigest"

/** Builds a POST request with an optional Authorization header. */
function req(auth?: string) {
  return new Request("http://x/api/cron/send-clearance-digest", {
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
  it("200 + counts on a good bearer, forcing past this month's marker", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue({ flagged: 3, sent: 2, failed: 0 })
    const res = await POST(req("Bearer s"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ flagged: 3, sent: 2, failed: 0 })
    expect(runClearanceDigestLocked).toHaveBeenCalledWith(expect.any(Date), { force: true })
  })
  it("409 when another run holds the lease", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue("locked")
    expect((await POST(req("Bearer s"))).status).toBe(409)
  })
})
