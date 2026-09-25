"use server"

import * as React from "react"
import { render } from "@react-email/render"
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  applyVars,
  type EmailTemplateKey,
  type EmailTemplateFields,
} from "@/lib/emailTemplates"
import { WelcomeEmail } from "@/lib/emails/WelcomeEmail"
import { FamilyUpdateInviteEmail } from "@/lib/emails/FamilyUpdateInviteEmail"
import { ReceiptEmail, type ReceiptData } from "@/lib/emails/ReceiptEmail"
import { DgrReceiptEmail } from "@/lib/emails/DgrReceiptEmail"
import { sendEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { getReceiptSettings } from "@/lib/receiptSettings"
import type { ActionResultWithSuccess } from "./types"

const SAMPLE_APP_URL = process.env.AUTH_URL ?? "https://app.example.com"

const KEY_SET = new Set<string>(EMAIL_TEMPLATE_KEYS)

const FieldsSchema = z.object({
  key: z.string().refine((k) => KEY_SET.has(k), "Invalid template"),
  subject: z.string().min(1, "Subject required").max(200),
  intro: z.string().max(5000),
  body: z.string().max(5000),
  signoff: z.string().max(5000),
})

function sampleVars(key: EmailTemplateKey, churchName: string): Record<string, string> {
  if (key === "welcome") return { name: "Jane Member", role: "OFFICE_ADMIN", churchName }
  if (key === "familyUpdate") return { familyName: "The Smith Family", churchName }
  if (key === "dgrReceipt")
    return { donorName: "Jane Member", receiptNo: "DGR-2025-001", fyLabel: "2024–25", churchName }
  return { churchName, transactionId: "1234", date: "01/07/2025" }
}

// Render a template with sample data for preview / test-send. Reads the
// configured church info (name/ABN/address/email) so an admin previews their
// own details, not brand-specific filler; unset fields fall back to obvious
// samples so the preview still looks complete.
async function renderTemplate(key: EmailTemplateKey, f: EmailTemplateFields): Promise<string> {
  const church = await getChurchSettings()
  const churchName = church.name
  const v = sampleVars(key, churchName)
  if (key === "welcome") {
    return render(
      React.createElement(WelcomeEmail, {
        setPasswordUrl: `${SAMPLE_APP_URL}/reset-password?token=SAMPLE`,
        helpUrl: `${SAMPLE_APP_URL}/help`,
        churchName,
        intro: applyVars(f.intro, v),
        body: applyVars(f.body, v),
        signoff: applyVars(f.signoff, v),
      }),
    )
  }
  if (key === "familyUpdate") {
    return render(
      React.createElement(FamilyUpdateInviteEmail, {
        updateUrl: `${SAMPLE_APP_URL}/family-update/SAMPLE`,
        churchName,
        intro: applyVars(f.intro, v),
        body: applyVars(f.body, v),
        signoff: applyVars(f.signoff, v),
      }),
    )
  }
  if (key === "dgrReceipt") {
    const receipt = await getReceiptSettings()
    return render(
      React.createElement(DgrReceiptEmail, {
        churchName,
        churchAbn: church.abn || "12 345 678 901",
        churchAddress: church.address || "123 Example St, Anytown",
        churchEmail: church.email || "church@example.com",
        receiptNo: "DGR-2025-001",
        fyLabel: "2024–25",
        issueDate: "01-07-2025",
        documentTitle: receipt.documentTitle,
        totalLabel: "$1,250.00",
        totalDonationsLabel: receipt.totalLabel,
        coveredPeriod: "This receipt covers tax-deductible gifts received between 1 July 2024 and 30 June 2025.",
        intro: applyVars(f.intro, v),
        body: applyVars(f.body, v),
        signoff: applyVars(f.signoff, v),
      }),
    )
  }
  const data: ReceiptData = {
    transactionId: 1234,
    date: "01/07/2025",
    description: "Sunday offering",
    amount: "$100.00",
    type: "INCOME",
    account: "General Offerings",
    churchName,
    churchAddress: "123 Example St, Anytown",
    churchAbn: "12 345 678 901",
    churchEmail: "church@example.com",
  }
  return render(
    React.createElement(ReceiptEmail, {
      data,
      intro: applyVars(f.intro, v),
      signoff: applyVars(f.signoff, v),
    }),
  )
}

export async function updateEmailTemplate(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = FieldsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { key, subject, intro, body, signoff } = parsed.data
  const updatedBy = actorId(session)
  await prisma.emailTemplate.upsert({
    where: { key },
    create: { key, subject, intro, body, signoff, updatedBy },
    update: { subject, intro, body, signoff, updatedBy },
  })
  // Log the key only — template values can be long; never log raw values.
  await logAudit(updatedBy, "SETTING_UPDATED", "EmailTemplate", undefined, { template: key })
  revalidatePath("/settings")
  return { success: "Template saved" }
}

export async function resetEmailTemplate(key: EmailTemplateKey): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!KEY_SET.has(key)) return { error: "Invalid template" }
  const def = DEFAULT_EMAIL_TEMPLATES[key]
  const updatedBy = actorId(session)
  await prisma.emailTemplate.upsert({
    where: { key },
    create: { key, ...def, updatedBy },
    update: { ...def, updatedBy },
  })
  await logAudit(updatedBy, "SETTING_UPDATED", "EmailTemplate", undefined, { template: key, reset: true })
  revalidatePath("/settings")
  return { success: "Template reset to default" }
}

export async function previewEmailTemplate(
  key: EmailTemplateKey,
  draft: EmailTemplateFields,
): Promise<{ html: string } | { error: string }> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = FieldsSchema.safeParse({ key, ...draft })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  return { html: await renderTemplate(key, draft) }
}

export async function sendTestEmail(key: EmailTemplateKey, draft: EmailTemplateFields): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = FieldsSchema.safeParse({ key, ...draft })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const to = session!.user!.email
  if (!to) return { error: "Your account has no email address" }
  const html = await renderTemplate(key, draft)
  const { name: churchName } = await getChurchSettings()
  const v = sampleVars(key, churchName)
  try {
    await sendEmail(to, `[TEST] ${applyVars(draft.subject, v)}`, html, html.replace(/<[^>]+>/g, " "))
  } catch {
    return { error: "Failed to send test email — check email configuration" }
  }
  await logAudit(actorId(session), "EMAIL_TEMPLATE_TEST_SENT", "EmailTemplate", undefined, { template: key })
  return { success: `Test email sent to ${to}` }
}
