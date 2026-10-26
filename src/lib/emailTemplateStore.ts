import { prisma } from "@/lib/prisma"
import {
  DEFAULT_EMAIL_TEMPLATES,
  type EmailTemplateKey,
  type EmailTemplateFields,
  EMAIL_FOOTER_KEY,
  DEFAULT_EMAIL_FOOTER,
  applyVars,
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

/**
 * Raw (unrendered) footer template: the stored value, or the default when no
 * row exists. A stored "" means disabled and is returned as "". Falls back to
 * the default on DB error so a send never breaks on the footer lookup.
 */
export async function getEmailFooterTemplate(): Promise<string> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: EMAIL_FOOTER_KEY } })
    return row ? row.value : DEFAULT_EMAIL_FOOTER
  } catch {
    return DEFAULT_EMAIL_FOOTER
  }
}

/**
 * Auth-free reader for the footer appended to every outgoing email.
 * @returns the rendered footer text (`{churchName}` substituted), or "" when disabled
 */
export async function getEmailFooter(): Promise<string> {
  let template: string
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: EMAIL_FOOTER_KEY } })
    template = row ? row.value : DEFAULT_EMAIL_FOOTER
  } catch {
    return "" // fail closed: a DB blip must not resurrect a footer an admin turned off
  }
  if (!template.trim()) return ""
  return applyVars(template, { churchName: await getChurchName() }).trim()
}
