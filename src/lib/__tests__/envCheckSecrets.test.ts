/** @jest-environment node */
// AUD-1-05: weak or .env.example placeholder secrets must fail boot in production.
jest.mock("@/lib/crypto", () => ({ currentKeyId: () => "k1" }))

import { collectEnvErrors } from "@/lib/envCheck"

const KEYS = ["AUTH_SECRET", "NEXTAUTH_SECRET", "CRON_SECRET", "SETUP_TOKEN", "E2E_ALLOW_TEST_OVERRIDES"] as const
const orig: Record<string, string | undefined> = { ...Object.fromEntries(KEYS.map((k) => [k, process.env[k]])), node: process.env.NODE_ENV }
const setNodeEnv = (v: string | undefined) =>
  Object.defineProperty(process.env, "NODE_ENV", { value: v, configurable: true })
const STRONG = "x".repeat(40)
const PLACEHOLDER = "generate-with-openssl-rand-base64-32"

beforeEach(() => {
  delete process.env.NEXTAUTH_SECRET
  delete process.env.CRON_SECRET
  delete process.env.SETUP_TOKEN
  delete process.env.E2E_ALLOW_TEST_OVERRIDES
  process.env.AUTH_SECRET = STRONG
  setNodeEnv("production")
})
afterEach(() => {
  for (const k of KEYS) {
    if (orig[k] === undefined) delete process.env[k]
    else process.env[k] = orig[k] as string
  }
  setNodeEnv(orig.node)
})

const errFor = (name: string) => collectEnvErrors().filter((e) => e.startsWith(name))

describe("collectEnvErrors — weak/placeholder secrets in production (AUD-1-05)", () => {
  it("rejects the .env.example AUTH_SECRET placeholder in production", () => {
    process.env.AUTH_SECRET = PLACEHOLDER
    expect(errFor("AUTH_SECRET").length).toBeGreaterThan(0)
  })
  it("rejects an AUTH_SECRET shorter than 32 chars in production", () => {
    process.env.AUTH_SECRET = "short-secret"
    expect(errFor("AUTH_SECRET").length).toBeGreaterThan(0)
  })
  it("accepts a strong AUTH_SECRET", () => {
    expect(errFor("AUTH_SECRET")).toEqual([])
  })
  it("does not enforce outside production", () => {
    setNodeEnv("test")
    process.env.AUTH_SECRET = "short"
    expect(errFor("AUTH_SECRET")).toEqual([])
  })
  it("does not enforce for the loopback e2e suite", () => {
    process.env.AUTH_SECRET = "short"
    process.env.E2E_ALLOW_TEST_OVERRIDES = "true"
    expect(errFor("AUTH_SECRET")).toEqual([])
  })
  it.each(["CRON_SECRET", "SETUP_TOKEN"])("rejects a weak %s when set, ignores it when unset", (name) => {
    expect(errFor(name)).toEqual([])
    process.env[name] = "short"
    expect(errFor(name).length).toBeGreaterThan(0)
    process.env[name] = PLACEHOLDER
    expect(errFor(name).length).toBeGreaterThan(0)
    process.env[name] = STRONG
    expect(errFor(name)).toEqual([])
  })
})
