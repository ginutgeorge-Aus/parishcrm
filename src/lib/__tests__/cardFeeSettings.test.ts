jest.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn() } } }))
import { getCardFeeConfig } from "@/lib/cardFeeSettings"
// Grab the mock AFTER jest.mock is hoisted — referencing a top-level const
// inside the factory would hit the TDZ ("Cannot access before initialization").
const { prisma } = require("@/lib/prisma")
const findMany = prisma.appSetting.findMany as jest.Mock

it("falls back to 1.7% + 30c on an empty DB", async () => {
  findMany.mockResolvedValue([])
  expect(await getCardFeeConfig()).toEqual({ pct: 1.7, fixedCents: 30 })
})

it("reads admin-set values", async () => {
  findMany.mockResolvedValue([
    { key: "cardFeePercent", value: "2.1" },
    { key: "cardFeeFixed", value: "0.25" },
  ])
  expect(await getCardFeeConfig()).toEqual({ pct: 2.1, fixedCents: 25 })
})

it("falls back per-field when only one key is set or a value is garbage", async () => {
  findMany.mockResolvedValue([
    { key: "cardFeePercent", value: "not-a-number" },
    { key: "cardFeeFixed", value: "0.40" },
  ])
  expect(await getCardFeeConfig()).toEqual({ pct: 1.7, fixedCents: 40 })
})
