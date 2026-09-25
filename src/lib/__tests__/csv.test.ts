import { parseCsv } from "@/lib/csv"

// parseCsv is a pure RFC-4180-ish family-import parser (no DB). These tests lock
// in the behaviours that history shows are subtle: quoted-field tokenizing,
// family-field inheritance, DD/MM/YYYY vs ISO date disambiguation with a
// calendar reconstruct check, and the prototype-pollution guard.

const HEADER =
  "family_name,first_name,last_name,role,classification,gender,member_no,address,suburb,state,postcode,email,mobile,dob"

describe("parseCsv — basic parsing", () => {
  it("parses a header + one full row into the expected shape", () => {
    const csv = `${HEADER}\nSmith,John,Smith,HEAD,MEMBER,MALE,C1/2,12 Main St,Springfield,NSW,2300,john@example.com,0400000000,15/05/1990`
    const { rows, errors } = parseCsv(csv)

    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].family).toEqual({
      name: "Smith",
      memberNo: "C1/2",
      address: "12 Main St",
      suburb: "Springfield",
      state: "NSW",
      postcode: "2300",
    })
    expect(rows[0].person).toMatchObject({
      firstName: "John",
      lastName: "Smith",
      role: "HEAD",
      classification: "MEMBER",
      gender: "MALE",
      email: "john@example.com",
      mobile: "0400000000",
    })
    expect(rows[0].person.dateOfBirth?.toISOString()).toBe("1990-05-15T00:00:00.000Z")
  })

  it("defaults role to OTHER and classification to MEMBER when omitted", () => {
    const csv = "family_name,first_name,last_name\nDoe,Jane,Doe"
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].person.role).toBe("OTHER")
    expect(rows[0].person.classification).toBe("MEMBER")
  })

  it("trims whitespace around headers and values", () => {
    const csv = " family_name , first_name , last_name \n Smith , John , Smith "
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].family.name).toBe("Smith")
    expect(rows[0].person.firstName).toBe("John")
  })

  it("ignores blank lines instead of emitting spurious empty rows", () => {
    const csv = `${HEADER}\n\nSmith,John,Smith\n\n`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
  })
})

