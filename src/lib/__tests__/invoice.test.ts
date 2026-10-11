import {
  lineGstCents, computeInvoiceTotals, centsToDecimalString, formatInvoiceNo, parseInvoiceDraft,
} from "@/lib/invoice"

const line = (o: Partial<{ description: string; qty: number; unitPriceCents: number; gst: boolean }> = {}) =>
  ({ description: "Hall hire", qty: 1, unitPriceCents: 10000, gst: true, ...o })

describe("lineGstCents", () => {
  it("is 10% of the line total when GST is on", () => expect(lineGstCents(line(), true)).toBe(1000))
  it("is 0 when the line is not GST-able", () => expect(lineGstCents(line({ gst: false }), true)).toBe(0))
  it("is 0 when the church is not GST registered", () => expect(lineGstCents(line(), false)).toBe(0))
  it("rounds half up to the cent", () => expect(lineGstCents(line({ unitPriceCents: 1005 }), true)).toBe(101))
  it("multiplies by quantity before rounding", () => expect(lineGstCents(line({ qty: 3, unitPriceCents: 333 }), true)).toBe(100))
})

describe("computeInvoiceTotals", () => {
  it("sums subtotal, GST and total", () => {
    expect(computeInvoiceTotals([line(), line({ qty: 2, unitPriceCents: 2550, gst: false })], true))
      .toEqual({ subtotalCents: 15100, gstCents: 1000, totalCents: 16100 })
  })
  it("returns zeros for no lines", () => {
    expect(computeInvoiceTotals([], true)).toEqual({ subtotalCents: 0, gstCents: 0, totalCents: 0 })
  })
})

describe("centsToDecimalString", () => {
  it.each([[0, "0.00"], [5, "0.05"], [123456, "1234.56"], [100, "1.00"]])("%i → %s", (c, s) =>
    expect(centsToDecimalString(c)).toBe(s))
  it("throws on non-integer or negative", () => {
    expect(() => centsToDecimalString(1.5)).toThrow()
    expect(() => centsToDecimalString(-1)).toThrow()
  })
})

describe("formatInvoiceNo", () => {
  it("pads to 4 digits", () => expect(formatInvoiceNo(7)).toBe("INV-0007"))
  it("grows past 9999", () => expect(formatInvoiceNo(12345)).toBe("INV-12345"))
})

function fd(over: Record<string, string> = {}, lines: unknown = [{ description: "Hall hire", qty: "2", unitPrice: "150.00", gst: true }]) {
  const f = new FormData()
  const base: Record<string, string> = {
    recipientKind: "customer", recipientId: "3", recipientName: "Example Scouts",
    recipientEmail: "scouts@example.com", recipientAddress: "1 Example St",
    issueDate: "2026-10-11", dueDate: "2026-10-25", accountId: "4", fundId: "", notes: "",
    lines: JSON.stringify(lines), ...over,
  }
  for (const [k, v] of Object.entries(base)) f.set(k, v)
  return f
}

describe("parseInvoiceDraft", () => {
  it("parses a valid draft into cents", () => {
    const r = parseInvoiceDraft(fd())
    expect("data" in r && r.data).toMatchObject({
      recipientKind: "customer", recipientId: 3, accountId: 4, fundId: null,
      lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
    })
  })
  it("allows a manual recipient with no link", () => {
    const r = parseInvoiceDraft(fd({ recipientKind: "none", recipientId: "" }))
    expect("data" in r && r.data.recipientId).toBeNull()
  })
  it.each([
    [{ recipientName: "" }, "Recipient name is required"],
    [{ recipientEmail: "nope" }, "Enter a valid email"],
    [{ issueDate: "2026-02-30" }, "Invalid issue date"],
    [{ dueDate: "2026-10-01" }, "Due date must be on or after the issue date"],
    [{ accountId: "" }, "Choose an income account"],
  ])("rejects %o", (over, msg) => {
    expect(parseInvoiceDraft(fd(over))).toEqual({ error: msg })
  })
  it("rejects a float-y price", () => {
    expect(parseInvoiceDraft(fd({}, [{ description: "x", qty: "1", unitPrice: "1.005", gst: false }])))
      .toEqual({ error: "Unit price must be a dollar amount with up to 2 decimals" })
  })
  it("rejects no lines", () => expect(parseInvoiceDraft(fd({}, []))).toEqual({ error: "Add at least one line" }))
  it("rejects a non-integer quantity", () => {
    expect(parseInvoiceDraft(fd({}, [{ description: "x", qty: "1.5", unitPrice: "1", gst: false }])))
      .toEqual({ error: "Quantity must be a whole number from 1 to 9999" })
  })
  it("rejects a total too large for the database", () => {
    expect(parseInvoiceDraft(fd({}, [{ description: "x", qty: "9999", unitPrice: "99999.99", gst: false }])))
      .toEqual({ error: "Invoice total is too large" })
  })
  it("rejects an id beyond int4", () => {
    expect(parseInvoiceDraft(fd({ accountId: "2147483648" }))).toEqual({ error: "Invalid reference" })
  })
  it("rejects a zero quantity", () => {
    expect(parseInvoiceDraft(fd({}, [{ description: "x", qty: "00", unitPrice: "1", gst: false }])))
      .toEqual({ error: "Quantity must be a whole number from 1 to 9999" })
  })
  it("rejects malformed lines JSON", () => expect(parseInvoiceDraft(fd({ lines: "{" }))).toEqual({ error: "Invalid line items" }))
})
