import "server-only"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/crypto"

/** Why a member will not get the group's email. */
export type SkipReason = "NO_EMAIL" | "NO_CONSENT" | "BAD_EMAIL"

/** A member who will receive the email. Names only: addresses are decrypted at send time. */
export type RecipientRow = { personId: number; name: string }

/** A member who will not, with the reason shown on the compose page. */
export type SkippedRow = RecipientRow & { reason: SkipReason }

/** Human wording for each {@link SkipReason}. */
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  NO_EMAIL: "No email address",
  NO_CONSENT: "Opted out of email",
  BAD_EMAIL: "Email address unreadable",
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * True when the stored value decrypts to something address-shaped.
 * @param stored the encrypted `Person.email` value
 */
function isUsableEmail(stored: string): boolean {
  try {
    return EMAIL_SHAPE.test(decrypt(stored).trim())
  } catch {
    return false
  }
}

/**
 * Split a group's live members into email recipients and skipped members.
 * A recipient is an active (not archived) member with an email that decrypts to
 * an address-shaped value and `emailConsent = true`. Consent is checked first, so
 * an opted-out member is reported as opted out even when they have no address.
 * Never returns or logs an address: the sender decrypts again at delivery time
 * (`Person.email` is encrypted with a random IV, so it cannot be queried).
 * Uncapped on purpose: the display cap `MAX_GROUP_MEMBERS` must never silently drop a recipient.
 * @param groupId group id (caller has already checked access)
 * @returns recipients and skipped members, each sorted by surname then given name
 */
export async function selectRecipients(groupId: number): Promise<{ recipients: RecipientRow[]; skipped: SkippedRow[] }> {
  const rows = await prisma.groupMember.findMany({
    where: { groupId, person: { archivedAt: null } },
    select: { person: { select: { id: true, firstName: true, lastName: true, email: true, emailConsent: true } } },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { personId: "asc" }],
  })
  const recipients: RecipientRow[] = []
  const skipped: SkippedRow[] = []
  for (const { person: p } of rows) {
    const row = { personId: p.id, name: `${p.firstName} ${p.lastName}` }
    if (!p.emailConsent) skipped.push({ ...row, reason: "NO_CONSENT" })
    else if (!p.email) skipped.push({ ...row, reason: "NO_EMAIL" })
    else if (!isUsableEmail(p.email)) skipped.push({ ...row, reason: "BAD_EMAIL" })
    else recipients.push(row)
  }
  return { recipients, skipped }
}
