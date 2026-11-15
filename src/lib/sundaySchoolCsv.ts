// Sunday School CSV: enrolment import parser (pure, no DB) and roster export.
// Reuses the family/person importer's tokenizer (src/lib/csv.ts) and the shared
// formula-injection guard (src/lib/csvUtils.ts).

import { parseCsvRecords } from "@/lib/csv"
import { escapeCsv } from "@/lib/csvUtils"

/** Row cap per import; keeps the single transaction well inside its timeout. */
export const MAX_ENROL_ROWS = 2000
/** File size cap in bytes (1 MB: ~2000 short rows is far smaller). */
export const MAX_ENROL_BYTES = 1024 * 1024

const NAME_MAX = 100 // mirrors PersonSchema
const FAMILY_NAME_MAX = 200 // mirrors FamilySchema
const CLASS_NAME_MAX = 80 // mirrors ClassFormSchema
const LOCATION_MAX = 80
const REQUIRED = ["family_name", "first_name", "last_name", "class_name"] as const

/** One validated CSV row. `row` is the 1-based spreadsheet row (header = 1). */
export type EnrolCsvRow = {
  row: number
  familyName: string
  firstName: string
  lastName: string
  className: string
  location?: string
}

export type EnrolCsvParse = { rows: EnrolCsvRow[]; errors: Array<{ row: number; message: string }> }

/** Sample file offered for download in the UI. Synthetic names only. */
export const ENROL_SAMPLE_CSV = `family_name,first_name,last_name,class_name,location
Smith,Ava,Smith,Years 1-2,
Smith,Ben,Smith,Kindy,Main hall
Jones,Cara,Jones,Years 1-2,`

/**
 * Parse an enrolment CSV. Required columns: family_name, first_name, last_name,
 * class_name; optional: location (needed only when two classes share a name).
 * Every row is validated; failures are reported per row and never thrown. A
 * student listed twice for the same class is collapsed; for two different
 * classes the later row is an error (one class per child per year).
 * @param content raw file text
 */
export function parseEnrolmentCsv(content: string): EnrolCsvParse {
  const { records, error: parseError } = parseCsvRecords(content.replace(/^﻿/, "").trim())
  const errors: EnrolCsvParse["errors"] = []
  if (parseError) errors.push({ row: 0, message: parseError })
  const headers = (records[0] ?? []).map((h) => h.trim().toLowerCase())
  const missing = REQUIRED.filter((c) => !headers.includes(c))
  if (missing.length > 0) {
    errors.push({ row: 1, message: `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}` })
    return { rows: [], errors }
  }
  if (records.length - 1 > MAX_ENROL_ROWS) {
    errors.push({ row: 0, message: `File has too many rows (max ${MAX_ENROL_ROWS}). Split it into smaller files.` })
    return { rows: [], errors }
  }

  const rows: EnrolCsvRow[] = []
  // Null-prototype: keys are untrusted CSV text (see csv.ts familyCache).
  const seen: Record<string, string> = Object.create(null)
  for (let i = 1; i < records.length; i++) {
    const rowNum = i + 1
    const values = records[i].map((v) => v.trim())
    const get = (col: string): string => values[headers.indexOf(col)] ?? ""
    const bad = checkRow(get)
    if (bad) { errors.push({ row: rowNum, message: bad }); continue }
    const out: EnrolCsvRow = {
      row: rowNum, familyName: get("family_name"), firstName: get("first_name"),
      lastName: get("last_name"), className: get("class_name"), location: get("location") || undefined,
    }
    const key = [out.familyName, out.firstName, out.lastName].map((s) => s.toLowerCase()).join("\u0000")
    const target = `${out.className.toLowerCase()}\u0000${(out.location ?? "").toLowerCase()}`
    const prior = seen[key]
    if (prior === undefined) {
      seen[key] = target
      rows.push(out)
    } else if (prior !== target) {
      errors.push({ row: rowNum, message: `${out.firstName} ${out.lastName} is already listed for a different class in this file` })
    }
  }
  return { rows, errors }
}

/** First validation message for a row's required fields and length caps, or null. */
function checkRow(get: (col: string) => string): string | null {
  const caps: Array<[string, number]> = [
    ["family_name", FAMILY_NAME_MAX], ["first_name", NAME_MAX], ["last_name", NAME_MAX],
    ["class_name", CLASS_NAME_MAX], ["location", LOCATION_MAX],
  ]
  for (const col of REQUIRED) if (!get(col)) return `${col} is required`
  for (const [col, max] of caps) if (get(col).length > max) return `${col} must be ${max} characters or fewer`
  return null
}

/** One roster line: only fields the class page already shows to every viewer. */
export type RosterRow = { firstName: string; lastName: string; familyName: string }

/**
 * Class roster CSV: Student, Family, Class, Level, Location, Year. Names only
 * (no contact details, DOB or notes). Every cell passes escapeCsv so a name
 * like "=cmd" is neutralised.
 * @param cls the class (name, level, location, year)
 * @param students enrolled live children, already ordered
 */
export function buildRosterCsv(
  cls: { name: string; level: number; location: string; year: number },
  students: RosterRow[],
): string {
  const lines = [["Student", "Family", "Class", "Level", "Location", "Year"].join(",")]
  for (const s of students) {
    lines.push([`${s.firstName} ${s.lastName}`, s.familyName, cls.name, cls.level, cls.location, cls.year].map(escapeCsv).join(","))
  }
  return `${lines.join("\r\n")}\r\n`
}

/**
 * Download filename for a class roster, safe for a Content-Disposition header.
 * @param cls the class (name, year)
 */
export function rosterFilename(cls: { name: string; year: number }): string {
  const slug = cls.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "class"
  return `sunday-school-${slug}-${cls.year}.csv`
}
