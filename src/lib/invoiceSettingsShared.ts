// Client-safe invoice settings types/defaults (no prisma import).
export type InvoiceSettings = { gstRegistered: boolean; paymentDetails: string }
export const INVOICE_SETTING_KEYS = { gstRegistered: "invoiceGstRegistered", paymentDetails: "invoicePaymentDetails" } as const
export const INVOICE_PAYMENT_DETAILS_MAX = 1000
export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = { gstRegistered: false, paymentDetails: "" }
