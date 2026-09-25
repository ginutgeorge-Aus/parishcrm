import {
  parseMaintenanceValue,
  buildMaintenanceState,
  backAtLabel,
  renderMaintenanceHtml,
  isMaintenanceBypassPath,
  getMaintenanceState,
  _resetMaintenanceCache,
} from "@/lib/maintenance"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: jest.fn() } },
}))

const findUnique = prisma.appSetting.findUnique as jest.Mock

beforeEach(() => {
  findUnique.mockReset()
  _resetMaintenanceCache()
})

describe("parseMaintenanceValue", () => {
  it("parses a valid enabled payload", () => {
    expect(
      parseMaintenanceValue('{"enabled":true,"backAt":"2026-08-04T05:46:00Z","message":null}'),
    ).toEqual({ enabled: true, backAt: "2026-08-04T05:46:00Z", message: null })
  })

  it("treats missing / null value as disabled", () => {
    expect(parseMaintenanceValue(null)).toEqual({ enabled: false, backAt: null, message: null })
    expect(parseMaintenanceValue(undefined)).toEqual({ enabled: false, backAt: null, message: null })
  })

  it("fails safe (disabled) on malformed JSON", () => {
    expect(parseMaintenanceValue("{not json")).toEqual({ enabled: false, backAt: null, message: null })
  })

  it("coerces non-boolean enabled to false and drops non-string fields", () => {
    expect(parseMaintenanceValue('{"enabled":"yes","backAt":123,"message":5}')).toEqual({
      enabled: false,
      backAt: null,
      message: null,
    })
  })
})

describe("buildMaintenanceState", () => {
  it("sets backAt to now+etaMinutes when enabled", () => {
    const now = new Date("2026-08-04T05:40:00Z")
    expect(buildMaintenanceState(true, 6, now)).toEqual({
      enabled: true,
      backAt: "2026-08-04T05:46:00.000Z",
      message: null,
    })
  })

  it("clears backAt when disabled", () => {
    expect(buildMaintenanceState(false, 6, new Date("2026-08-04T05:40:00Z"))).toEqual({
      enabled: false,
      backAt: null,
      message: null,
    })
  })
})

describe("backAtLabel", () => {
  const now = new Date("2026-08-04T05:40:00Z")
  it("returns 'shortly' when backAt missing", () => {
    expect(backAtLabel(null, now)).toBe("shortly")
  })
  it("returns 'shortly' when backAt already passed", () => {
    expect(backAtLabel("2026-08-04T05:00:00Z", now)).toBe("shortly")
  })
  it("returns a Sydney time for a future backAt", () => {
    // 05:46 UTC = 15:46 AEST (Sydney, UTC+10 in August)
    expect(backAtLabel("2026-08-04T05:46:00Z", now)).toBe("around 3:46 pm (Sydney)")
  })
})

describe("renderMaintenanceHtml", () => {
  const now = new Date("2026-08-04T05:40:00Z")
  it("renders the ETA and the nonce, no inline script", () => {
    const html = renderMaintenanceHtml(
      { enabled: true, backAt: "2026-08-04T05:46:00Z", message: null },
      "NONCE123",
      now,
    )
    expect(html).toContain("around 3:46 pm (Sydney)")
    expect(html).toContain('nonce="NONCE123"')
    expect(html).not.toContain("<script")
    expect(html).toContain('http-equiv="refresh"')
  })
  it("uses a custom message when provided", () => {
    const html = renderMaintenanceHtml(
      { enabled: true, backAt: null, message: "Back after lunch." },
      "N",
      now,
    )
    expect(html).toContain("Back after lunch.")
  })
  it("escapes HTML in the admin message (Stored XSS)", () => {
    const html = renderMaintenanceHtml(
      { enabled: true, backAt: null, message: "<script>alert(1)</script>" },
      "N",
      now,
    )
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  })
  it("escapes HTML in CHURCH_NAME", () => {
    const prev = process.env.CHURCH_NAME
    process.env.CHURCH_NAME = 'X"><img src=x onerror=alert(1)>'
    try {
      const html = renderMaintenanceHtml({ enabled: true, backAt: null, message: null }, "N", now)
      expect(html).not.toContain("<img src=x")
      expect(html).toContain("&lt;img src=x")
    } finally {
      if (prev === undefined) delete process.env.CHURCH_NAME
      else process.env.CHURCH_NAME = prev
    }
  })
})

describe("isMaintenanceBypassPath", () => {
  it("bypasses health, next assets and favicon", () => {
    expect(isMaintenanceBypassPath("/api/health")).toBe(true)
    expect(isMaintenanceBypassPath("/_next/data/x.json")).toBe(true)
    expect(isMaintenanceBypassPath("/favicon.ico")).toBe(true)
  })
  it("does not bypass normal routes", () => {
    expect(isMaintenanceBypassPath("/login")).toBe(false)
    expect(isMaintenanceBypassPath("/people")).toBe(false)
  })

  it("bypasses the Stripe webhook and cron endpoints", () => {
    // These are exempted from session auth in isPublicPath (csp.ts) because
    // they carry their own signature/bearer-secret verification, not a user
    // session. The maintenance 503 gate must not block them either — a Stripe
    // webhook that 503s during a deploy risks a lost/delayed payment
    // confirmation, and a missed cron.
    expect(isMaintenanceBypassPath("/api/stripe/webhook")).toBe(true)
    expect(isMaintenanceBypassPath("/api/cron/send-reminders")).toBe(true)
    expect(isMaintenanceBypassPath("/api/cron/sweep-checkouts")).toBe(true)
  })
})

describe("getMaintenanceState", () => {
  it("reads and parses the AppSetting row", async () => {
    findUnique.mockResolvedValue({ key: "maintenance", value: '{"enabled":true,"backAt":null,"message":null}' })
    expect((await getMaintenanceState()).enabled).toBe(true)
  })

  it("fails open (disabled) when the DB throws", async () => {
    findUnique.mockRejectedValue(new Error("db down"))
    expect(await getMaintenanceState()).toEqual({ enabled: false, backAt: null, message: null })
  })

  it("caches within the TTL (one query for two rapid reads)", async () => {
    findUnique.mockResolvedValue({ key: "maintenance", value: '{"enabled":true}' })
    await getMaintenanceState()
    await getMaintenanceState()
    expect(findUnique).toHaveBeenCalledTimes(1)
  })
})
