/** @jest-environment node */
// AUD-7-10: unlock-admins must be a dry run by default and refuse --apply without --yes.

export {} // module scope

const updateMany = jest.fn(async () => ({ count: 2 }))
const findMany = jest.fn(async () => [{ id: 1 }, { id: 4 }])
const disconnect = jest.fn(async () => {})

jest.mock("../../src/lib/generated/prisma/client", () => ({
  PrismaClient: jest.fn(() => ({
    user: { updateMany, findMany },
    $disconnect: disconnect,
  })),
}))
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: jest.fn() }))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("unlock-admins script", () => {
  const prevArgv = process.argv
  beforeEach(() => {
    jest.resetModules()
    updateMany.mockClear()
    findMany.mockClear()
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db"
    jest.spyOn(console, "error").mockImplementation(() => {})
    jest.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    process.argv = prevArgv
    jest.restoreAllMocks()
    delete process.env.DATABASE_URL
  })

  it("dry-runs by default: lists admin ids and writes nothing", async () => {
    process.argv = ["node", "unlock-admins.ts"]
    require("../../scripts/unlock-admins")
    await flush()
    expect(updateMany).not.toHaveBeenCalled()
    expect(findMany).toHaveBeenCalledWith({ where: { role: "ADMIN" }, select: { id: true } })
  })

  it("refuses --apply without --yes", async () => {
    process.argv = ["node", "unlock-admins.ts", "--apply"]
    let calls = 0
    const exit = jest.spyOn(process, "exit").mockImplementation((() => {
      // Throw once to halt main() like a real exit; the catch handler's own exit(1) must not rethrow.
      if (calls++ === 0) throw new Error("exit")
    }) as never)
    require("../../scripts/unlock-admins")
    await flush()
    expect(exit).toHaveBeenCalledWith(1)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("writes with --apply --yes", async () => {
    process.argv = ["node", "unlock-admins.ts", "--apply", "--yes"]
    require("../../scripts/unlock-admins")
    await flush()
    expect(updateMany).toHaveBeenCalledWith({
      where: { role: "ADMIN" },
      data: { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null },
    })
  })
})
