import { getLetterSettings } from "@/lib/letterSettings"
import { prisma } from "@/lib/prisma"

jest.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: jest.fn(),
  revalidatePath: jest.fn(),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findMany: jest.fn() } },
}))

const mockFindMany = prisma.appSetting.findMany as jest.Mock

describe("getLetterSettings", () => {
  it("returns blank-safe defaults with generic fund labels when unset", async () => {
    mockFindMany.mockResolvedValue([])
    const s = await getLetterSettings()
    expect(s.general.fundLabel).toBe("General Fund")
    expect(s.general.taxDeductible).toBe(false)
    expect(s.building.fundLabel).toBe("Building Fund")
    expect(s.building.taxDeductible).toBe(true)
    expect(s.introTemplate).toBe("")
    expect(s.contributionsTemplate).toBe("")
    expect(s.closingTemplate).toBe("")
    expect(s.general.bsb).toBe("")
    expect(s.signerName).toBe("")
  })

  it("maps stored keys onto the two accounts + signer", async () => {
    mockFindMany.mockResolvedValue([
      { key: "bankGeneralBsb", value: "012345" },
      { key: "bankGeneralAccount", value: "987654321" },
      { key: "bankGeneralAccountName", value: "Example Church" },
      { key: "bankGeneralBank", value: "ANZ Bank" },
      { key: "bankBuildingBsb", value: "013999" },
      { key: "letterSignerName", value: "Mrs. Susan Miller" },
      { key: "letterSignerTitle", value: "Secretary" },
    ])
    const s = await getLetterSettings()
    expect(s.general.bsb).toBe("012345")
    expect(s.general.accountName).toBe("Example Church")
    expect(s.building.bsb).toBe("013999")
    expect(s.signerName).toBe("Mrs. Susan Miller")
    expect(s.signerTitle).toBe("Secretary")
  })

  it("reads templates and fund labels", async () => {
    mockFindMany.mockResolvedValue([
      { key: "letterIntro", value: "Hi {churchName}" },
      { key: "letterContributions", value: "Give" },
      { key: "letterClosing", value: "Bye" },
      { key: "bankGeneralFundLabel", value: "Main Fund" },
      { key: "bankBuildingFundLabel", value: "Tithe / School Building Fund" },
    ])
    const s = await getLetterSettings()
    expect(s.introTemplate).toBe("Hi {churchName}")
    expect(s.contributionsTemplate).toBe("Give")
    expect(s.closingTemplate).toBe("Bye")
    expect(s.general.fundLabel).toBe("Main Fund")
    expect(s.building.fundLabel).toBe("Tithe / School Building Fund")
  })

  it("blank fund label falls back to the default", async () => {
    mockFindMany.mockResolvedValue([{ key: "bankGeneralFundLabel", value: "  " }])
    expect((await getLetterSettings()).general.fundLabel).toBe("General Fund")
  })
})
