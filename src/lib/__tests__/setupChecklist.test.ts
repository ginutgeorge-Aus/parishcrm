/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findFirst: jest.fn() },
    brandingAsset: { findFirst: jest.fn() },
    person: { findFirst: jest.fn() },
    account: { findFirst: jest.fn() },
    paymentAccount: { findFirst: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getSetupChecklist, resetSetupChecklistCache } from "@/lib/setupChecklist"

const m = prisma as unknown as Record<string, { findFirst: jest.Mock }>
const models = ["appSetting", "brandingAsset", "person", "account", "paymentAccount"]

/** Prime every existence check; `done` lists the models that have a row. */
function prime(done: string[]) {
  for (const k of models) m[k].findFirst.mockResolvedValue(done.includes(k) ? { id: 1 } : null)
}

const OLD_NAME = process.env.CHURCH_NAME

beforeEach(() => {
  jest.clearAllMocks()
  resetSetupChecklistCache()
  delete process.env.CHURCH_NAME
})
afterAll(() => {
  if (OLD_NAME === undefined) delete process.env.CHURCH_NAME
  else process.env.CHURCH_NAME = OLD_NAME
})

describe("getSetupChecklist", () => {
  it("returns null without querying for non-admin roles", async () => {
    for (const role of ["PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER", undefined] as const) {
      expect(await getSetupChecklist(role)).toBeNull()
    }
    for (const k of models) expect(m[k].findFirst).not.toHaveBeenCalled()
  })

  it("lists every step as not done on an empty install, each with a link", async () => {
    prime([])
    const steps = await getSetupChecklist("ADMIN")
    expect(steps).not.toBeNull()
    expect(steps!.map((s) => s.id)).toEqual(["church", "branding", "people", "categories", "paymentAccounts"])
    expect(steps!.every((s) => !s.done && s.href.startsWith("/"))).toBe(true)
  })

  it("marks steps done from existing rows", async () => {
    prime(["brandingAsset", "person"])
    const steps = await getSetupChecklist("ADMIN")
    const done = Object.fromEntries(steps!.map((s) => [s.id, s.done]))
    expect(done).toEqual({ church: false, branding: true, people: true, categories: false, paymentAccounts: false })
  })

  it("counts a CHURCH_NAME env var as church details done", async () => {
    process.env.CHURCH_NAME = "Example Parish"
    prime([])
    const steps = await getSetupChecklist("ADMIN")
    expect(steps!.find((s) => s.id === "church")!.done).toBe(true)
  })

  it("only counts a non-empty churchName setting and active people", async () => {
    prime([])
    await getSetupChecklist("ADMIN")
    expect(m.appSetting.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "churchName", value: { not: "" } } })
    )
    expect(m.person.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null } }))
  })

  it("returns null once complete and skips the queries on later calls", async () => {
    prime(models)
    expect(await getSetupChecklist("ADMIN")).toBeNull()
    jest.clearAllMocks()
    expect(await getSetupChecklist("ADMIN")).toBeNull()
    for (const k of models) expect(m[k].findFirst).not.toHaveBeenCalled()
  })

  it("keeps checking while setup is incomplete", async () => {
    prime([])
    await getSetupChecklist("ADMIN")
    await getSetupChecklist("ADMIN")
    expect(m.account.findFirst).toHaveBeenCalledTimes(2)
  })
})
