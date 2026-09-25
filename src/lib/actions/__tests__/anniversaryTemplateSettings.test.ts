/** @jest-environment node */
import { getAnniversaryTemplate } from "@/lib/actions/settings"
import { DEFAULT_ANNIVERSARY_TEMPLATE } from "@/lib/anniversaryTemplate"
jest.mock("@/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "1", role: "ADMIN" } })) }))
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn() } } }))
import { prisma } from "@/lib/prisma"

test("falls back to default per field when unset", async () => {
  ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([])
  await expect(getAnniversaryTemplate()).resolves.toEqual(DEFAULT_ANNIVERSARY_TEMPLATE)
})
