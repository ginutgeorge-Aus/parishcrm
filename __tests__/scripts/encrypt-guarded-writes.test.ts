/** @jest-environment node */
// AUD-7-11: encrypt-* backfills must not blind-overwrite a row edited after it was read.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(__dirname, "../../scripts")
// JSON-column payload scripts cannot use a scalar equality guard in Prisma `where`.
const JSON_COLUMN = new Set(["encrypt-family-update-payload.ts", "encrypt-registration-customanswers.ts"])

describe("encrypt-* backfill scripts use guarded writes", () => {
  const files = readdirSync(dir).filter((f) => /^encrypt-.*\.ts$/.test(f) && !JSON_COLUMN.has(f))
  it.each(files)("%s has no unguarded .update({ where: { id } })", (f) => {
    const src = readFileSync(join(dir, f), "utf8")
    expect(src).not.toMatch(/\.update\(/)
  })
})
