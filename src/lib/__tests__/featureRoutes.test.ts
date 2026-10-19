/** @jest-environment node */
import fs from "node:fs"
import path from "node:path"

jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import {
  _resetFeatureRoutesCache, featuresForPath, getEnabledFeaturesCached, isFeatureRouteOff,
} from "@/lib/featureRoutes"
import { FEATURE_KEYS } from "@/lib/features"

const findUnique = prisma.appSetting.findUnique as jest.Mock
const stored = (o: object | null) =>
  findUnique.mockResolvedValue(o && { key: "features", value: JSON.stringify(o) })

beforeEach(() => {
  findUnique.mockReset()
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
    ["/my-events/5/registrations", ["events"]],
    ["/%65vents", ["events"]],
    ["/acc%6Funting/invoices", ["accounting", "invoices"]],
    ["//accounting///invoices//", ["accounting", "invoices"]],
    ["/events/%E0%A4%A", ["events"]],
  ])("%s", (p, keys) => {
    expect(featuresForPath(p).sort()).toEqual([...keys].sort())
  })

  it.each(["/", "/people", "/families", "/families/12", "/families/directory", "/e/summer", "/e/summer/success",
    "/accounting-other", "/events-archive", "/my-events", "/my-events/", "/settings/features", "/login"])("%s is ungated", (p) => {
    expect(featuresForPath(p)).toEqual([])
  })

  it("gates every feature that owns a page route", () => {
    const covered = new Set(["/events", "/memberships", "/sunday-school", "/welcome-letter", "/people/clearances",
      "/people/birthdays", "/families/updates", "/accounting", "/petty-cash", "/accounting/reconciliation",
      "/accounting/import", "/accounting/dues", "/accounting/send-receipts", "/accounting/dgr-receipts",
      "/accounting/invoices", "/accounting/budget"].flatMap(featuresForPath))
    expect([...FEATURE_KEYS].filter((k) => !covered.has(k))).toEqual([])
  })
})

describe("isFeatureRouteOff", () => {
  it("is false for ungated paths without reading settings", async () => {
    expect(await isFeatureRouteOff("/people")).toBe(false)
    expect(findUnique).not.toHaveBeenCalled()
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
    findUnique.mockRejectedValue(new Error("db down"))
    expect(await isFeatureRouteOff("/events/5")).toBe(false)
  })
})

it("caches the feature set between calls", async () => {
  stored({ events: false })
  await getEnabledFeaturesCached()
  await getEnabledFeaturesCached()
  expect(findUnique).toHaveBeenCalledTimes(1)
})

it("serves the cache within the TTL and refetches after it", async () => {
  const now = jest.spyOn(Date, "now")
  try {
    stored({ events: false })
    now.mockReturnValue(1_000_000)
    await getEnabledFeaturesCached()
    now.mockReturnValue(1_004_999)
    await getEnabledFeaturesCached()
    expect(findUnique).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1_005_000)
    await getEnabledFeaturesCached()
    expect(findUnique).toHaveBeenCalledTimes(2)
  } finally {
    now.mockRestore()
  }
})

describe("read failures", () => {
  let errSpy: jest.SpyInstance
  beforeEach(() => {
    errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
  })
  afterEach(() => errSpy.mockRestore())

  it("fails open, logs, and caches the failure for the TTL", async () => {
    findUnique.mockRejectedValue(new Error("db down"))
    expect(await getEnabledFeaturesCached()).toBeNull()
    expect(await getEnabledFeaturesCached()).toBeNull()
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it("serves the last known set when a refresh fails", async () => {
    const now = jest.spyOn(Date, "now")
    try {
      stored({ events: false })
      now.mockReturnValue(1_000_000)
      await getEnabledFeaturesCached()
      findUnique.mockRejectedValue("boom")
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
    expect(findUnique).toHaveBeenCalledTimes(1)
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
