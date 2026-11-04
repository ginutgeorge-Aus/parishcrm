import { stripeConfigured, getStripe } from "@/lib/stripe"

describe("stripe config", () => {
  const original = process.env.STRIPE_SECRET_KEY
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = original
  })

  it("stripeConfigured false when key unset", () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(stripeConfigured()).toBe(false)
  })

  it("stripeConfigured true when key set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x"
    expect(stripeConfigured()).toBe(true)
  })

  it("getStripe throws when key unset", () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(() => getStripe()).toThrow("Stripe not configured")
  })

  it("getStripe returns a memoized client when key set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x"
    expect(getStripe()).toBe(getStripe())
  })

  it("pins the API version of this client's own requests to the SDK constant", async () => {
    jest.resetModules()
    const ctor = jest.fn()
    jest.doMock("stripe", () => ({ __esModule: true, default: class { static API_VERSION = "test-api-version"; constructor(...a: unknown[]) { ctor(...a) } } }))
    process.env.STRIPE_SECRET_KEY = "sk_test_x"
    const mod = await import("@/lib/stripe")
    mod.getStripe()
    expect(ctor).toHaveBeenCalledWith("sk_test_x", expect.objectContaining({ apiVersion: "test-api-version" }))
    jest.dontMock("stripe")
    jest.resetModules()
  })
})
