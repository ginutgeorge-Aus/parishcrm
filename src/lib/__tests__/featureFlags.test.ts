/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))
jest.mock("next/navigation", () => ({ notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }) }))

import { prisma } from "@/lib/prisma"
import {
  cronFeatureSkip, featureGuard, featureNotFound, isFeatureOn, readRawOverrides, requireFeature, skipIfFeatureOff,
} from "@/lib/featureFlags"
import { FEATURE_OFF_MESSAGE } from "@/lib/features"

const findUnique = prisma.appSetting.findUnique as jest.Mock
const stored = (o: object | null) =>
  findUnique.mockResolvedValue(o && { key: "features", value: JSON.stringify(o) })

beforeEach(() => findUnique.mockReset())

it("defaults on when no row", async () => {
  stored(null)
  expect(await isFeatureOn("events")).toBe(true)
})

it("corrupt row falls back to defaults", async () => {
  findUnique.mockResolvedValue({ key: "features", value: "{oops" })
  expect(await readRawOverrides()).toEqual({})
  expect(await isFeatureOn("events")).toBe(true)
})

it("requireFeature throws notFound when off, resolves when on", async () => {
  stored({ events: false })
  await expect(requireFeature("events")).rejects.toThrow("NEXT_NOT_FOUND")
  await expect(requireFeature("budget")).resolves.toBeUndefined()
})

it("featureGuard returns error result when off, null when on", async () => {
  stored({ budget: false })
  expect(await featureGuard("budget")).toEqual({ error: FEATURE_OFF_MESSAGE })
  expect(await featureGuard("events")).toBeNull()
})

it("featureNotFound returns a 404 when off, null when on", async () => {
  stored({ events: false })
  const res = await featureNotFound("events")
  expect(res?.status).toBe(404)
  // JSON, so public forms that parse before checking res.ok get a message.
  expect(await res?.json()).toEqual({ error: "Not found" })
  expect(await featureNotFound("budget")).toBeNull()
})

describe("cronFeatureSkip", () => {
  const OLD = process.env.CRON_SECRET
  beforeEach(() => { process.env.CRON_SECRET = "s3cret" })
  afterAll(() => { if (OLD === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = OLD })

  it("skips with 200 for an authorised caller while off", async () => {
    stored({ events: false })
    const res = await cronFeatureSkip("Bearer s3cret", "events")
    expect(res?.status).toBe(200)
    expect(await res?.json()).toEqual({ skipped: "feature off" })
  })

  it("falls through for a bad bearer, so the route's own 401 answers", async () => {
    stored({ events: false })
    expect(await cronFeatureSkip("Bearer nope", "events")).toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it("falls through while on", async () => {
    stored(null)
    expect(await cronFeatureSkip("Bearer s3cret", "events")).toBeNull()
  })
})

it("skipIfFeatureOff does not call fn when off, runs it when on", async () => {
  stored({ events: false })
  const fn = jest.fn().mockResolvedValue("ran")
  expect(await skipIfFeatureOff("events", fn)).toEqual({ skipped: "feature off" })
  expect(fn).not.toHaveBeenCalled()
  expect(await skipIfFeatureOff("budget", fn)).toBe("ran")
})
