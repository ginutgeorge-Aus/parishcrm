/** @jest-environment node */
import { getEmailFooter, getEmailFooterTemplate } from "@/lib/emailTemplateStore"

const mockFindUnique = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: (...a: unknown[]) => mockFindUnique(...a) } },
}))

/** Mock the per-key AppSetting reads. */
function rows(map: Record<string, string>) {
  mockFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key in map ? { value: map[where.key] } : null,
  )
}

describe("getEmailFooter", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.CHURCH_NAME
  })

  it("is off (empty) when no row exists", async () => {
    rows({ churchName: "Grace Church" })
    expect(await getEmailFooter()).toBe("")
  })

  it("skips the church-name read when the footer has no {churchName}", async () => {
    rows({ emailFooter: "Plain footer" })
    expect(await getEmailFooter()).toBe("Plain footer")
    expect(mockFindUnique).toHaveBeenCalledTimes(1)
  })

  it("returns empty string when the row is blank (disabled)", async () => {
    rows({ emailFooter: "", churchName: "Grace Church" })
    expect(await getEmailFooter()).toBe("")
  })

  it("substitutes {churchName} in a custom footer", async () => {
    rows({ emailFooter: "From {churchName} - {unknown}", churchName: "Grace Church" })
    expect(await getEmailFooter()).toBe("From Grace Church - {unknown}")
  })

  it("sends no footer when the DB throws (fails closed)", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"))
    expect(await getEmailFooter()).toBe("")
  })

  it("template reader returns the stored value, or empty when none", async () => {
    rows({})
    expect(await getEmailFooterTemplate()).toBe("")
    rows({ emailFooter: "Hi {churchName}" })
    expect(await getEmailFooterTemplate()).toBe("Hi {churchName}")
    rows({ emailFooter: "" })
    expect(await getEmailFooterTemplate()).toBe("")
  })
})
