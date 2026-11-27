/** @jest-environment node */
// Route-level tests for the public Stripe webhook (StMarkCRM#3331): the
// oversize guard, raw-body/signature hand-off and status passthrough.
// handleStripeWebhook itself is covered in stripeCheckout.webhook.test.ts.
const mockHandle = jest.fn()
jest.mock("@/lib/stripeCheckout", () => ({ handleStripeWebhook: (...a: unknown[]) => mockHandle(...a) }))

import { POST } from "../route"

/**
 * Builds a webhook POST request.
 * @param body raw request body
 * @param headers extra headers (e.g. stripe-signature, content-length)
 */
function req(body: string, headers: Record<string, string> = {}): Request {
  // The route fails closed without content-length, so supply the real one.
  const h = { "content-length": String(Buffer.byteLength(body)), ...headers }
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: h })
}

beforeEach(() => jest.clearAllMocks())

it("returns 413 and never calls the handler when content-length exceeds the cap", async () => {
  const res = await POST(req("{}", { "content-length": String(300 * 1024) }))
  expect(res.status).toBe(413)
  expect(mockHandle).not.toHaveBeenCalled()
})

it("returns 413 when content-length is absent (fails closed)", async () => {
  const res = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}", headers: { "transfer-encoding": "chunked" } }))
  expect(res.status).toBe(413)
  expect(mockHandle).not.toHaveBeenCalled()
})

it("passes the exact raw body and signature header to the handler", async () => {
  mockHandle.mockResolvedValue({ status: 200 })
  const raw = '{"id":"evt_1",  "spaced":true}'
  const res = await POST(req(raw, { "stripe-signature": "t=1,v1=abc" }))
  expect(mockHandle).toHaveBeenCalledWith(raw, "t=1,v1=abc")
  expect(res.status).toBe(200)
})

it("passes a null signature when the header is absent", async () => {
  mockHandle.mockResolvedValue({ status: 400 })
  const res = await POST(req("{}"))
  expect(mockHandle).toHaveBeenCalledWith("{}", null)
  expect(res.status).toBe(400)
})

it.each([200, 400, 500])("relays handler status %i with an empty body", async (status) => {
  mockHandle.mockResolvedValue({ status })
  const res = await POST(req("{}", { "stripe-signature": "s" }))
  expect(res.status).toBe(status)
  expect(await res.text()).toBe("")
})
