import { z } from "zod"

const VALID_GENDERS = ["MALE", "FEMALE", "OTHER"] as const
const VALID_ROLES = ["HEAD", "SPOUSE", "CHILD", "OTHER"] as const
const VALID_CLASSIFICATIONS = ["MEMBER", "VISITOR", "INACTIVE", "STUDENT"] as const

// Mirrors PersonSchema (src/lib/actions/person.ts) so CSV import can't write
// data the manual-entry form would reject — the only Person write path that
// previously skipped format/length validation.
const EMAIL_SCHEMA = z.string().email()
const EMAIL_MAX = 255
const MOBILE_MAX = 50
// Mirrors PersonSchema firstName/lastName (src/lib/actions/person.ts).
const NAME_MAX = 100
// Mirrors FamilySchema (src/lib/actions/family.ts).
const FAMILY_NAME_MAX = 200
const MEMBER_NO_MAX = 50
const ADDRESS_MAX = 500
const SUBURB_MAX = 100
const STATE_MAX = 50
const POSTCODE_MAX = 20

type CsvRow = {
  family: {
    name: string
    memberNo?: string
    address?: string
    suburb?: string
    state?: string
    postcode?: string
  }
  person: {
    firstName: string
    lastName: string
    dateOfBirth?: Date
    gender?: (typeof VALID_GENDERS)[number]
    role: (typeof VALID_ROLES)[number]
    classification: (typeof VALID_CLASSIFICATIONS)[number]
    email?: string
    mobile?: string
  }
}

export type CsvParseResult = {
  rows: CsvRow[]
  errors: Array<{ row: number; message: string }>
}

export type CheckResult = {
  rows: CsvParseResult["rows"]
  duplicates: string[]
  errors: CsvParseResult["errors"]
}

// RFC-4180-ish tokenizer: splits content into records of fields, honouring
// double-quoted fields (which may contain commas, CR/LF, and "" escaped quotes).
// Replaces naive line/comma splitting so a quoted address like "12 St, Apt 4"
// does not shift every subsequent column.
function parseCsvRecords(content: string): { records: string[][]; error?: string } {
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let inQuotes = false
  let sawField = false // tracks whether the current record has any content

  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++ } // escaped quote
        else inQuotes = false
      } else {
        field += c
      }
      continue
    }
    if (c === '"') { inQuotes = true; sawField = true; continue }
    if (c === ",") { record.push(field); field = ""; sawField = true; continue }
    if (c === "\r") continue
    if (c === "\n") {
      record.push(field)
      // Skip fully-blank lines so they don't become spurious empty records.
      if (sawField || record.length > 1 || record[0] !== "") records.push(record)
      record = []; field = ""; sawField = false
      continue
    }
    field += c
    sawField = true
  }
  // An unterminated quoted field has swallowed everything from the opening
  // quote to EOF into one field, silently merging subsequent physical lines.
  // Drop that corrupted trailing record and surface a structural parse error
  // instead of emitting it as if it were valid data.
  if (inQuotes) {
    return { records, error: "Unterminated quoted field — check for a missing closing quote (\")" }
  }
  record.push(field)
  if (sawField || record.length > 1 || record[0] !== "") records.push(record)
  return { records }
}

