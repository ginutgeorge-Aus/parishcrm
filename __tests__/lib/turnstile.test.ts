/** @jest-environment node */
import { verifyTurnstile, isTurnstileEnabled } from "@/lib/turnstile"

const origSecret = process.env.TURNSTILE_SECRET_KEY
afterEach(() => {
  if (origSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY
  else process.env.TURNSTILE_SECRET_KEY = origSecret
  jest.restoreAllMocks()
})

describe("verifyTurnstile", () => {
  it("is disabled and bypasses (returns true) when TURNSTILE_SECRET_KEY is unset", async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    expect(isTurnstileEnabled()).toBe(false)
    expect(await verifyTurnstile(undefined)).toBe(true)
  })

  it("fails closed on a missing token when enabled", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk"
    expect(isTurnstileEnabled()).toBe(true)
    expect(await verifyTurnstile(undefined)).toBe(false)
    expect(await verifyTurnstile("")).toBe(false)
  })

  it("returns true when Cloudflare reports success", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk"
    jest.spyOn(global, "fetch").mockResolvedValue(
      { ok: true, json: async () => ({ success: true }) } as Response,
    )
    expect(await verifyTurnstile("tok", "1.2.3.4")).toBe(true)
  })

  it("returns false when Cloudflare reports failure", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk"
    jest.spyOn(global, "fetch").mockResolvedValue(
      { ok: true, json: async () => ({ success: false }) } as Response,
    )
    expect(await verifyTurnstile("tok")).toBe(false)
  })

  it("fails closed on a non-ok HTTP response", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk"
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false } as Response)
    expect(await verifyTurnstile("tok")).toBe(false)
  })

  it("fails closed on a network error", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk"
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("net"))
    expect(await verifyTurnstile("tok")).toBe(false)
  })

  it("sends a timeout AbortSignal so a hung siteverify can't pin the worker", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk"
    const spy = jest.spyOn(global, "fetch").mockResolvedValue(
      { ok: true, json: async () => ({ success: true }) } as Response,
    )
    await verifyTurnstile("tok")
    expect(spy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
