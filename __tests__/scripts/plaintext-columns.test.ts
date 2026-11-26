/** @jest-environment node */
// Plaintext-column guard (audit AUD-1-17). Every non-unique String column in schema.prisma must be
// either encrypted at rest (listed in rotate-encryption-key.ts FIELDS) or on the explicit
// PLAIN_ON_PURPOSE list below. A new text column fails this test until its author decides:
//   - personal or free-text data  -> encrypt() it on write, decrypt on read, add it to FIELDS; or
//   - genuinely non-sensitive / needed for search, sort or joins -> add it to PLAIN_ON_PURPOSE with a
//     one-line reason in the PR.
// @id and @unique columns are skipped: a unique lookup key cannot use a random-IV ciphertext (use a
// blind index or a token digest, see tokenHash.ts / hmacEmail).
// The list below was seeded from the schema at the time of the audit (names stay plain so they can be
// searched and sorted); stale entries (column gone or now encrypted) also fail, so the list stays honest.

import * as fs from "fs"
import * as path from "path"
import { FIELDS } from "../../scripts/rotate-encryption-key"

const PLAIN_ON_PURPOSE: Record<string, string[]> = {
  account: ["name", "description"],
  accountGroup: ["name"],
  appSetting: ["value"],
  attendee: ["name"],
  auditLog: ["action", "resourceType", "ip"],
  backupCode: ["codeHash"],
  brandingAsset: ["mimeType"],
  budget: ["note"],
  celebrationSend: ["action", "sendDate", "status"],
  checkoutSession: ["publicToken"],
  checkpointResult: ["note"],
  customer: ["name", "abn"],
  dgrReceipt: ["donorName", "status", "errorMessage"],
  emailTemplate: ["subject", "intro", "body", "signoff"],
  errorLog: ["fingerprint", "errorType", "message", "route", "method", "correlationId"],
  event: ["title", "description", "category", "kind", "recurs", "recursLabel", "startTime", "location", "bankBsb", "bankAccount", "imageUrl"],
  eventImage: ["mimeType"],
  family: ["name", "suburbHash"],
  fundraiser: ["name", "unitLabel", "refPrefix"],
  fundraiserEntry: ["familyNameSnapshot", "outsideName"],
  fundraiserPayment: ["note"],
  fundraiserReminderSend: ["status", "errorMessage"],
  group: ["description"],
  groupMember: ["title"],
  groupMessage: ["subject"],
  groupMessageRecipient: ["status"],
  invoice: ["recipientName", "voidReason"],
  membershipApplication: ["applicantName", "emailHash", "mobileHash", "placeSigned"],
  passkey: ["name"],
  paymentReminderSend: ["status", "errorMessage"],
  person: ["firstName", "lastName", "middleName", "title", "suffix", "emailHash", "mobileHash", "photoUrl", "motherParish", "bankingName"],
  personClearance: ["documentType"],
  pettyCashExpense: ["receiptRef", "importKey"],
  pettyCashReceipt: ["importKey"],
  pettyCashSession: ["title"], // notes encrypted since AUD-3-04
  pettyCashTransfer: ["depositSlipRef"],
  receiptSend: ["status", "errorMessage"],
  registration: ["firstName", "lastName", "emailHash", "paymentRef"],
  report: ["title", "summary", "pageUrl"],
  rosterService: ["title", "location"],
  routeViewDaily: ["route"],
  sacramentRecord: ["place", "ministerName"],
  serviceHeadcount: ["notes"],
  sundaySchoolClass: ["name", "location"],
  sundaySchoolExam: ["name"],
  ticketType: ["name"],
  transactionAttachment: ["contentType"],
  trustedDevice: ["label"],
  user: ["name", "passwordHash", "otpCode"],
  venueUsage: ["startTime", "endTime", "purpose", "notes"],
  venueUsageRequest: ["sentTo", "status", "errorMessage"],
  waitlist: ["name", "emailHash"],
  webAuthnChallenge: ["challenge", "purpose"],
}

/** Non-unique, non-id scalar String columns per Prisma delegate name, parsed from schema.prisma. */
function schemaStringColumns(): Record<string, string[]> {
  const schema = fs.readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8")
  const out: Record<string, string[]> = {}
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const delegate = m[1][0].toLowerCase() + m[1].slice(1)
    for (const line of m[2].split("\n")) {
      const f = /^\s+(\w+)\s+String(\?|\[\])?(\s|$)/.exec(line)
      if (!f || f[2] === "[]" || line.includes("@id") || line.includes("@unique")) continue
      ;(out[delegate] ??= []).push(f[1])
    }
  }
  return out
}

describe("plaintext column guard", () => {
  const cols = schemaStringColumns()

  it("has every text column encrypted or explicitly plain on purpose", () => {
    const unclassified: string[] = []
    for (const [model, fields] of Object.entries(cols)) {
      for (const f of fields) {
        const encrypted = FIELDS[model]?.includes(f) ?? false
        const plain = PLAIN_ON_PURPOSE[model]?.includes(f) ?? false
        if (!encrypted && !plain) unclassified.push(`${model}.${f}`)
      }
    }
    expect(unclassified).toEqual([])
  })

  it("has no stale PLAIN_ON_PURPOSE entries (column removed, or now encrypted)", () => {
    const stale: string[] = []
    for (const [model, fields] of Object.entries(PLAIN_ON_PURPOSE)) {
      for (const f of fields) {
        if (!cols[model]?.includes(f)) stale.push(`${model}.${f}: not a plain String column`)
        else if (FIELDS[model]?.includes(f)) stale.push(`${model}.${f}: encrypted, remove from list`)
      }
    }
    expect(stale).toEqual([])
  })
})
