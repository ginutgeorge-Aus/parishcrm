/** @jest-environment node */
import fs from "node:fs"
import path from "node:path"

jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import {
  _resetFeatureRoutesCache, featureOffRedirect, featuresForPath, getEnabledFeaturesCached, invalidateFeatureRouteCache, isFeatureRouteOff,
} from "@/lib/featureRoutes"
import { FEATURE_KEYS } from "@/lib/features"

const findMany = prisma.appSetting.findMany as jest.Mock
const stored = (o: object | null) =>
  findMany.mockResolvedValue(o ? [{ key: "features", value: JSON.stringify(o) }] : [])

beforeEach(() => {
  findMany.mockReset()
  _resetFeatureRoutesCache()
})

describe("featuresForPath", () => {
  it.each([
    ["/accounting/invoices", ["accounting", "invoices"]],
    ["/accounting/invoices/7", ["accounting", "invoices"]],
    ["/accounting/invoices/7/", ["accounting", "invoices"]],
    ["/accounting/reports/budget-vs-actual", ["accounting", "budget"]],
    ["/families/12/giving", ["accounting"]],
    ["/e/summer/crew", ["events"]],
    ["/family/some-token", ["familyUpdates"]],
    ["/people/birthdays", ["celebrations"]],
    ["/petty-cash/sessions/3", ["pettyCash"]],
    ["/events/%E0%A4%A/x", ["events"]],
    ["/%65vents/5/%ZZ", ["events"]],
    ["/events/a%2Fb", ["events"]],
    ["/%65vents", ["events"]],
    ["/acc%6Funting/invoices", ["accounting", "invoices"]],
    ["//accounting///invoices//", ["accounting", "invoices"]],
    ["/events/%E0%A4%A", ["events"]],
    ["/my-events/5/registrations", ["events"]],
    ["/my-events/5", ["events"]],
  ])("%s", (p, keys) => {
    expect(featuresForPath(p).sort()).toEqual([...keys].sort())
  })

  it.each(["/", "/people", "/families", "/families/12", "/families/directory", "/e/summer", "/e/summer/success",
    "/accounting-other", "/events-archive", "/my-events", "/my-events/", "/settings/features", "/login"])("%s is ungated", (p) => {
    expect(featuresForPath(p)).toEqual([])
  })

  it("keeps an encoded slash inside its segment (no new separator)", () => {
    expect(featuresForPath("/accounting%2Finvoices")).toEqual([])
    expect(featuresForPath("/x%2Fevents")).toEqual([])
    expect(featuresForPath("/%2Fevents")).toEqual([])
  })

  it("gates every feature that owns a page route", () => {
    const covered = new Set(["/events", "/memberships", "/sunday-school", "/welcome-letter", "/people/clearances",
      "/people/birthdays", "/families/updates", "/accounting", "/petty-cash", "/accounting/reconciliation",
      "/accounting/import", "/accounting/dues", "/accounting/send-receipts", "/accounting/dgr-receipts",
      "/accounting/invoices", "/accounting/budget"].flatMap(featuresForPath))
    expect([...FEATURE_KEYS].filter((k) => !covered.has(k))).toEqual([])
  })
})

describe("featureOffRedirect", () => {
  it.each([
    ["/my-events/42/check-in", "/my-events"],
    ["/my-events/5", "/my-events"],
    ["/%6Dy-events/5", "/my-events"],
  ])("%s falls back to %s", (p, to) => {
    expect(featureOffRedirect(p)).toBe(to)
  })

  it.each(["/events", "/accounting/invoices", "/my-events", "/my-classes"])("%s has no fallback (404)", (p) => {
    expect(featureOffRedirect(p)).toBeNull()
  })
})

describe("isFeatureRouteOff", () => {
  it("is false for ungated paths without reading settings", async () => {
    expect(await isFeatureRouteOff("/people")).toBe(false)
    expect(findMany).not.toHaveBeenCalled()
  })

  it("is true when the feature is off, including nested pages", async () => {
    stored({ invoices: false })
    expect(await isFeatureRouteOff("/accounting/invoices/7")).toBe(true)
    expect(await isFeatureRouteOff("/accounting/transactions")).toBe(false)
  })

  it("is true for children when the parent is off", async () => {
    stored({ accounting: false })
    expect(await isFeatureRouteOff("/accounting/budget")).toBe(true)
  })

  it("is false when everything is on (no row)", async () => {
    stored(null)
    expect(await isFeatureRouteOff("/events/5")).toBe(false)
  })

  it("fails open when the read throws", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined)
    findMany.mockRejectedValue(new Error("db down"))
    expect(await isFeatureRouteOff("/events/5")).toBe(false)
    err.mockRestore()
  })
})

it("caches the feature set between calls", async () => {
  stored({ events: false })
  await getEnabledFeaturesCached()
  await getEnabledFeaturesCached()
  expect(findMany).toHaveBeenCalledTimes(1)
})

it("serves the cache within the TTL and refetches after it", async () => {
  const now = jest.spyOn(Date, "now")
  try {
    stored({ events: false })
    now.mockReturnValue(1_000_000)
    await getEnabledFeaturesCached()
    now.mockReturnValue(1_004_999)
    await getEnabledFeaturesCached()
    expect(findMany).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1_005_000)
    await getEnabledFeaturesCached()
    expect(findMany).toHaveBeenCalledTimes(2)
  } finally {
    now.mockRestore()
  }
})

