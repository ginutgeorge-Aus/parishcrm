/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { getWwccVerifyUrl, DEFAULT_WWCC_VERIFY_URL, WWCC_VERIFY_URL_KEY } from "@/lib/clearanceSettings"

const find = prisma.appSetting.findUnique as jest.Mock
beforeEach(() => jest.clearAllMocks())

it("reads the clearance.wwccVerifyUrl key", async () => {
  find.mockResolvedValue(null)
  await getWwccVerifyUrl()
  expect(find).toHaveBeenCalledWith({ where: { key: "clearance.wwccVerifyUrl" } })
  expect(WWCC_VERIFY_URL_KEY).toBe("clearance.wwccVerifyUrl")
})
it("defaults to the NSW OCG employer portal when unset", async () => {
  find.mockResolvedValue(null)
  expect(await getWwccVerifyUrl()).toBe("https://wwccemployer.ocg.nsw.gov.au/Login")
  expect(DEFAULT_WWCC_VERIFY_URL).toBe("https://wwccemployer.ocg.nsw.gov.au/Login")
})
it("defaults when blank", async () => {
  find.mockResolvedValue({ key: "k", value: "   " })
  expect(await getWwccVerifyUrl()).toBe(DEFAULT_WWCC_VERIFY_URL)
})
it("returns a valid https override", async () => {
  find.mockResolvedValue({ key: "k", value: "https://example.org/check-wwcc" })
  expect(await getWwccVerifyUrl()).toBe("https://example.org/check-wwcc")
})
it("rejects non-https / junk overrides (no javascript: or http: links)", async () => {
  for (const bad of ["javascript:alert(1)", "http://example.org", "not a url"]) {
    find.mockResolvedValue({ key: "k", value: bad })
    expect(await getWwccVerifyUrl()).toBe(DEFAULT_WWCC_VERIFY_URL)
  }
})
