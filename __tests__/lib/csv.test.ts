import { parseCsv } from "@/lib/csv"

const HEADER = "family_name,address,suburb,state,postcode,first_name,last_name,dob,gender,role,classification,email,mobile"

describe("parseCsv", () => {
  it("parses a valid two-person family", () => {
    const csv = [
      HEADER,
      "Smith,12 High St,Sampletown,NSW,2150,John,Smith,1980-01-15,MALE,HEAD,MEMBER,john@test.com,0400000001",
      "Smith,,,,,Jane,Smith,1983-06-20,FEMALE,SPOUSE,MEMBER,jane@test.com,0400000002",
    ].join("\n")

    const result = parseCsv(csv)

    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].family.name).toBe("Smith")
    expect(result.rows[0].family.address).toBe("12 High St")
    expect(result.rows[1].family.address).toBe("12 High St") // inherited
    expect(result.rows[0].person.firstName).toBe("John")
    expect(result.rows[1].person.firstName).toBe("Jane")
  })

  it("backfills family fields onto earlier rows when only a later row supplies them", () => {
    const csv = [
      HEADER,
      "Smith,,,,,John,Smith,,,HEAD,MEMBER,,",
      "Smith,,,,,Jane,Smith,,,SPOUSE,MEMBER,,",
      "Smith,12 High St,Sampletown,NSW,2150,Jack,Smith,,,CHILD,MEMBER,,",
    ].join("\n")

    const result = parseCsv(csv)

    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(3)
    // The address only appears on the 3rd (last) row of the group — every row
    // in the group, including the 1st, must end up with it. The import route
    // upserts the Family record using only the FIRST row's family object, so
    // a value that never reaches row 0 is silently dropped from the database.
    expect(result.rows[0].family.address).toBe("12 High St")
    expect(result.rows[1].family.address).toBe("12 High St")
    expect(result.rows[2].family.address).toBe("12 High St")
    expect(result.rows[0].family.suburb).toBe("Sampletown")
    expect(result.rows[0].family.state).toBe("NSW")
    expect(result.rows[0].family.postcode).toBe("2150")
  })

  it("does not pollute the prototype via a __proto__ family_name", () => {
    const csv = [
      HEADER,
      "__proto__,12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,",
      "Smith,,,,,Jane,Smith,,,HEAD,MEMBER,,",
    ].join("\n")

    const result = parseCsv(csv)

    // The malicious key must not have mutated Object's prototype, and the
    // second family must still resolve its own (blank) inherited fields — not
    // values leaked from a polluted prototype.
    expect(({} as Record<string, unknown>).address).toBeUndefined()
    expect(result.rows[1].family.name).toBe("Smith")
    expect(result.rows[1].family.address).toBeUndefined()
  })

  it("handles a quoted field containing a comma without shifting columns", () => {
    const csv = [
      HEADER,
      'Smith,"12 High St, Apt 4",Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,',
    ].join("\n")

    const result = parseCsv(csv)

    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].family.address).toBe("12 High St, Apt 4")
    expect(result.rows[0].family.suburb).toBe("Sampletown")
    expect(result.rows[0].family.postcode).toBe("2150")
    expect(result.rows[0].person.firstName).toBe("John")
  })

  it("handles escaped double-quotes inside a quoted field", () => {
    const csv = [
      HEADER,
      'Smith,"12 ""A"" St",Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,',
    ].join("\n")

    const result = parseCsv(csv)

    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].family.address).toBe('12 "A" St')
  })

  it("returns error for missing family_name", () => {
    const csv = [HEADER, ",12 High St,Sampletown,NSW,2150,John,Smith,,,HEAD,MEMBER,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(2)
    expect(result.errors[0].message).toMatch(/family_name/)
  })

  it("returns error for missing first_name", () => {
    const csv = [HEADER, "Smith,,,,,,,,,HEAD,MEMBER,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/first_name/)
  })

  it("returns error for invalid gender enum", () => {
    const csv = [HEADER, "Smith,,,,,John,Smith,,ALIEN,HEAD,MEMBER,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/gender/)
  })

  it("returns error for invalid role enum", () => {
    const csv = [HEADER, "Smith,,,,,John,Smith,,,BOSS,MEMBER,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/role/)
  })

  it("parses date of birth correctly", () => {
    const csv = [HEADER, "Smith,,,,,John,Smith,1990-03-25,,HEAD,MEMBER,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.rows[0].person.dateOfBirth).toEqual(new Date("1990-03-25"))
  })

  it("handles empty optional fields gracefully", () => {
    const csv = [HEADER, "Smith,,,,,John,Smith,,,HEAD,MEMBER,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].person.email).toBeUndefined()
    expect(result.rows[0].person.mobile).toBeUndefined()
  })

  describe("email/mobile validation and length caps", () => {
    it("accepts a valid email", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,,,HEAD,MEMBER,john@test.com,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].person.email).toBe("john@test.com")
    })

    it("returns a row error for a malformed email and skips the row", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,,,HEAD,MEMBER,not-an-email,"].join("\n")
      const result = parseCsv(csv)
      expect(result.rows).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].row).toBe(2)
      expect(result.errors[0].message).toMatch(/email/i)
    })

    it("returns a row error for an email over 255 characters", () => {
      const longEmail = `${"a".repeat(250)}@test.com` // > 255 chars total
      const csv = [HEADER, `Smith,,,,,John,Smith,,,HEAD,MEMBER,${longEmail},`].join("\n")
      const result = parseCsv(csv)
      expect(result.rows).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/email/i)
    })

    it("returns a row error for a mobile over 50 characters", () => {
      const longMobile = "0".repeat(51)
      const csv = [HEADER, `Smith,,,,,John,Smith,,,HEAD,MEMBER,,${longMobile}`].join("\n")
      const result = parseCsv(csv)
      expect(result.rows).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/mobile/i)
    })

    it("accepts a mobile at exactly 50 characters", () => {
      const mobile = "0".repeat(50)
      const csv = [HEADER, `Smith,,,,,John,Smith,,,HEAD,MEMBER,,${mobile}`].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].person.mobile).toBe(mobile)
    })
  })

  describe("family field length caps", () => {
    it("returns a row error for an address over 500 characters", () => {
      const longAddress = "a".repeat(501)
      const csv = [HEADER, `Smith,"${longAddress}",,,,John,Smith,,,HEAD,MEMBER,,`].join("\n")
      const result = parseCsv(csv)
      expect(result.rows).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/address/i)
    })

    it("returns a row error for a suburb over 100 characters", () => {
      const longSuburb = "a".repeat(101)
      const csv = [HEADER, `Smith,,${longSuburb},,,John,Smith,,,HEAD,MEMBER,,`].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/suburb/i)
    })

    it("returns a row error for a state over 50 characters", () => {
      const longState = "a".repeat(51)
      const csv = [HEADER, `Smith,,,${longState},,John,Smith,,,HEAD,MEMBER,,`].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/state/i)
    })

    it("returns a row error for a postcode over 20 characters", () => {
      const longPostcode = "1".repeat(21)
      const csv = [HEADER, `Smith,,,,${longPostcode},John,Smith,,,HEAD,MEMBER,,`].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/postcode/i)
    })

    it("returns a row error for a member_no over 50 characters", () => {
      const longMemberNo = "a".repeat(51)
      const csv = [
        "family_name,member_no,address,suburb,state,postcode,first_name,last_name,dob,gender,role,classification,email,mobile",
        `Smith,${longMemberNo},,,,,John,Smith,,,HEAD,MEMBER,,`,
      ].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/member_no/i)
    })
  })

  it("parses member_no when present", () => {
    const csv = [
      "family_name,member_no,address,suburb,state,postcode,first_name,last_name,dob,gender,role,classification,email,mobile",
      "Smith,C90/91,,,,,John,Smith,,,HEAD,MEMBER,,",
      "Smith,,,,,,Jane,Smith,,,SPOUSE,MEMBER,,",
    ].join("\n")
    const result = parseCsv(csv)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].family.memberNo).toBe("C90/91")
    expect(result.rows[1].family.memberNo).toBe("C90/91") // inherited
  })

  it("member_no is undefined when column absent", () => {
    const csv = [HEADER, "Smith,,,,,John,Smith,,,HEAD,MEMBER,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.rows[0].family.memberNo).toBeUndefined()
  })

  it("returns error for invalid classification enum", () => {
    const csv = [HEADER, "Smith,,,,,John,Smith,,,HEAD,UNKNOWN,,"].join("\n")
    const result = parseCsv(csv)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/classification/)
  })

  describe("DD/MM/YYYY date parsing", () => {
    it("parses 01/02/1990 as 1 Feb 1990, not 2 Jan (US M/D)", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,01/02/1990,,HEAD,MEMBER,,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(0)
      const dob = result.rows[0].person.dateOfBirth!
      expect(dob).toBeInstanceOf(Date)
      expect(dob.getUTCMonth()).toBe(1) // Feb is month index 1
      expect(dob.getUTCDate()).toBe(1)
      expect(dob.getUTCFullYear()).toBe(1990)
    })

    it("parses 31/12/1990 as 31 Dec 1990 (not Invalid Date)", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,31/12/1990,,HEAD,MEMBER,,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(0)
      const dob = result.rows[0].person.dateOfBirth!
      expect(dob).toBeInstanceOf(Date)
      expect(isNaN(dob.getTime())).toBe(false)
      expect(dob.getUTCMonth()).toBe(11) // Dec is month index 11
      expect(dob.getUTCDate()).toBe(31)
      expect(dob.getUTCFullYear()).toBe(1990)
    })

    it("produces a row error for day 32 (impossible date)", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,32/01/1990,,HEAD,MEMBER,,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].row).toBe(2)
      expect(result.errors[0].message).toMatch(/dob/)
      expect(result.rows[0].person.dateOfBirth).toBeUndefined()
    })

    it("produces a row error for 31/02/1990 (impossible calendar date)", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,31/02/1990,,HEAD,MEMBER,,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/dob/)
      expect(result.rows[0].person.dateOfBirth).toBeUndefined()
    })

    it("produces a row error for month 13", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,01/13/1990,,HEAD,MEMBER,,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/dob/)
    })

    it("produces a row error for non-numeric dob", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,not-a-date,,HEAD,MEMBER,,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/dob/)
    })

    it("still accepts ISO format YYYY-MM-DD", () => {
      const csv = [HEADER, "Smith,,,,,John,Smith,1990-03-25,,HEAD,MEMBER,,"].join("\n")
      const result = parseCsv(csv)
      expect(result.errors).toHaveLength(0)
      const dob = result.rows[0].person.dateOfBirth!
      expect(dob.getUTCMonth()).toBe(2) // March is month index 2
      expect(dob.getUTCDate()).toBe(25)
      expect(dob.getUTCFullYear()).toBe(1990)
    })
  })
})
