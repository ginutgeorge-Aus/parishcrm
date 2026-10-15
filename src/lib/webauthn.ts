import "server-only"
import { isIP } from "node:net"
import { prisma } from "@/lib/prisma"

export type RelyingParty = { rpID: string; origin: string }
export type ChallengePurpose = "register" | "login"

const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000
export const MAX_PASSKEYS_PER_USER = 10

// The RP ID is the domain a passkey is bound to. Derive it from AUTH_URL so it is
// the one stable public origin of this deployment — a self-hoster who moves
// domain loses their registered passkeys (documented in docs/self-hosting.md).
// Browsers only allow WebAuthn on https or http://localhost, and an RP ID must be
// a domain — never an IP (so http://127.0.0.1 is out too). Anything else
// disables passkeys rather than offering a button that can never work.
export function getRelyingParty(): RelyingParty | null {
  const raw = process.env.AUTH_URL
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return null
  if (url.protocol !== "https:" && !(url.protocol === "http:" && host === "localhost")) return null
  return { rpID: url.hostname, origin: url.origin }
}

export async function createChallenge(challenge: string, purpose: ChallengePurpose, userId: number | null): Promise<string> {
  // Opportunistic sweep keeps the table tiny without a cron; indexed on expiresAt.
  await prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  const row = await prisma.webAuthnChallenge.create({
    data: { challenge, purpose, userId, expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS) },
    select: { id: true },
  })
  return row.id
}

// Single-use: the delete is the boundary — of two concurrent requests presenting
// the same id, only one gets the row back. Validate AFTER deleting so a
// wrong-purpose/expired probe still burns the challenge.
export async function consumeChallenge(id: unknown, purpose: ChallengePurpose, userId: number | null): Promise<string | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null
  let row: { challenge: string; purpose: string; userId: number | null; expiresAt: Date }
  try {
    row = await prisma.webAuthnChallenge.delete({
      where: { id },
      select: { challenge: true, purpose: true, userId: true, expiresAt: true },
    })
  } catch (e) {
    if ((e as { code?: unknown })?.code === "P2025") return null
    throw e
  }
  if (row.purpose !== purpose || row.userId !== userId || row.expiresAt <= new Date()) return null
  return row.challenge
}

/**
 * Normalises the passkey name by trimming whitespace and validating its length.
 * @param name - The input name to normalise.
 * @returns The trimmed name if it has length between 1 and 50; otherwise null.
 */
export function normalisePasskeyName(name: unknown): string | null {
  if (typeof name !== "string") return null
  const n = name.trim()
  return n.length >= 1 && n.length <= 50 ? n : null
}