export function parseCsv(content: string): CsvParseResult {
  const { records, error: parseError } = parseCsvRecords(content.trim())
  const headers = (records[0] ?? []).map((h) => h.trim())

  const rows: CsvRow[] = []
  const errors: Array<{ row: number; message: string }> = []
  // Structural tokenizer error (e.g. unterminated quote): report it up front so
  // the import surfaces it; complete rows before the break still parse below.
  if (parseError) errors.push({ row: 0, message: parseError })

  // Null-prototype map: family_name is untrusted CSV input used as a key, so a
  // plain object would let values like `__proto__`/`constructor` pollute the
  // prototype chain. Object.create(null) has no inherited keys to clobber.
  const familyCache: Record<string, { memberNo?: string; address?: string; suburb?: string; state?: string; postcode?: string }> = Object.create(null)

  for (let i = 1; i < records.length; i++) {
    const rowNum = i + 1
    const values = records[i].map((v) => v.trim())
    const get = (col: string) => {
      const idx = headers.indexOf(col)
      return idx >= 0 ? values[idx] || undefined : undefined
    }

    const familyName = get("family_name")
    if (!familyName) {
      errors.push({ row: rowNum, message: "family_name is required" })
      continue
    }
    if (familyName.length > FAMILY_NAME_MAX) {
      errors.push({ row: rowNum, message: `family_name must be ${FAMILY_NAME_MAX} characters or fewer` })
      continue
    }

    const firstName = get("first_name")
    if (!firstName) {
      errors.push({ row: rowNum, message: "first_name is required" })
      continue
    }
    if (firstName.length > NAME_MAX) {
      errors.push({ row: rowNum, message: `first_name must be ${NAME_MAX} characters or fewer` })
      continue
    }

    const lastName = get("last_name")
    if (!lastName) {
      errors.push({ row: rowNum, message: "last_name is required" })
      continue
    }
    if (lastName.length > NAME_MAX) {
      errors.push({ row: rowNum, message: `last_name must be ${NAME_MAX} characters or fewer` })
      continue
    }

    const gender = get("gender")
    if (gender && !VALID_GENDERS.includes(gender as (typeof VALID_GENDERS)[number])) {
      errors.push({ row: rowNum, message: `gender must be one of ${VALID_GENDERS.join(", ")}` })
      continue
    }

    const role = get("role") ?? "OTHER"
    if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
      errors.push({ row: rowNum, message: `role must be one of ${VALID_ROLES.join(", ")}` })
      continue
    }

    const classification = get("classification") ?? "MEMBER"
    if (!VALID_CLASSIFICATIONS.includes(classification as (typeof VALID_CLASSIFICATIONS)[number])) {
      errors.push({ row: rowNum, message: `classification must be one of ${VALID_CLASSIFICATIONS.join(", ")}` })
      continue
    }

    const memberNoRaw = get("member_no")
    if (memberNoRaw && memberNoRaw.length > MEMBER_NO_MAX) {
      errors.push({ row: rowNum, message: `member_no must be ${MEMBER_NO_MAX} characters or fewer` })
      continue
    }
    const addressRaw = get("address")
    if (addressRaw && addressRaw.length > ADDRESS_MAX) {
      errors.push({ row: rowNum, message: `address must be ${ADDRESS_MAX} characters or fewer` })
      continue
    }
    const suburbRaw = get("suburb")
    if (suburbRaw && suburbRaw.length > SUBURB_MAX) {
      errors.push({ row: rowNum, message: `suburb must be ${SUBURB_MAX} characters or fewer` })
      continue
    }
    const stateRaw = get("state")
    if (stateRaw && stateRaw.length > STATE_MAX) {
      errors.push({ row: rowNum, message: `state must be ${STATE_MAX} characters or fewer` })
      continue
    }
    const postcodeRaw = get("postcode")
    if (postcodeRaw && postcodeRaw.length > POSTCODE_MAX) {
      errors.push({ row: rowNum, message: `postcode must be ${POSTCODE_MAX} characters or fewer` })
      continue
    }

    const memberNo = memberNoRaw ?? familyCache[familyName]?.memberNo
    const address = addressRaw ?? familyCache[familyName]?.address
    const suburb = suburbRaw ?? familyCache[familyName]?.suburb
    const state = stateRaw ?? familyCache[familyName]?.state
    const postcode = postcodeRaw ?? familyCache[familyName]?.postcode

    const emailRaw = get("email")
    if (emailRaw) {
      if (emailRaw.length > EMAIL_MAX) {
        errors.push({ row: rowNum, message: `email must be ${EMAIL_MAX} characters or fewer` })
        continue
      }
      if (!EMAIL_SCHEMA.safeParse(emailRaw).success) {
        errors.push({ row: rowNum, message: `email "${emailRaw}" is not a valid email address` })
        continue
      }
    }

    const mobileRaw = get("mobile")
    if (mobileRaw && mobileRaw.length > MOBILE_MAX) {
      errors.push({ row: rowNum, message: `mobile must be ${MOBILE_MAX} characters or fewer` })
      continue
    }

    const dobRaw = get("dob")
    let dateOfBirth: Date | undefined
    if (dobRaw) {
      const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dobRaw)
      const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobRaw)
      if (ddmmyyyy) {
        const day = Number.parseInt(ddmmyyyy[1], 10)
        const month = Number.parseInt(ddmmyyyy[2], 10)
        const year = Number.parseInt(ddmmyyyy[3], 10)
        if (month < 1 || month > 12 || day < 1 || day > 31) {
          errors.push({ row: rowNum, message: `dob "${dobRaw}" is not a valid date (expected DD/MM/YYYY)` })
        } else {
          const parsed = new Date(Date.UTC(year, month - 1, day))
          // Reconstruct-mismatch check catches impossible dates like 31/02 which
          // overflow into next month. Include the year: Date.UTC maps years 0-99
          // to 1900-1999 (e.g. 0050 -> 1950), which would otherwise pass silently.
          if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
            errors.push({ row: rowNum, message: `dob "${dobRaw}" is not a valid calendar date` })
          } else {
            dateOfBirth = parsed
          }
        }
      } else if (yyyymmdd) {
        const year = Number.parseInt(yyyymmdd[1], 10)
        const month = Number.parseInt(yyyymmdd[2], 10)
        const day = Number.parseInt(yyyymmdd[3], 10)
        const parsed = new Date(Date.UTC(year, month - 1, day))
        if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
          errors.push({ row: rowNum, message: `dob "${dobRaw}" is not a valid calendar date` })
        } else {
          dateOfBirth = parsed
        }
      } else {
        errors.push({ row: rowNum, message: `dob "${dobRaw}" is not a valid date (expected DD/MM/YYYY or YYYY-MM-DD)` })
      }
    }

    // Only commit family values to the cache once EVERY validation above has
    // passed — a row that `continue`s out never contributes its family fields to
    // the group backfill, so a later rejected row can't overwrite earlier
    // accepted rows' address/memberNo/etc.
    familyCache[familyName] = { memberNo, address, suburb, state, postcode }

    rows.push({
      family: { name: familyName, memberNo, address, suburb, state, postcode },
      person: {
        firstName,
        lastName,
        dateOfBirth,
        gender: gender as (typeof VALID_GENDERS)[number] | undefined,
        role: role as (typeof VALID_ROLES)[number],
        classification: classification as (typeof VALID_CLASSIFICATIONS)[number],
        email: emailRaw,
        mobile: mobileRaw,
      },
    })
  }

  // Family fields are forward-filled as each row is parsed above, so a value
  // that only appears on a LATER row of the group never reaches the EARLIER
  // rows already pushed onto `rows` — including row 0, which the import route
  // uses as the sole source of family data for the whole group's upsert. Once
  // every row has been parsed, familyCache[name] holds the fully-resolved
  // fields for that family; backfill every row in the group with it.
  for (const row of rows) {
    const resolved = familyCache[row.family.name]
    if (!resolved) continue
    row.family.memberNo = resolved.memberNo
    row.family.address = resolved.address
    row.family.suburb = resolved.suburb
    row.family.state = resolved.state
    row.family.postcode = resolved.postcode
  }

  return { rows, errors }
}
