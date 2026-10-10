/** @jest-environment node */
import { renderClearanceDigestEmail, NAMES_PER_BUCKET } from "@/lib/clearanceDigestEmail"
import type { ComplianceBuckets } from "@/lib/clearanceCompliance"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))

const empty: ComplianceBuckets = { expired: [], expiring: [], missing: [], unverified: [] }
const input = (b: Partial<ComplianceBuckets>, url: string | null = "https://crm.example.test/people/clearances") => ({
  churchName: "Test Church", asOf: "01/11/2026", buckets: { ...empty, ...b }, complianceUrl: url,
})

describe("renderClearanceDigestEmail", () => {
  const buckets: Partial<ComplianceBuckets> = {
    expired: [{ personId: 1, name: "Alex Testperson", types: ["WWCC"] }],
    expiring: [{ personId: 2, name: "Bo Sample", types: ["WWCC", "SAFE_MINISTRY"] }],
    missing: [{ personId: 3, name: "Cy Other", types: ["SAFE_MINISTRY"] }],
    unverified: [{ personId: 4, name: "Di Example", types: ["WWCC"] }],
  }

  it("has a church-named subject and the as-of date", () => {
    const r = renderClearanceDigestEmail(input(buckets))
    expect(r.subject).toBe("Clearance compliance digest — Test Church")
    expect(r.text).toContain("01/11/2026")
  })
  it("lists each bucket with count, names and the clearance types, in Expired/Expiring/Missing/Unverified order", () => {
    const { text } = renderClearanceDigestEmail(input(buckets))
    const order = ["Expired (1)", "Expiring within 60 days (1)", "Missing (1)", "Unverified (1)"].map((h) => text.indexOf(h))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text).toContain("Alex Testperson — Working With Children Check")
    expect(text).toContain("Bo Sample — Working With Children Check, Safe Ministry")
  })
  it("omits empty buckets", () => {
    const { text } = renderClearanceDigestEmail(input({ expired: buckets.expired }))
    expect(text).toContain("Expired (1)")
    expect(text).not.toContain("Missing (")
  })
  it("links to the compliance page and reminds admins to act on OCG barring alerts", () => {
    const r = renderClearanceDigestEmail(input(buckets))
    expect(r.html).toContain('href="https://crm.example.test/people/clearances"')
    expect(r.text).toContain("https://crm.example.test/people/clearances")
    expect(r.text).toMatch(/barring alert/i)
    expect(r.html).toMatch(/barring alert/i)
  })
  it("falls back to a navigation hint when there is no base URL", () => {
    const r = renderClearanceDigestEmail(input(buckets, null))
    expect(r.html).not.toContain("href=")
    expect(r.text).toContain("People > Clearances")
  })
  it("HTML-escapes names", () => {
    const r = renderClearanceDigestEmail(input({ missing: [{ personId: 9, name: "<b>Eve</b> & Co", types: ["WWCC"] }] }))
    expect(r.html).toContain("&lt;b&gt;Eve&lt;/b&gt; &amp; Co")
    expect(r.html).not.toContain("<b>Eve</b>")
  })
  it("caps names per bucket and says how many were left out", () => {
    const many = Array.from({ length: NAMES_PER_BUCKET + 3 }, (_, i) => ({ personId: i, name: `Person ${i}`, types: ["WWCC" as const] }))
    const { text } = renderClearanceDigestEmail(input({ missing: many }))
    expect(text).toContain(`Missing (${NAMES_PER_BUCKET + 3})`)
    expect(text).toContain("and 3 more")
    expect(text).not.toContain(`Person ${NAMES_PER_BUCKET + 2}`)
  })
  it("states that it carries no numbers or dates of birth", () => {
    expect(renderClearanceDigestEmail(input(buckets)).text).toMatch(/no WWCC numbers or dates of birth/i)
  })
})
