/** @jest-environment node */
jest.mock("@/lib/groupMessageDeliver", () => ({ runGroupMessageSweep: jest.fn() }))
import { POST } from "../route"
import { runGroupMessageSweep } from "@/lib/groupMessageDeliver"

/** Builds a POST request with an optional Authorization header. */
function req(auth?: string) {
  return new Request("http://x/api/cron/send-group-messages", { method: "POST", headers: auth ? { authorization: auth } : {} })
}

describe("POST /api/cron/send-group-messages", () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; jest.clearAllMocks() })

  it("503 when CRON_SECRET unset", async () => {
    delete process.env.CRON_SECRET
    expect((await POST(req("Bearer x"))).status).toBe(503)
    expect(runGroupMessageSweep).not.toHaveBeenCalled()
  })
  it("401 with no or a bad bearer", async () => {
    process.env.CRON_SECRET = "s"
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("Bearer nope"))).status).toBe(401)
    expect(runGroupMessageSweep).not.toHaveBeenCalled()
  })
  it("200 + counts on a good bearer", async () => {
    process.env.CRON_SECRET = "s"
    ;(runGroupMessageSweep as jest.Mock).mockResolvedValue({ sent: 2, failed: 0, unknown: 0, inFlight: 0, messages: 1, closed: 0 })
    const res = await POST(req("Bearer s"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 2, messages: 1 })
    expect(runGroupMessageSweep).toHaveBeenCalledWith(expect.any(Date))
  })
})
