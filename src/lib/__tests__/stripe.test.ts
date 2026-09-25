import { stripeConfigured, getStripe } from "@/lib/stripe"

describe("stripe config", () => {
  const original = process.env.STRIPE_SECRET_KEY
  afterEach(() => { process.env.STRIPE_SECRET_KEY = original })

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

  it("pins the Stripe API version so webhook payload shape can't drift", async () => {
    jest.resetModules()
    const ctor = jest.fn()
    jest.doMock("stripe", () => ({ __esModule: true, default: class { constructor(...a: unknown[]) { ctor(...a) } } }))
    process.env.STRIPE_SECRET_KEY = "sk_test_x"
    const mod = await import("@/lib/stripe")
    mod.getStripe()
    expect(ctor).toHaveBeenCalledWith("sk_test_x", expect.objectContaining({ apiVersion: "2026-06-24.dahlia" }))
    jest.dontMock("stripe")
    jest.resetModules()
  })
})
