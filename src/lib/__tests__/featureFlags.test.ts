/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))
jest.mock("next/navigation", () => ({ notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }) }))

import { prisma } from "@/lib/prisma"
import { featureGuard, isFeatureOn, readRawOverrides, requireFeature, skipIfFeatureOff } from "@/lib/featureFlags"
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

it("skipIfFeatureOff does not call fn when off, runs it when on", async () => {
  stored({ events: false })
  const fn = jest.fn().mockResolvedValue("ran")
  expect(await skipIfFeatureOff("events", fn)).toEqual({ skipped: "feature off" })
  expect(fn).not.toHaveBeenCalled()
  expect(await skipIfFeatureOff("budget", fn)).toBe("ran")
})
