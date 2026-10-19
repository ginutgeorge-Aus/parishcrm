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
  ])("%s", (p, keys) => {
    expect(featuresForPath(p).sort()).toEqual([...keys].sort())
  })

  it.each(["/", "/people", "/families", "/families/12", "/families/directory", "/e/summer", "/e/summer/success",
    "/accounting-other", "/events-archive", "/settings/features", "/login"])("%s is ungated", (p) => {
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

describe("middleware wiring", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8")

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
