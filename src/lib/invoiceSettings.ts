import { prisma } from "@/lib/prisma"
import { DEFAULT_INVOICE_SETTINGS, INVOICE_SETTING_KEYS, type InvoiceSettings } from "@/lib/invoiceSettingsShared"

export * from "@/lib/invoiceSettingsShared"

/** Read invoice settings from AppSetting, falling back to defaults per field. No auth check (callers gate). */
export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: Object.values(INVOICE_SETTING_KEYS) } },
  })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    gstRegistered: map.get(INVOICE_SETTING_KEYS.gstRegistered) === "true",
    paymentDetails: map.get(INVOICE_SETTING_KEYS.paymentDetails) ?? DEFAULT_INVOICE_SETTINGS.paymentDetails,
  }
}
