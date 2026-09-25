// Pure receipt-settings types + defaults — NO prisma import, so client
// components (ReceiptSettingsSection) can import defaults/types without
// pulling the pg adapter into the browser bundle. The DB reader
// (getReceiptSettings) lives in ./receiptSettings, which re-exports these.

export type ReceiptSettings = {
  numberPrefix: string
  documentTitle: string
  totalLabel: string
  coveredPeriodTemplate: string
  legalText: string
}

export const RECEIPT_SETTING_KEYS = [
  "receiptNumberPrefix",
  "receiptDocumentTitle",
  "receiptTotalLabel",
  "receiptCoveredPeriod",
  "receiptLegalText",
] as const
export type ReceiptSettingKey = (typeof RECEIPT_SETTING_KEYS)[number]

export const RECEIPT_SETTING_MAX_LENGTHS: Record<ReceiptSettingKey, number> = {
  receiptLegalText: 4000,
  receiptCoveredPeriod: 400,
  receiptDocumentTitle: 120,
  receiptTotalLabel: 120,
  receiptNumberPrefix: 20,
}

// Generic AU-DGR default. Paragraphs separated by a blank line; {churchName}
// is substituted at render. Deliberately NO "School Building Fund" — each instance
// edits fund-specific wording in Settings.
const DEFAULT_LEGAL_TEXT = [
  "{churchName} is endorsed as a Deductible Gift Recipient (DGR) under Item 1 of the table in section 30-15 of the Income Tax Assessment Act 1997.",
  "This receipt acknowledges a voluntary tax-deductible gift. No goods or services were provided in return for this donation.",
  "This receipt may be used for claiming tax deductions in Australia.",
].join("\n\n")

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  numberPrefix: "DGR",
  documentTitle: "ANNUAL TAX-DEDUCTIBLE RECEIPT",
  totalLabel: "TOTAL TAX-DEDUCTIBLE DONATIONS",
  coveredPeriodTemplate:
    "This receipt covers tax-deductible gifts received between {from} and {to}.",
  legalText: DEFAULT_LEGAL_TEXT,
}

// Maps AppSetting key → ReceiptSettings field.
export const KEY_TO_FIELD: Record<ReceiptSettingKey, keyof ReceiptSettings> = {
  receiptNumberPrefix: "numberPrefix",
  receiptDocumentTitle: "documentTitle",
  receiptTotalLabel: "totalLabel",
  receiptCoveredPeriod: "coveredPeriodTemplate",
  receiptLegalText: "legalText",
}
