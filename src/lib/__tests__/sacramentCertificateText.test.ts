import { certificateText, formatLongYmd, type CertificateSource } from "@/lib/sacraments"

const BASE: CertificateSource = {
  type: "CONFIRMATION",
  registerNo: "CON-2026-001",
  date: "2026-12-05",
  place: "St Mark",
  ministerName: null,
  person: { firstName: "Alex", lastName: "Sample" },
  spouse: null,
  spouseName: null,
  godparents: null,
}

describe("formatLongYmd", () => {
  it("formats without a time-zone shift", () => {
    expect(formatLongYmd("2026-03-01")).toBe("1 March 2026")
    expect(formatLongYmd("1999-12-31")).toBe("31 December 1999")
  })
})

describe("certificateText", () => {
  it("words a confirmation with no optional lines", () => {
    expect(certificateText(BASE)).toEqual({
      title: "Certificate of Confirmation",
      lead: "This is to certify that",
      names: "Alex Sample",
      statement: "was confirmed on 5 December 2026 at St Mark.",
      details: [],
      registerNo: "CON-2026-001",
    })
  })

  it("labels sponsors for a baptism as godparents, others as sponsors", () => {
    const bap = certificateText({ ...BASE, type: "BAPTISM", godparents: "Jane Roe", ministerName: "Fr A" })
    expect(bap.details).toEqual([
      { label: "Minister", value: "Fr A" },
      { label: "Godparents", value: "Jane Roe" },
    ])
    expect(certificateText({ ...BASE, godparents: "Jane Roe" }).details).toEqual([{ label: "Sponsors", value: "Jane Roe" }])
  })

  it("uses the CRM spouse's name, else the free-text one", () => {
    const crm = certificateText({ ...BASE, type: "MARRIAGE", spouse: { firstName: "Sam", lastName: "Other" } })
    expect(crm.names).toBe("Alex Sample and Sam Other")
    expect(crm.statement).toBe("were united in Holy Matrimony on 5 December 2026 at St Mark.")
    expect(certificateText({ ...BASE, type: "MARRIAGE", spouseName: "Out Side" }).names).toBe("Alex Sample and Out Side")
  })

  it("titles and words a first communion certificate", () => {
    expect(certificateText({ ...BASE, type: "FIRST_COMMUNION" }).title).toBe("Certificate of First Holy Communion")
  })
})
