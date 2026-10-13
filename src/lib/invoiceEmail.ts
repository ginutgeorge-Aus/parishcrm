// Plain invoice email body. v1 uses fixed copy (no admin-editable template).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/** Subject, HTML and text for the email that carries an invoice PDF. */
export function buildInvoiceEmail(meta: {
  churchName: string; recipientName: string; invoiceNo: string; total: string; dueDate: string; paymentDetails: string
}): { subject: string; html: string; text: string } {
  const subject = `Invoice ${meta.invoiceNo} from ${meta.churchName}`
  const lines = [
    `Dear ${meta.recipientName},`, "",
    `Please find attached invoice ${meta.invoiceNo} for ${meta.total}, due ${meta.dueDate}.`,
    ...(meta.paymentDetails ? ["", "How to pay:", meta.paymentDetails] : []),
    "", "Thank you,", meta.churchName,
  ]
  const text = lines.join("\n")
  const html = lines.map((l) => (l === "" ? "<br>" : `<p style="margin:0">${esc(l).replace(/\n/g, "<br>")}</p>`)).join("\n")
  return { subject, html, text }
}
