"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canEdit } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/cryptoCore"
import { logAudit } from "@/lib/audit"
import { getChurchSettings } from "@/lib/churchSettings"
import { getLetterSettings } from "@/lib/letterSettings"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { buildWelcomeLetterModel, fullName, type WelcomeLetterModel } from "@/lib/welcomeLetter"
import { renderWelcomeLetterPdf } from "@/lib/pdf/WelcomeLetterPdf"
import { sendWelcomeLetterEmail } from "@/lib/email"
import type { ActionResultWithSuccess } from "./types"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

export type WelcomeLetterRecipient = { personId: number; name: string; email: string }
export type DraftResult =
  | { error: string }
  | { model: WelcomeLetterModel; recipients: WelcomeLetterRecipient[]; familyName: string }

// Sydney-local "6 August 2026".
function todaySydney(): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "numeric", month: "long", year: "numeric", timeZone: APP_TIMEZONE,
  }).format(new Date())
}

export async function buildWelcomeLetterDraft(familyId: number): Promise<DraftResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!Number.isInteger(familyId) || familyId <= 0 || familyId > 2147483647) return { error: "Invalid family" }

  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: {
      name: true, memberNo: true, address: true, suburb: true, state: true, postcode: true, archivedAt: true,
      people: {
        where: { archivedAt: null },
        orderBy: [{ role: "asc" }, { firstName: "asc" }],
        select: {
          id: true, title: true, firstName: true, middleName: true, lastName: true,
          suffix: true, motherParish: true, email: true,
        },
      },
    },
  })
  if (!family || family.archivedAt) return { error: "Family not found" }

  const members = family.people.map((p) => ({
    title: p.title, firstName: p.firstName, middleName: p.middleName,
    lastName: p.lastName, suffix: p.suffix, motherParish: p.motherParish,
  }))

  const [church, settings, { parishFields }] = await Promise.all([getChurchSettings(), getLetterSettings(), getMembershipSettings()])

  const model = buildWelcomeLetterModel({
    family: {
      memberNo: family.memberNo,
      address: family.address ? safeDecrypt(family.address) : null,
      suburb: family.suburb ? safeDecrypt(family.suburb) : null,
      state: family.state ? safeDecrypt(family.state) : null,
      postcode: family.postcode ? safeDecrypt(family.postcode) : null,
    },
    members,
    settings,
    church,
    today: todaySydney(),
    parishFields,
  })

  const recipients: WelcomeLetterRecipient[] = family.people
    .map((p) => ({ personId: p.id, name: fullName(p), email: p.email ? safeDecrypt(p.email) : "" }))
    .filter((r) => r.email.trim().length > 0)

  return { model, recipients, familyName: family.name }
}

export type SendWelcomeLetterInput = {
  familyId: number
  model: WelcomeLetterModel
  recipientPersonIds: number[]
}

export async function sendWelcomeLetter(input: SendWelcomeLetterInput): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const { familyId, model, recipientPersonIds } = input
  if (!Array.isArray(recipientPersonIds) || recipientPersonIds.length === 0) {
    return { error: "Select at least one recipient" }
  }

  // Re-resolve emails server-side from the DB — never trust client-supplied addresses.
  const people = await prisma.person.findMany({
    where: { id: { in: recipientPersonIds.slice(0, 20) }, familyId, archivedAt: null },
    select: { id: true, email: true },
  })
  const emails = people
    .map((p) => (p.email ? safeDecrypt(p.email) : ""))
    .filter((e) => e.trim().length > 0)
  if (emails.length === 0) return { error: "No selected member has an email address" }

  const pdf = await renderWelcomeLetterPdf(model)
  await sendWelcomeLetterEmail(emails.join(", "), model, pdf)

  const userId = actorId(session)
  await logAudit(userId, "WELCOME_LETTER_SENT", "Family", familyId, { recipientCount: emails.length })

  return { success: `Welcome letter sent to ${emails.length} recipient${emails.length === 1 ? "" : "s"}` }
}
