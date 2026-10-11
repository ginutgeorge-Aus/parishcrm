import { buildInvoiceEmail } from "@/lib/invoiceEmail"

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
