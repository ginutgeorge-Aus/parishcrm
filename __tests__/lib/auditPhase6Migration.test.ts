/** @jest-environment node */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(process.cwd(), "prisma", "migrations")
const sql = readdirSync(dir)
  .filter((d) => d.endsWith("_audit_phase6_lows"))
  .map((d) => readFileSync(join(dir, d, "migration.sql"), "utf8"))
  .join("\n")

describe("audit phase 6 lows migration", () => {
  it("blocks TRUNCATE of AuditLog with a statement-level trigger (AUD-6-15)", () => {
    expect(sql).toMatch(/BEFORE TRUNCATE ON "AuditLog"\s+FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable\(\)/)
  })
  it("makes PettyCashReceipt.serviceType restrict deletes (AUD-6-05)", () => {
    expect(sql).toMatch(/"PettyCashReceipt_serviceTypeId_fkey"[\s\S]*ON DELETE RESTRICT/)
  })
  it.each(["TicketType_eventId_idx", "CheckoutSession_eventId_idx", "PettyCashReceipt_personId_idx", "Registration_paymentRef_idx"])(
    "adds index %s (AUD-6-11)", (name) => expect(sql).toContain(`CREATE INDEX "${name}"`))
})

const dropSql = readdirSync(dir)
  .filter((d) => d.endsWith("_audit_phase6_drop_redundant_indexes"))
  .map((d) => readFileSync(join(dir, d, "migration.sql"), "utf8"))
  .join("\n")
const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8")

describe("redundant index clean-up (AUD-6-12)", () => {
  it.each([
    "Person_mobile_idx", "Transaction_paymentAccountId_idx", "Transaction_familyId_idx",
    "Transaction_personId_idx", "Transaction_isGiving_idx", "Registration_eventId_idx",
    "ServiceHeadcount_serviceDate_idx", "AuditLog_action_idx",
  ])("drops %s", (name) => expect(dropSql).toContain(`DROP INDEX "${name}"`))
  it("schema no longer declares a single-column index on Person.mobile", () => {
    expect(schema).not.toMatch(/@@index\(\[mobile\]\)/)
  })
})
