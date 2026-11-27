/** @jest-environment node */
// AUD-7-08: create-admin-user must exit non-zero when creating the user fails,
// so setup automation does not report success with no admin.

export {} // module scope

const create = jest.fn()
const disconnect = jest.fn(async () => {})

jest.mock("../../src/lib/generated/prisma/client", () => ({
  Prisma: { empty: "", sql: () => "" },
  PrismaClient: jest.fn(() => ({
    user: { create },
    $queryRaw: jest.fn(async () => []),
    $disconnect: disconnect,
  })),
}))
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: jest.fn() }))
jest.mock("bcryptjs", () => ({ __esModule: true, default: { hash: jest.fn(async () => "hash") } }))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("create-admin-user script", () => {
  const prevExit = process.exitCode
  beforeEach(() => {
    jest.resetModules()
    create.mockReset()
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db"
    process.env.USER_EMAIL = "new.admin@church.test"
    process.env.USER_PASSWORD = "Sup3r-secret-pass!"
    process.exitCode = undefined
    jest.spyOn(console, "error").mockImplementation(() => {})
    jest.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    process.exitCode = prevExit
    jest.restoreAllMocks()
    for (const k of ["DATABASE_URL", "USER_EMAIL", "USER_PASSWORD"]) delete process.env[k]
  })

  it("exits non-zero when create fails", async () => {
    create.mockRejectedValue(new Error("db down"))
    await import("../../scripts/create-admin-user")
    await flush()
    expect(process.exitCode).toBe(1)
    expect(disconnect).toHaveBeenCalled()
  })

  it("exits zero on success", async () => {
    create.mockResolvedValue({ id: 1, email: "new.admin@church.test", role: "ADMIN" })
    await import("../../scripts/create-admin-user")
    await flush()
    expect(process.exitCode).toBeUndefined()
  })
})
