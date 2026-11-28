/** @jest-environment node */
// AUD-7-12: wrong-database guard prints host/dbname and honours an optional --host expectation.
import { dbTarget, requireConfirmation } from "../../scripts/lib/script-helpers"

describe("script-helpers wrong-database guard", () => {
  const prevArgv = process.argv
  const prevUrl = process.env.DATABASE_URL
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://u:p@db.example.com:5432/parish"
    jest.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    process.argv = prevArgv
    process.env.DATABASE_URL = prevUrl
    jest.restoreAllMocks()
  })

  it("dbTarget shows host and database name but no credentials", () => {
    expect(dbTarget("postgresql://u:secret@db.example.com:5432/parish")).toBe("db.example.com:5432/parish")
  })

  it("dbTarget falls back safely on an unparseable URL", () => {
    expect(dbTarget(undefined)).toBe("(unparseable DATABASE_URL)")
  })

  it("exits 1 when --host does not match the target host", async () => {
    process.argv = ["node", "x", "--apply", "--yes", "--host", "other.example.com:5432"]
    const exit = jest.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit") }) as never)
    await expect(requireConfirmation(true, true, async () => {})).rejects.toThrow("exit")
    expect(exit).toHaveBeenCalledWith(1)
  })

  it("passes when --host matches, and when --host is omitted", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit") }) as never)
    process.argv = ["node", "x", "--apply", "--yes", "--host", "db.example.com:5432"]
    await requireConfirmation(true, true, async () => {})
    process.argv = ["node", "x", "--apply", "--yes"]
    await requireConfirmation(true, true, async () => {})
    expect(exit).not.toHaveBeenCalled()
  })
})