describe("parseCsv — quoted fields (RFC-4180)", () => {
  it("keeps a comma inside a quoted field without shifting columns", () => {
    const csv = `${HEADER}\nSmith,John,Smith,HEAD,MEMBER,,,"12 St, Apt 4",Springfield,NSW,2300,,,`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].family.address).toBe("12 St, Apt 4")
    expect(rows[0].family.suburb).toBe("Springfield")
  })

  it("unescapes doubled quotes inside a quoted field", () => {
    const csv = `${HEADER}\n"O""Brien",John,Smith,HEAD,MEMBER,,,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].family.name).toBe('O"Brien')
  })

  it("preserves CRLF line endings and a newline inside a quoted field", () => {
    const csv = `${HEADER}\r\nSmith,John,Smith,HEAD,MEMBER,,,"Line1\nLine2",Springfield,NSW,2300,,,`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].family.address).toBe("Line1\nLine2")
  })
})

describe("parseCsv — required fields", () => {
  it.each([
    ["family_name", ",John,Smith", "family_name is required"],
    ["first_name", "Smith,,Smith", "first_name is required"],
    ["last_name", "Smith,John,", "last_name is required"],
  ])("flags a missing %s and skips the row", (_field, line, message) => {
    const csv = `family_name,first_name,last_name\n${line}`
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors).toEqual([{ row: 2, message }])
  })

  it("reports the 1-indexed source line number in errors", () => {
    const csv = "family_name,first_name,last_name\nSmith,John,Smith\n,X,Y"
    const { errors } = parseCsv(csv)
    expect(errors).toEqual([{ row: 3, message: "family_name is required" }])
  })
})

describe("parseCsv — enum validation", () => {
  it.each([
    ["gender", "gender", "NONBINARY", "gender must be one of MALE, FEMALE, OTHER"],
    ["role", "role", "PARENT", "role must be one of HEAD, SPOUSE, CHILD, OTHER"],
    [
      "classification",
      "classification",
      "GUEST",
      "classification must be one of MEMBER, VISITOR, INACTIVE, STUDENT",
    ],
  ])("rejects an invalid %s value", (_name, col, bad, message) => {
    const csv = `family_name,first_name,last_name,${col}\nSmith,John,Smith,${bad}`
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors).toEqual([{ row: 2, message }])
  })
})

describe("parseCsv — length + email validation", () => {
  it.each([
    ["member_no", 50],
    ["address", 500],
    ["suburb", 100],
    ["state", 50],
    ["postcode", 20],
    ["mobile", 50],
  ])("rejects %s longer than %i characters", (col, max) => {
    const csv = `family_name,first_name,last_name,${col}\nSmith,John,Smith,${"x".repeat(max + 1)}`
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toContain(`${max} characters or fewer`)
  })

  it("rejects a malformed email address", () => {
    const csv = "family_name,first_name,last_name,email\nSmith,John,Smith,not-an-email"
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toContain("is not a valid email address")
  })

  it("rejects an email longer than 255 characters", () => {
    const long = `${"a".repeat(250)}@x.com`
    const csv = `family_name,first_name,last_name,email\nSmith,John,Smith,${long}`
    const { errors } = parseCsv(csv)
    expect(errors[0].message).toContain("255 characters or fewer")
  })
})

describe("parseCsv — dob date parsing", () => {
  it("parses DD/MM/YYYY as day-first, not US month-first", () => {
    // 01/02/1990 must be 1 Feb 1990, never 2 Jan 1990 (bare new Date is US M/D).
    const csv = "family_name,first_name,last_name,dob\nSmith,John,Smith,01/02/1990"
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].person.dateOfBirth?.toISOString()).toBe("1990-02-01T00:00:00.000Z")
  })

  it("parses an ISO YYYY-MM-DD date", () => {
    const csv = "family_name,first_name,last_name,dob\nSmith,John,Smith,1990-02-01"
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].person.dateOfBirth?.toISOString()).toBe("1990-02-01T00:00:00.000Z")
  })

  // A malformed dob is reported as a row error but the row is kept with dob
  // omitted — never a thrown Invalid Date (csv-import rule /).
  it("flags an impossible calendar date (31/02) and keeps the row without a dob", () => {
    const csv = "family_name,first_name,last_name,dob\nSmith,John,Smith,31/02/1990"
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].person.dateOfBirth).toBeUndefined()
    expect(errors[0].message).toContain("not a valid calendar date")
  })

  it("flags an out-of-range month/day in DD/MM/YYYY and keeps the row without a dob", () => {
    const csv = "family_name,first_name,last_name,dob\nSmith,John,Smith,10/13/1990"
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].person.dateOfBirth).toBeUndefined()
    expect(errors[0].message).toContain("expected DD/MM/YYYY")
  })

  it("flags an unrecognised date format and keeps the row without a dob", () => {
    const csv = "family_name,first_name,last_name,dob\nSmith,John,Smith,May 5 1990"
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].person.dateOfBirth).toBeUndefined()
    expect(errors[0].message).toContain("DD/MM/YYYY or YYYY-MM-DD")
  })
})

describe("parseCsv — family field inheritance", () => {
  it("inherits family fields from the first row in a same-name group", () => {
    const csv = `${HEADER}
Smith,John,Smith,HEAD,MEMBER,,C1/2,12 Main St,Springfield,NSW,2300,,,
Smith,Jane,Smith,SPOUSE,MEMBER,,,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    // Second Smith row supplied no family columns → inherits the first row's.
    expect(rows[1].family).toEqual({
      name: "Smith",
      memberNo: "C1/2",
      address: "12 Main St",
      suburb: "Springfield",
      state: "NSW",
      postcode: "2300",
    })
  })

  it("does not leak family fields across different family names", () => {
    const csv = `${HEADER}
Smith,John,Smith,HEAD,MEMBER,,C1/2,12 Main St,Springfield,NSW,2300,,,
Jones,Amy,Jones,HEAD,MEMBER,,,,,,,,,`
    const { rows } = parseCsv(csv)
    expect(rows[1].family.memberNo).toBeUndefined()
    expect(rows[1].family.address).toBeUndefined()
  })
})

