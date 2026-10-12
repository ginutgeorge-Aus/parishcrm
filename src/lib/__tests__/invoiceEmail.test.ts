import { buildInvoiceEmail, buildInvoicePaidEmail } from "@/lib/invoiceEmail"

describe("buildInvoiceEmail", () => {
  const meta = { churchName: "Example Church", recipientName: "Example <Scouts>", invoiceNo: "INV-0001", total: "$330.00", dueDate: "25 October 2026", paymentDetails: "BSB 000-000" }
  it("builds subject and text", () => {
    const e = buildInvoiceEmail(meta)
    expect(e.subject).toBe("Invoice INV-0001 from Example Church")
    expect(e.text).toContain("$330.00"); expect(e.text).toContain("25 October 2026"); expect(e.text).toContain("BSB 000-000")
  })
  it("escapes HTML", () => {
    expect(buildInvoiceEmail(meta).html).toContain("Example &lt;Scouts&gt;")
    expect(buildInvoiceEmail(meta).html).not.toContain("<Scouts>")
  })
})

describe("buildInvoicePaidEmail", () => {
  it("is a payment-received note, not a donation receipt, and escapes HTML", () => {
    const m = buildInvoicePaidEmail({ churchName: "Example <Church>", recipientName: "Scouts & Co", invoiceNo: "INV-0007", total: "$330.00", paidDate: "20 October 2026" })
    expect(m.subject).toBe("Payment received — invoice INV-0007")
    expect(m.subject).not.toMatch(/donation/i)
    expect(m.text).toContain("We received your payment of $330.00 on 20 October 2026 for invoice INV-0007.")
    expect(m.html).toContain("Scouts &amp; Co")
    expect(m.html).toContain("Example &lt;Church&gt;")
  })
})
