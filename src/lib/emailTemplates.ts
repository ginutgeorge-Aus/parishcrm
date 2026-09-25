export const EMAIL_TEMPLATE_KEYS = ["welcome", "familyUpdate", "receipt", "dgrReceipt"] as const
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number]
export type EmailTemplateFields = { subject: string; intro: string; body: string; signoff: string }

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  welcome: "Welcome / set password",
  familyUpdate: "Family update invite",
  receipt: "Donation receipt",
  dgrReceipt: "Annual DGR receipt",
}

// Valid {vars} an admin may use, shown as insert-chips in the editor.
export const EMAIL_TEMPLATE_VARS: Record<EmailTemplateKey, string[]> = {
  welcome: ["{name}", "{role}", "{churchName}"],
  familyUpdate: ["{familyName}", "{churchName}"],
  receipt: ["{churchName}", "{transactionId}", "{date}"],
  dgrReceipt: ["{donorName}", "{receiptNo}", "{fyLabel}", "{churchName}"],
}

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateFields> = {
  welcome: {
    subject: "Welcome to {churchName} — set your password",
    intro: "Hello {name},",
    body:
      "An account has been created for you ({role}). To get started, set your password using the secure link below. This link expires in 7 days.",
    signoff:
      "Log in securely, manage member families and people, report a bug or request a feature with the in-app Feedback button, and view events and (depending on your role) accounting.",
  },
  familyUpdate: {
    subject: "Update your family details — {churchName}",
    intro: "Hello {familyName},",
    body:
      "Our church records team has asked you to review and update your family's details. Click the button below to open your secure form. This link expires in 14 days.",
    signoff: "If you weren't expecting this, you can ignore this email.",
  },
  receipt: {
    subject: "Donation Receipt #{transactionId} — {date}",
    intro: "",
    body: "",
    signoff: "This is an official receipt. Please retain for your records.",
  },
  dgrReceipt: {
    subject: "Annual Donation Receipt {receiptNo} — FY {fyLabel}",
    intro: "Dear {donorName},",
    body: "Please find attached your annual tax-deductible donation receipt ({receiptNo}) for the {fyLabel} financial year.",
    signoff: "Please retain this receipt for your tax records. Thank you for your generous support of {churchName}.",
  },
}

// Pure token substitution. Replaces {key} with vars[key]; unknown tokens are
// left verbatim (visible to the reader) and the call never throws.
export function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  )
}
