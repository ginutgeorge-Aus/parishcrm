/** @jest-environment node */
import { createResendTransport, isResendAmbiguous } from "@/lib/resendTransport"

type FetchArgs = [string, { method: string; headers: Record<string, string>; body: string }]

const fetchMock = jest.fn<Promise<Response>, FetchArgs>()
const noSleep = async () => {}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const baseOpts = {
  from: '"Test Church" <noreply@church.test>',
  to: "a@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
}

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe("createResendTransport", () => {
  it("POSTs the message to the Resend API with bearer auth", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "msg_1" }))
    const t = createResendTransport("re_key", { sleep: noSleep })
    await t.sendMail(baseOpts)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer re_key")
    expect(init.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.parse(init.body)).toEqual({
      from: '"Test Church" <noreply@church.test>',
      to: ["a@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    })
  })

  it("splits a comma-separated recipient list", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "msg_1" }))
    await createResendTransport("k", { sleep: noSleep }).sendMail({ ...baseOpts, to: "a@x.com, b@y.com" })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual(["a@x.com", "b@y.com"])
  })

  it("base64-encodes attachments", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "msg_1" }))
    await createResendTransport("k", { sleep: noSleep }).sendMail({
      ...baseOpts,
      attachments: [
        { filename: "r.pdf", content: Buffer.from("PDF"), contentType: "application/pdf" },
        { filename: "n.txt", content: "note", contentType: "text/plain" },
      ],
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).attachments).toEqual([
      { filename: "r.pdf", content: Buffer.from("PDF").toString("base64"), content_type: "application/pdf" },
      { filename: "n.txt", content: Buffer.from("note").toString("base64"), content_type: "text/plain" },
    ])
  })

  it("retries 429 and 5xx with the SAME idempotency key", async () => {
    fetchMock
      .mockResolvedValueOnce(json(429, { name: "rate_limit_exceeded", message: "slow down" }))
      .mockResolvedValueOnce(json(503, { name: "internal_server_error", message: "x" }))
      .mockResolvedValueOnce(json(200, { id: "msg_1" }))
    await createResendTransport("k", { sleep: noSleep }).sendMail(baseOpts)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const keys = fetchMock.mock.calls.map((c) => c[1].headers["Idempotency-Key"])
    expect(new Set(keys).size).toBe(1)
  })

  it("uses a fresh idempotency key per message", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "msg_1" }))
    const t = createResendTransport("k", { sleep: noSleep })
    await t.sendMail(baseOpts)
    await t.sendMail(baseOpts)
    const [k1, k2] = fetchMock.mock.calls.map((c) => c[1].headers["Idempotency-Key"])
    expect(k1).not.toBe(k2)
  })

  it("retries network errors, then fails as ambiguous", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    const err = await createResendTransport("k", { sleep: noSleep }).sendMail(baseOpts).catch((e) => e)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(isResendAmbiguous(err)).toBe(true)
  })

  it("does not retry a permanent 4xx and never echoes the API message", async () => {
    fetchMock.mockResolvedValue(
      json(422, { name: "validation_error", message: "Invalid `to` field: a@example.com" }),
    )
    const err = await createResendTransport("k", { sleep: noSleep }).sendMail(baseOpts).catch((e) => e)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain("422")
    expect(err.message).toContain("validation_error")
    expect(err.message).not.toContain("a@example.com")
    expect(isResendAmbiguous(err)).toBe(false)
  })

  it("exhausted 5xx is a failure, not ambiguous", async () => {
    fetchMock.mockResolvedValue(json(500, { name: "internal_server_error" }))
    const err = await createResendTransport("k", { sleep: noSleep }).sendMail(baseOpts).catch((e) => e)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(err.message).toContain("500")
    expect(isResendAmbiguous(err)).toBe(false)
  })
})
