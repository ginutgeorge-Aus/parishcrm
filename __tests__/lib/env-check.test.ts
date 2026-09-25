/** @jest-environment node */
import { collectEnvErrors, collectEnvWarnings, assertRequiredEnv } from "@/lib/envCheck"

const VALID_KEY = Buffer.alloc(32).toString("base64")

const VARS = [
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "AUTH_URL",
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_V1",
  "ENCRYPTION_KEY_V2",
  "ENCRYPTION_KEY_ID",
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "DISABLE_OTP",
  "WEBSITE_SYNC_URL",
  "WEBSITE_SYNC_SECRET",
  "CHURCH_NAME",
  "CONTAINER_APP_REPLICA_COUNT",
  "CRON_SECRET",
] as const

describe("env-check", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v]
      delete process.env[v]
    }
    // Baseline: everything valid, OTP enabled
    process.env.AUTH_SECRET = "secret"
    process.env.AUTH_URL = "http://localhost:3000"
    process.env.DATABASE_URL = "postgresql://localhost/db"
    process.env.ENCRYPTION_KEY = VALID_KEY
    process.env.GMAIL_USER = "a@b.com"
    process.env.GMAIL_APP_PASSWORD = "pass"
    process.env.CRON_SECRET = "cron-secret"
  })

  afterAll(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v]
      else process.env[v] = saved[v]
    }
  })

  it("returns no errors when all required vars are valid", () => {
    expect(collectEnvErrors()).toEqual([])
  })

  it("flags missing AUTH_SECRET", () => {
    delete process.env.AUTH_SECRET
    expect(collectEnvErrors().join()).toMatch(/AUTH_SECRET/)
  })

  it("accepts NEXTAUTH_SECRET as AUTH_SECRET fallback (half-renamed env)", () => {
    delete process.env.AUTH_SECRET
    process.env.NEXTAUTH_SECRET = "legacy"
    expect(collectEnvErrors()).toEqual([])
  })

  it("flags missing AUTH_URL (load-bearing for reset/invite/checkout links)", () => {
    delete process.env.AUTH_URL
    expect(collectEnvErrors().join()).toMatch(/AUTH_URL/)
  })

  it("flags missing DATABASE_URL", () => {
    delete process.env.DATABASE_URL
    expect(collectEnvErrors().join()).toMatch(/DATABASE_URL/)
  })

  it("flags missing ENCRYPTION_KEY", () => {
    delete process.env.ENCRYPTION_KEY
    expect(collectEnvErrors().join()).toMatch(/ENCRYPTION_KEY/)
  })

  it("flags wrong-length ENCRYPTION_KEY", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64")
    expect(collectEnvErrors().join()).toMatch(/32 bytes/)
  })

  it("flags missing GMAIL creds when OTP is enabled", () => {
    delete process.env.GMAIL_USER
    expect(collectEnvErrors().join()).toMatch(/GMAIL_USER/)
  })

  it("does not require GMAIL creds when DISABLE_OTP=true (dev/e2e)", () => {
    process.env.DISABLE_OTP = "true"
    delete process.env.GMAIL_USER
    delete process.env.GMAIL_APP_PASSWORD
    expect(collectEnvErrors()).toEqual([])
  })

  it("flags DISABLE_OTP=true in production", () => {
    const env = process.env as Record<string, string | undefined>
    const prevNodeEnv = env.NODE_ENV
    try {
      env.NODE_ENV = "production"
      env.DISABLE_OTP = "true"
      expect(collectEnvErrors().join()).toMatch(/DISABLE_OTP/)
    } finally {
      env.NODE_ENV = prevNodeEnv
    }
  })

  it("allows DISABLE_OTP=true outside production", () => {
    process.env.DISABLE_OTP = "true"
    expect(collectEnvErrors()).toEqual([])
  })

  it("allows DISABLE_OTP=true in production build with explicit E2E_ALLOW_TEST_OVERRIDES (playwright webServer)", () => {
    const env = process.env as Record<string, string | undefined>
    const prevNodeEnv = env.NODE_ENV
    const prevAllow = env.E2E_ALLOW_TEST_OVERRIDES
    try {
      env.NODE_ENV = "production"
      env.DISABLE_OTP = "true"
      env.E2E_ALLOW_TEST_OVERRIDES = "true"
      expect(collectEnvErrors()).toEqual([])
    } finally {
      env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete env.E2E_ALLOW_TEST_OVERRIDES
      else env.E2E_ALLOW_TEST_OVERRIDES = prevAllow
    }
  })

  it("flags AUTH_SECRET and NEXTAUTH_SECRET set to different values", () => {
    process.env.AUTH_SECRET = "one"
    process.env.NEXTAUTH_SECRET = "two"
    expect(collectEnvErrors().join()).toMatch(/AUTH_SECRET and NEXTAUTH_SECRET/)
  })

  it("accepts AUTH_SECRET and NEXTAUTH_SECRET set to the same value", () => {
    process.env.AUTH_SECRET = "same"
    process.env.NEXTAUTH_SECRET = "same"
    expect(collectEnvErrors()).toEqual([])
  })

  it("flags E2E_MOCK_EMAIL=true in production", () => {
    const env = process.env as Record<string, string | undefined>
    const prev = { node: env.NODE_ENV, mock: env.E2E_MOCK_EMAIL }
    try {
      env.NODE_ENV = "production"
      env.E2E_MOCK_EMAIL = "true"
      expect(collectEnvErrors().join()).toMatch(/E2E_MOCK_EMAIL/)
    } finally {
      env.NODE_ENV = prev.node
      if (prev.mock === undefined) delete env.E2E_MOCK_EMAIL
      else env.E2E_MOCK_EMAIL = prev.mock
    }
  })

  it("allows E2E_MOCK_EMAIL=true in a prod build with E2E_ALLOW_TEST_OVERRIDES (playwright)", () => {
    const env = process.env as Record<string, string | undefined>
    const prev = { node: env.NODE_ENV, mock: env.E2E_MOCK_EMAIL, allow: env.E2E_ALLOW_TEST_OVERRIDES }
    try {
      env.NODE_ENV = "production"
      env.E2E_MOCK_EMAIL = "true"
      env.E2E_ALLOW_TEST_OVERRIDES = "true"
      expect(collectEnvErrors()).toEqual([])
    } finally {
      env.NODE_ENV = prev.node
      if (prev.mock === undefined) delete env.E2E_MOCK_EMAIL
      else env.E2E_MOCK_EMAIL = prev.mock
      if (prev.allow === undefined) delete env.E2E_ALLOW_TEST_OVERRIDES
      else env.E2E_ALLOW_TEST_OVERRIDES = prev.allow
    }
  })

  it("flags WEBSITE_SYNC_URL set without WEBSITE_SYNC_SECRET", () => {
    process.env.WEBSITE_SYNC_URL = "https://site.example/api/crm-sync.php"
    expect(collectEnvErrors().join()).toMatch(/WEBSITE_SYNC_SECRET/)
  })

  it("accepts WEBSITE_SYNC_URL + WEBSITE_SYNC_SECRET set together", () => {
    process.env.WEBSITE_SYNC_URL = "https://site.example/api/crm-sync.php"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    expect(collectEnvErrors()).toEqual([])
  })

  it("does not require WEBSITE_SYNC_SECRET when the URL is unset (sync disabled)", () => {
    expect(collectEnvErrors()).toEqual([])
  })

  describe("collectEnvWarnings", () => {
    it("warns when CHURCH_NAME is unset", () => {
      expect(collectEnvWarnings().join()).toMatch(/CHURCH_NAME/)
    })

    it("does not warn when CHURCH_NAME is set", () => {
      process.env.CHURCH_NAME = "Example Church"
      expect(collectEnvWarnings().join()).not.toMatch(/CHURCH_NAME/)
    })

    it("warns when CONTAINER_APP_REPLICA_COUNT > 1", () => {
      process.env.CHURCH_NAME = "Example Church"
      process.env.CONTAINER_APP_REPLICA_COUNT = "3"
      expect(collectEnvWarnings().join()).toMatch(/rate limiter is per-replica/)
    })

    it("does not warn on a single replica", () => {
      process.env.CHURCH_NAME = "Example Church"
      process.env.CONTAINER_APP_REPLICA_COUNT = "1"
      expect(collectEnvWarnings()).toEqual([])
    })
  })

  it("assertRequiredEnv throws listing every problem at once", () => {
    delete process.env.AUTH_SECRET
    delete process.env.DATABASE_URL
    expect(() => assertRequiredEnv()).toThrow(/AUTH_SECRET[\s\S]*DATABASE_URL/)
  })

  it("assertRequiredEnv passes silently on a valid env", () => {
    expect(() => assertRequiredEnv()).not.toThrow()
  })
})