describe("invalidateFeatureRouteCache", () => {
  it("makes the next call re-read the settings", async () => {
    stored({ events: false })
    expect((await getEnabledFeaturesCached())?.has("events")).toBe(false)
    stored({})
    invalidateFeatureRouteCache()
    expect((await getEnabledFeaturesCached())?.has("events")).toBe(true)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it("a read started before invalidation cannot repopulate the cache with stale data", async () => {
    let release!: (v: unknown) => void
    findMany.mockReturnValueOnce(new Promise((r) => { release = r }))
    const stale = getEnabledFeaturesCached()
    await new Promise((r) => setImmediate(r))
    invalidateFeatureRouteCache()
    stored({})
    release([{ key: "features", value: JSON.stringify({ events: false }) }])
    expect((await stale)?.has("events")).toBe(false)
    expect((await getEnabledFeaturesCached())?.has("events")).toBe(true)
  })

  it("a stale failed read does not poison the cache either", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      let fail!: (e: unknown) => void
      findMany.mockReturnValueOnce(new Promise((_, rej) => { fail = rej }))
      const stale = getEnabledFeaturesCached()
      await new Promise((r) => setImmediate(r))
      invalidateFeatureRouteCache()
      stored({ events: false })
      fail(new Error("db down"))
      expect(await stale).toBeNull()
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(false)
    } finally {
      errSpy.mockRestore()
    }
  })

  it("a stale read cannot overwrite the last known fallback set", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      let release!: (v: unknown) => void
      findMany.mockReturnValueOnce(new Promise((r) => { release = r }))
      const stale = getEnabledFeaturesCached()
      await new Promise((r) => setImmediate(r))
      invalidateFeatureRouteCache()
      stored({})
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(true)
      release([{ key: "features", value: JSON.stringify({ events: false }) }])
      await stale
      invalidateFeatureRouteCache()
      findMany.mockRejectedValueOnce(new Error("db down"))
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(true)
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe("invalidation after a save", () => {
  it("a failed read right after a save serves the saved set, not the pre-save one", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      stored({})
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(true)
      invalidateFeatureRouteCache({ events: false })
      findMany.mockRejectedValueOnce(new Error("db down"))
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(false)
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe("read failures", () => {
  let errSpy: jest.SpyInstance
  beforeEach(() => {
    errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
  })
  afterEach(() => errSpy.mockRestore())

  it("fails open, logs, and caches the failure for the TTL", async () => {
    findMany.mockRejectedValue(new Error("db down"))
    expect(await getEnabledFeaturesCached()).toBeNull()
    expect(await getEnabledFeaturesCached()).toBeNull()
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it("logs the error class, never the driver message", async () => {
    findMany.mockRejectedValue(new Error("secret query value"))
    await getEnabledFeaturesCached()
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("secret query value")
    expect(errSpy.mock.calls[0]).toContain("Error")
  })

  it("keeps serving the previous set when a read fails right after invalidation", async () => {
    stored({ events: false })
    await getEnabledFeaturesCached()
    invalidateFeatureRouteCache()
    findMany.mockRejectedValue(new Error("db down"))
    expect((await getEnabledFeaturesCached())?.has("events")).toBe(false)
  })

  it("serves the last known set when a refresh fails", async () => {
    const now = jest.spyOn(Date, "now")
    try {
      stored({ events: false })
      now.mockReturnValue(1_000_000)
      await getEnabledFeaturesCached()
      findMany.mockRejectedValue("boom")
      now.mockReturnValue(1_006_000)
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(false)
      expect(errSpy).toHaveBeenCalledTimes(1)
    } finally {
      now.mockRestore()
    }
  })

  it("coalesces concurrent cold reads into one query", async () => {
    stored({ events: false })
    await Promise.all([getEnabledFeaturesCached(), getEnabledFeaturesCached(), getEnabledFeaturesCached()])
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})

describe("shared settings snapshot", () => {
  it("one query serves the maintenance flag and the feature flags", async () => {
    const { getMaintenanceState } = await import("@/lib/maintenance")
    findMany.mockResolvedValue([
      { key: "maintenance", value: '{"enabled":true}' },
      { key: "features", value: JSON.stringify({ events: false }) },
    ])
    expect((await getMaintenanceState()).enabled).toBe(true)
    expect((await getEnabledFeaturesCached())?.has("events")).toBe(false)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it("warns once per distinct unreadable features value, across snapshot refreshes", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    const now = jest.spyOn(Date, "now")
    try {
      findMany.mockResolvedValue([{ key: "features", value: "not json" }])
      now.mockReturnValue(1_000_000)
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(true)
      now.mockReturnValue(1_006_000) // snapshot expired: a second read of the same bad value
      expect((await getEnabledFeaturesCached())?.has("events")).toBe(true)
      expect(findMany).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
      now.mockRestore()
    }
  })
})

describe("middleware wiring", () => {
  let src = ""
  beforeAll(() => {
    src = fs.readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8")
  })

  it("checks the feature AFTER the login redirect and organiser confinement", () => {
    const feature = src.indexOf("isFeatureRouteOff(pathname)")
    expect(feature).toBeGreaterThan(src.indexOf("loginRedirectPath("))
    expect(feature).toBeGreaterThan(src.indexOf("isOrganiserAllowedPath(pathname)"))
  })

  it("leaves Server Actions (POST) and API routes to their own guards", () => {
    expect(src).toMatch(/req\.method === "GET" \|\| req\.method === "HEAD"/)
    expect(src).toContain('!pathname.startsWith("/api/")')
  })
})
