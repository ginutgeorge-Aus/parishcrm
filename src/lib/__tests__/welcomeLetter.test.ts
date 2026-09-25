import { buildWelcomeLetterModel, fullName, fillTemplate, DEFAULT_INTRO, DEFAULT_CONTRIBUTIONS, DEFAULT_CLOSING } from "@/lib/welcomeLetter"
import type { LetterSettings } from "@/lib/letterSettings"

const SETTINGS: LetterSettings = {
  general: { fundLabel: "General Fund", bank: "ANZ Bank", bsb: "012345", account: "987654321", accountName: "Example Church", taxDeductible: false },
  building: { fundLabel: "Tithe / School Building Fund", bank: "ANZ Bank", bsb: "013999", account: "123456789", accountName: "Example Church School Building Fund", taxDeductible: true },
  signerName: "Mrs. Susan Miller",
  signerTitle: "Secretary",
  introTemplate: "",
  contributionsTemplate: "",
  closingTemplate: "",
}
const CHURCH = { name: "Example Community Church", address: "3 Example St, Sampletown, NSW, 2000", abn: "51 824 753 556", email: "x@example.org" }

const HEAD = { title: "Mr.", firstName: "Daniel", middleName: "Taylor", lastName: "Carter", suffix: null, motherParish: "Example Sister Church, London" }
const SPOUSE = { title: "Mrs.", firstName: "Grace", middleName: null, lastName: "Garcia", suffix: null, motherParish: null }

describe("fullName", () => {
  it("joins present name parts, skipping blanks", () => {
    expect(fullName(HEAD)).toBe("Mr. Daniel Taylor Carter")
    expect(fullName(SPOUSE)).toBe("Mrs. Grace Garcia")
  })
})

describe("buildWelcomeLetterModel", () => {
  const base = {
    family: { memberNo: "A10/12", address: "5 Sample Avenue", suburb: "Exampleton", state: "NSW", postcode: "2999" },
    members: [HEAD, SPOUSE],
    settings: SETTINGS,
    church: CHURCH,
    today: "6 August 2026",
    parishFields: true,
  }

  it("composes addressee, greeting, address lines and member list", () => {
    const m = buildWelcomeLetterModel(base)
    expect(m.addresseeName).toBe("Mr. Daniel Carter & Family")
    expect(m.greetingName).toBe("Mr. Daniel Taylor Carter")
    expect(m.addressLines).toEqual(["5 Sample Avenue", "Exampleton NSW 2999"])
    expect(m.members).toEqual(["Mr. Daniel Taylor Carter", "Mrs. Grace Garcia"])
    expect(m.memberNo).toBe("A10/12")
    expect(m.date).toBe("6 August 2026")
    expect(m.bankAccounts).toHaveLength(2)
    expect(m.signerName).toBe("Mrs. Susan Miller")
  })

  it("enables the transfer paragraph when a member has a mother parish", () => {
    const m = buildWelcomeLetterModel(base)
    expect(m.includeTransfer).toBe(true)
    expect(m.transferChurch).toBe("Example Sister Church, London")
    expect(m.bodyIntro).toContain("Example Sister Church, London")
    expect(m.bodyIntro).toContain("A10/12")
  })

  it("omits the transfer paragraph for a brand-new member (no mother parish)", () => {
    const m = buildWelcomeLetterModel({ ...base, members: [{ ...HEAD, motherParish: null }] })
    expect(m.includeTransfer).toBe(false)
    expect(m.transferChurch).toBe("")
    expect(m.bodyIntro).not.toContain("transfer letter")
    expect(m.bodyIntro).toContain("enrolled as members as Membership No. A10/12")
  })

  it("uses generic defaults when templates are blank", () => {
    const m = buildWelcomeLetterModel(base)
    const firstPara = fillTemplate(DEFAULT_INTRO, { churchName: CHURCH.name, memberNo: "A10/12" }).split("\n\n")[0]
    expect(m.bodyIntro.startsWith(firstPara)).toBe(true)
    expect(m.contributionsIntro).toBe(DEFAULT_CONTRIBUTIONS)
    expect(m.bodyClosing).toBe(DEFAULT_CLOSING)
    expect(m.bodyIntro).not.toMatch(/Vicar|parish/i)
  })

  it("inserts the enrol sentence after the first template paragraph", () => {
    const m = buildWelcomeLetterModel({ ...base, settings: { ...SETTINGS, introTemplate: "Welcome to {churchName}.\n\nPrayer." } })
    expect(m.bodyIntro).toBe(
      `Welcome to ${CHURCH.name}.\n\nWe are pleased to receive your transfer letter from Example Sister Church, London, and your family has been enrolled as members as Membership No. A10/12.\n\nPrayer.`
    )
  })

  it("omits transfer wording when parish fields are off", () => {
    const m = buildWelcomeLetterModel({ ...base, parishFields: false })
    expect(m.includeTransfer).toBe(false)
    expect(m.bodyIntro).not.toContain("transfer letter")
  })

  it("uses stored contributions/closing templates with placeholders filled", () => {
    const m = buildWelcomeLetterModel({ ...base, settings: { ...SETTINGS, contributionsTemplate: "Give to {churchName}", closingTemplate: "Bye" } })
    expect(m.contributionsIntro).toBe(`Give to ${CHURCH.name}`)
    expect(m.bodyClosing).toBe("Bye")
  })
})

describe("fillTemplate", () => {
  it("fills known placeholders and leaves unknown tokens verbatim", () => {
    expect(fillTemplate("{churchName} #{memberNo} {x}", { churchName: "C", memberNo: "7" })).toBe("C #7 {x}")
  })
})
