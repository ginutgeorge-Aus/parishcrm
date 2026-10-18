"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { assertNotDemo } from "@/lib/demoMode"
import { INVOICE_SETTING_KEYS, INVOICE_PAYMENT_DETAILS_MAX } from "@/lib/invoiceSettingsShared"
import { featureGuard } from "@/lib/featureFlags"

/** Save GST-registered flag and invoice payment details (ADMIN only). */
export async function updateInvoiceSettings(input: {
  gstRegistered: boolean
  paymentDetails: string
}): Promise<{ ok: true } | { error: string }> {
  const off = await featureGuard("invoices")
  if (off) return off
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (typeof input.gstRegistered !== "boolean" || typeof input.paymentDetails !== "string") return { error: "Invalid settings" }
  const paymentDetails = input.paymentDetails.trim()
  if (paymentDetails.length > INVOICE_PAYMENT_DETAILS_MAX) {
    return { error: `Payment details must be ${INVOICE_PAYMENT_DETAILS_MAX} characters or fewer` }
  }
  const entries: [string, string][] = [
    [INVOICE_SETTING_KEYS.gstRegistered, String(input.gstRegistered)],
    [INVOICE_SETTING_KEYS.paymentDetails, paymentDetails],
  ]
  await prisma.$transaction(
    entries.map(([key, value]) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })),
  )
  await logAudit(actorId(session), "INVOICE_SETTINGS_UPDATED", "AppSetting", undefined, { gstRegistered: input.gstRegistered })
  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/invoices")
  return { ok: true }
}
