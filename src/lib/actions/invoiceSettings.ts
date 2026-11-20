"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditGuardedTx, auditTxErrorResult } from "@/lib/auditGuard"
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
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("invoices")
  if (off) return off
  if (typeof input.gstRegistered !== "boolean" || typeof input.paymentDetails !== "string") return { error: "Invalid settings" }
  const paymentDetails = input.paymentDetails.trim()
  if (paymentDetails.length > INVOICE_PAYMENT_DETAILS_MAX) {
    return { error: `Payment details must be ${INVOICE_PAYMENT_DETAILS_MAX} characters or fewer` }
  }
  const entries: [string, string][] = [
    [INVOICE_SETTING_KEYS.gstRegistered, String(input.gstRegistered)],
    [INVOICE_SETTING_KEYS.paymentDetails, paymentDetails],
  ]
  const uid = actorId(session)
  try {
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
      await logAuditGuardedTx(tx, uid, "INVOICE_SETTINGS_UPDATED", "AppSetting", undefined, { gstRegistered: input.gstRegistered })
    })
  } catch (e) {
    const mapped = auditTxErrorResult(e, "updateInvoiceSettings", "Couldn't save the settings. Try again.")
    if (mapped) return mapped
    throw e
  }
  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/invoices")
  return { ok: true }
}
