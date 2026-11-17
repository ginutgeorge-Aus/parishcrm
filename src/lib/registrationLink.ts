import type { Prisma } from "@/lib/generated/prisma/client"

/** How long a registration receipt / pay-now link stays valid after registration (or after the last staff reminder). */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Registration public tokens are minted as "REG-" + 12 hex chars; the upper bound leaves room for a longer token. */
export const REGISTRATION_TOKEN_RE = /^REG-[0-9A-F]{12,64}$/

/**
 * Earliest createdAt / reminder sentAt a token lookup will still match.
 * @returns the cut-off date, 30 days ago
 */
function tokenExpiryFloor(): Date {
  return new Date(Date.now() - TOKEN_TTL_MS)
}

/**
 * Prisma `where` for a public, event-scoped registration link lookup. The link expires 30 days after
 * registration unless a successful staff payment reminder was sent inside the same window, which
 * re-authorises it for a fresh 30 days. Shared by the success page and the pay-now action so an
 * expired link cannot start a checkout.
 * @param publicToken the registration's opaque token (already shape-checked by the caller)
 * @param eventId the event the registration must belong to
 * @returns the registration filter
 */
export function registrationLinkWhere(publicToken: string, eventId: number): Prisma.RegistrationWhereInput {
  const linkFloor = tokenExpiryFloor()
  return {
    publicToken,
    eventId,
    OR: [
      { createdAt: { gte: linkFloor } },
      { paymentReminders: { some: { status: "SUCCESS", sentAt: { gte: linkFloor } } } },
    ],
  }
}
