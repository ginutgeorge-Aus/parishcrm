/** @jest-environment node */
// currentKeyId() (imported by envCheck) loads the keyring and would throw
// without an ENCRYPTION_KEY; collectEnvWarnings never calls it, but the module
// import does pull it in, so stub the module.
jest.mock("@/lib/crypto", () => ({ currentKeyId: () => "k1" }))

import { collectEnvErrors, collectEnvWarnings } from "@/lib/envCheck"

describe("collectEnvErrors — E2E_ALLOW_TEST_OVERRIDES prod guard", () => {
  const orig = { flag: process.env.E2E_ALLOW_TEST_OVERRIDES, url: process.env.AUTH_URL }
  const MSG = "E2E_ALLOW_TEST_OVERRIDES=true is not allowed"

  const restore = (key: keyof typeof orig, envKey: string) => {
    if (orig[key] === undefined) delete process.env[envKey]
    else process.env[envKey] = orig[key] as string
  }
  afterEach(() => {
    restore("flag", "E2E_ALLOW_TEST_OVERRIDES")
    restore("url", "AUTH_URL")
  })

  it("hard-fails when the flag is set and AUTH_URL is the real prod domain", () => {
    process.env.E2E_ALLOW_TEST_OVERRIDES = "true"
    process.env.AUTH_URL = "https://app.example.org"
    expect(collectEnvErrors().some((e) => e.startsWith(MSG))).toBe(true)
  })

  it("does NOT fail for the e2e suite (flag set, AUTH_URL localhost)", () => {
    process.env.E2E_ALLOW_TEST_OVERRIDES = "true"
    process.env.AUTH_URL = "http://localhost:3000"
    expect(collectEnvErrors().some((e) => e.startsWith(MSG))).toBe(false)
  })

  it("does NOT fail when the flag is unset even on the prod domain", () => {
    delete process.env.E2E_ALLOW_TEST_OVERRIDES
    process.env.AUTH_URL = "https://app.example.org"
    expect(collectEnvErrors().some((e) => e.startsWith(MSG))).toBe(false)
  })

  // fail-closed on ANY non-loopback host, not just the one known prod
  // domain — a custom/migrated/misconfigured prod host must not boot with the flag.
  it("hard-fails for a custom/migrated non-loopback prod host", () => {
    process.env.E2E_ALLOW_TEST_OVERRIDES = "true"
    process.env.AUTH_URL = "https://crm.migrated-host.org"
    expect(collectEnvErrors().some((e) => e.startsWith(MSG))).toBe(true)
  })

  it("does NOT fail for a loopback IP AUTH_URL (local dev)", () => {
    process.env.E2E_ALLOW_TEST_OVERRIDES = "true"
    process.env.AUTH_URL = "http://127.0.0.1:3000"
    expect(collectEnvErrors().some((e) => e.startsWith(MSG))).toBe(false)
  })
})

describe("collectEnvWarnings — E2E_ALLOW_TEST_OVERRIDES prod warning", () => {
  const orig = { flag: process.env.E2E_ALLOW_TEST_OVERRIDES, node: process.env.NODE_ENV }
  const has = () => collectEnvWarnings().some((w) => w.includes("E2E_ALLOW_TEST_OVERRIDES=true is set under NODE_ENV=production"))
  const setNodeEnv = (v: string | undefined) =>
    Object.defineProperty(process.env, "NODE_ENV", { value: v, configurable: true })

  afterEach(() => {
    if (orig.flag === undefined) delete process.env.E2E_ALLOW_TEST_OVERRIDES
    else process.env.E2E_ALLOW_TEST_OVERRIDES = orig.flag
    setNodeEnv(orig.node)
  })

  it("warns when the flag is set under NODE_ENV=production", () => {
    process.env.E2E_ALLOW_TEST_OVERRIDES = "true"
    setNodeEnv("production")
    expect(has()).toBe(true)
  })

  it("does not warn when the flag is unset", () => {
    delete process.env.E2E_ALLOW_TEST_OVERRIDES
    setNodeEnv("production")
    expect(has()).toBe(false)
  })
})

describe("collectEnvWarnings — CRON_SECRET", () => {
  const orig = process.env.CRON_SECRET

  afterEach(() => {
    if (orig === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = orig
  })

  it("warns when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET
    const warnings = collectEnvWarnings()
    expect(warnings.some((w) => w.includes("CRON_SECRET is not set"))).toBe(true)
  })

  it("does not warn when CRON_SECRET is set", () => {
    process.env.CRON_SECRET = "s3cret"
    const warnings = collectEnvWarnings()
    expect(warnings.some((w) => w.includes("CRON_SECRET"))).toBe(false)
  })
})

describe("collectEnvErrors — regional config validation", () => {
  const orig = process.env.APP_FY_START_MONTH
  afterEach(() => {
    if (orig === undefined) delete process.env.APP_FY_START_MONTH
    else process.env.APP_FY_START_MONTH = orig
    jest.resetModules()
  })

  it("reports an invalid APP_FY_START_MONTH", () => {
    process.env.APP_FY_START_MONTH = "13"
    jest.resetModules()
    const { collectEnvErrors: fresh } = require("@/lib/envCheck")
    expect(fresh().some((e: string) => /FY_START_MONTH/.test(e))).toBe(true)
  })

  it("does not report when APP_FY_START_MONTH is unset (default)", () => {
    delete process.env.APP_FY_START_MONTH
    jest.resetModules()
    const { collectEnvErrors: fresh } = require("@/lib/envCheck")
    expect(fresh().some((e: string) => /FY_START_MONTH/.test(e))).toBe(false)
  })
})

describe("collectEnvWarnings — Turnstile key pairing", () => {
  const orig = { secret: process.env.TURNSTILE_SECRET_KEY, site: process.env.TURNSTILE_SITE_KEY }

  afterEach(() => {
    for (const [k, v] of [["TURNSTILE_SECRET_KEY", orig.secret], ["TURNSTILE_SITE_KEY", orig.site]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it("warns when the secret is set but the site key is not (server demands a token no widget can produce)", () => {
    process.env.TURNSTILE_SECRET_KEY = "secret"
    delete process.env.TURNSTILE_SITE_KEY
    expect(collectEnvWarnings().some((w) => w.includes("TURNSTILE_SITE_KEY is not set"))).toBe(true)
  })

  it("accepts the deprecated NEXT_PUBLIC_TURNSTILE_SITE_KEY as the site key", () => {
    process.env.TURNSTILE_SECRET_KEY = "secret"
    delete process.env.TURNSTILE_SITE_KEY
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "legacy"
    try {
      expect(collectEnvWarnings().some((w) => w.includes("TURNSTILE"))).toBe(false)
    } finally {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    }
  })

  it("does not warn when both or neither are set", () => {
    process.env.TURNSTILE_SECRET_KEY = "secret"
    process.env.TURNSTILE_SITE_KEY = "site"
    expect(collectEnvWarnings().some((w) => w.includes("TURNSTILE"))).toBe(false)
    delete process.env.TURNSTILE_SECRET_KEY
    delete process.env.TURNSTILE_SITE_KEY
    expect(collectEnvWarnings().some((w) => w.includes("TURNSTILE"))).toBe(false)
  })
})