describe("parseCsv — prototype-pollution guard", () => {
  it("treats a __proto__ family name as ordinary data without polluting Object.prototype", () => {
    const csv = `${HEADER}\n__proto__,John,Smith,HEAD,MEMBER,,C9/9,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].family.name).toBe("__proto__")
    // The familyCache is Object.create(null); a "__proto__" key must be an own
    // property of the cache, never a mutation of the global prototype chain.
    expect(({} as Record<string, unknown>).memberNo).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty("memberNo")
  })

  it("does not let a constructor family name corrupt inheritance lookups", () => {
    const csv = `${HEADER}
constructor,John,Smith,HEAD,MEMBER,,C7/7,7 St,Suburb,NSW,2000,,,
constructor,Jane,Smith,SPOUSE,MEMBER,,,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[1].family.memberNo).toBe("C7/7")
    expect(rows[1].family.address).toBe("7 St")
  })
})

describe("parseCsv — name length caps mirror the form", () => {
  it("rejects a family_name over 200 chars", () => {
    const csv = `${HEADER}\n${"x".repeat(201)},John,Smith,HEAD,MEMBER,,,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toMatch(/family_name must be 200 characters or fewer/)
  })

  it("rejects a first_name over 100 chars", () => {
    const csv = `${HEADER}\nSmith,${"x".repeat(101)},Smith,HEAD,MEMBER,,,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toMatch(/first_name must be 100 characters or fewer/)
  })

  it("rejects a last_name over 100 chars", () => {
    const csv = `${HEADER}\nSmith,John,${"x".repeat(101)},HEAD,MEMBER,,,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toMatch(/last_name must be 100 characters or fewer/)
  })

  it("accepts names exactly at the cap", () => {
    const csv = `${HEADER}\n${"x".repeat(200)},${"y".repeat(100)},${"z".repeat(100)},HEAD,MEMBER,,,,,,,,,`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
  })
})

describe("parseCsv — dob year rollover guard", () => {
  it("rejects a 0-99 year that Date.UTC would silently map to 1900-1999 (DD/MM/YYYY)", () => {
    // Malformed dob is recorded as an error and omitted; the row itself is kept.
    const csv = `${HEADER}\nSmith,John,Smith,HEAD,MEMBER,,,,,,,,,01/01/0050`
    const { rows, errors } = parseCsv(csv)
    expect(errors.some((e) => /is not a valid calendar date/.test(e.message))).toBe(true)
    expect(rows[0].person.dateOfBirth).toBeUndefined()
  })

  it("rejects the same rollover in ISO form", () => {
    const csv = `${HEADER}\nSmith,John,Smith,HEAD,MEMBER,,,,,,,,,0050-01-01`
    const { rows, errors } = parseCsv(csv)
    expect(errors.some((e) => /is not a valid calendar date/.test(e.message))).toBe(true)
    expect(rows[0].person.dateOfBirth).toBeUndefined()
  })

  it("still accepts a normal 4-digit year", () => {
    const csv = `${HEADER}\nSmith,John,Smith,HEAD,MEMBER,,,,,,,,,15/05/1990`
    const { rows, errors } = parseCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].person.dateOfBirth?.getUTCFullYear()).toBe(1990)
  })
})

describe("parseCsv — rejected rows never contribute family data", () => {
  it("does not backfill an earlier accepted row with a later rejected row's address", () => {
    const good = "Smith,John,Smith,HEAD,MEMBER,MALE,C1/2,10 First St,Springfield,NSW,2300,john@example.com,0400000000,"
    // Same family, different address, but an invalid email → row is rejected.
    const rejected = "Smith,Jane,Smith,SPOUSE,MEMBER,FEMALE,C1/2,99 Wrong Rd,Springfield,NSW,2300,not-an-email,,"
    const { rows, errors } = parseCsv(`${HEADER}\n${good}\n${rejected}`)
    expect(rows).toHaveLength(1)
    expect(errors.some((e) => /not a valid email/.test(e.message))).toBe(true)
    // The rejected row's "99 Wrong Rd" must not propagate onto the accepted row.
    expect(rows[0].family.address).toBe("10 First St")
  })
})

describe("parseCsv — unterminated quoted field", () => {
  it("reports a parse error instead of emitting a corrupted merged row", () => {
    const row = 'Smith,John,Smith,HEAD,MEMBER,MALE,C1/2,"12 Unclosed St,Springfield,NSW,2300,john@example.com,0400000000,15/05/1990'
    const { rows, errors } = parseCsv(`${HEADER}\n${row}`)
    expect(errors.some((e) => /nterminated/.test(e.message))).toBe(true)
    // The swallowed record must not reach rows as a corrupted single-field row.
    expect(rows).toHaveLength(0)
  })
})
