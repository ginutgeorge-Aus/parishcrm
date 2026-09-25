import { prisma } from "@/lib/prisma"
import {
  DEFAULT_EMAIL_TEMPLATES,
  type EmailTemplateKey,
  type EmailTemplateFields,
} from "@/lib/emailTemplates"
import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"

// Auth-free, next/cache-free church-name reader for the mail layer (email.ts,
// payment-reminder action). Mirrors getEmailTemplate: getChurchSettings() uses
// unstable_cache (→ next/cache), which can't be imported into the widely-used
// mail module without cascading next/cache into every node/jsdom test that
// touches email.ts. A plain prisma read with a try/catch fallback keeps outbound
// mail using the Settings-UI churchName, then CHURCH_NAME env, then the neutral
// default — and never breaks a send on a fresh/errored DB.
export async function getChurchName(): Promise<string> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: "churchName" } })
    return row?.value || process.env.CHURCH_NAME || DEFAULT_CHURCH_NAME
  } catch {
    return process.env.CHURCH_NAME || DEFAULT_CHURCH_NAME
  }
}

// Read a template with a per-field code fallback. Always returns a fully
// populated template, even on a fresh DB or DB error — so sends never break.
// Plain server reader (no "use server"/auth import) so `email.ts` can use it
// without pulling next-auth into node-env email tests.
export async function getEmailTemplate(key: EmailTemplateKey): Promise<EmailTemplateFields> {
  const def = DEFAULT_EMAIL_TEMPLATES[key]
  try {
    const row = await prisma.emailTemplate.findUnique({ where: { key } })
    if (!row) return def
    return {
      subject: row.subject || def.subject,
      intro: row.intro || def.intro,
      body: row.body || def.body,
      signoff: row.signoff || def.signoff,
    }
  } catch {
    return def
  }
}
