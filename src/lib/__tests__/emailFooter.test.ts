/** @jest-environment node */
import { getEmailFooter, getEmailFooterTemplate } from "@/lib/emailTemplateStore"
import { DEFAULT_EMAIL_FOOTER } from "@/lib/emailTemplates"

const findUnique = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}))

/** Mock the per-key AppSetting reads. */
function rows(map: Record<string, string>) {
  findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key in map ? { value: map[where.key] } : null,
  )
}

describe("getEmailFooter", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.CHURCH_NAME
  })

  it("returns the default with the church name when no row exists", async () => {
    rows({ churchName: "Grace Church" })
    expect(await getEmailFooter()).toBe("This email was sent via the Grace Church CRM application.")
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
    findUnique.mockRejectedValue(new Error("db down"))
    expect(await getEmailFooter()).toBe("")
  })

  it("template reader returns the raw default / stored value", async () => {
    rows({})
    expect(await getEmailFooterTemplate()).toBe(DEFAULT_EMAIL_FOOTER)
    rows({ emailFooter: "" })
    expect(await getEmailFooterTemplate()).toBe("")
  })
})
