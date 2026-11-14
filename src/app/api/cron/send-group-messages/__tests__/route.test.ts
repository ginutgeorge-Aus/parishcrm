/** @jest-environment node */
// src/app/api/cron/send-group-messages/__tests__/route.test.ts
jest.mock("@/lib/groupMessageDeliver", () => ({ runGroupMessageSweep: jest.fn() }))
import { POST } from "../route"
import { runGroupMessageSweep } from "@/lib/groupMessageDeliver"

function req(auth?: string) {
  return new Request("http://x/api/cron/send-group-messages", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  })
}

describe("POST /api/cron/send-group-messages", () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; jest.clearAllMocks(); jest.restoreAllMocks() })

  it("503 when CRON_SECRET unset", async () => {
    delete process.env.CRON_SECRET
    jest.spyOn(console, "error").mockImplementation(() => {})
    expect((await POST(req("Bearer x"))).status).toBe(503)
    expect(runGroupMessageSweep).not.toHaveBeenCalled()
  })
  it("401 on missing or bad bearer", async () => {
    process.env.CRON_SECRET = "s"
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("Bearer nope"))).status).toBe(401)
    expect(runGroupMessageSweep).not.toHaveBeenCalled()
  })
  it("200 + counts on good bearer", async () => {
    process.env.CRON_SECRET = "s"
    ;(runGroupMessageSweep as jest.Mock).mockResolvedValue({ sent: 2, failed: 0, unknown: 0, inFlight: 0, messages: 1 })
    const res = await POST(req("Bearer s"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 2, failed: 0, unknown: 0, inFlight: 0, messages: 1 })
  })
  it("500 with a tagged log when the sweep throws", async () => {
    process.env.CRON_SECRET = "s"
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    ;(runGroupMessageSweep as jest.Mock).mockRejectedValue(new Error("boom"))
    expect((await POST(req("Bearer s"))).status).toBe(500)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[send-group-messages]"))
  })
})
