import "server-only"
import { createHmac } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { verifyRosterToken, type RosterAction } from "@/lib/rosterToken"

/** Failed token lookups allowed per client per minute before further failures are limited. */
const FAIL_LIMIT = 30
const FAIL_WINDOW_MS = 60_000

/** What a volunteer may see: their role and the service date, nothing personal. */
export interface RosterPreview {
  ok: true
  action: RosterAction
  role: string
  title: string
  date: Date
  status: "PENDING" | "CONFIRMED" | "DECLINED"
}

/** Client identity from `resolveClientIp`: validated IP (audit) and rate-limit bucket key. */
export type RosterClient = { ip: string | undefined; key: string }

export type RosterFailure = { ok: false; limited?: true }
export type RosterApplyResult = { ok: true; action: RosterAction; changed: boolean } | RosterFailure

/**
 * Signing secret for roster confirm links, derived from AUTH_SECRET with a
 * purpose label so no new env var is needed and the key is never reused as-is.
 * Returns "" when AUTH_SECRET is unset, which makes token verification fail closed.
 */
export function rosterSecret(): string {
  const base = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!base) return ""
  return createHmac("sha256", base).update("roster-confirm:v1").digest("hex")
}

/**
 * Counts a failed lookup against the client; only failures are limited so many
 * valid volunteers behind one church network are never throttled.
 * @param ip rate-limit key for the client
 */
function failure(ip: string): RosterFailure {
  if (!rateLimit(`rosterConfirmFail:${ip}`, FAIL_LIMIT, FAIL_WINDOW_MS)) return { ok: false, limited: true }
  return { ok: false }
}

/**
 * Verifies the token and loads the assignment, returning only the fields the
 * public page may show. Null for anything bad, unknown, archived or finished.
 * @param token the signed link token
 * @param nowMs current time in ms
 */
async function resolve(token: string, nowMs: number) {
  const payload = verifyRosterToken(token, rosterSecret(), nowMs)
  if (!payload || !/^\d{1,9}$/.test(payload.assignmentId)) return null
  const id = Number(payload.assignmentId)
  const row = await prisma.rosterAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      person: { select: { archivedAt: true } },
      slot: { select: { role: { select: { name: true } }, service: { select: { title: true, date: true, endsAt: true } } } },
    },
  })
  if (!row || row.person.archivedAt || row.slot.service.endsAt.getTime() <= nowMs) return null
  return { id, action: payload.action, row }
}

/**
 * Read-only preview for the public confirm/decline page. No state change.
 * @param token the signed link token
 * @param client client IP and rate-limit key
 * @param nowMs current time in ms
 */
export async function previewRosterResponse(token: string, client: RosterClient, nowMs: number = Date.now()): Promise<RosterPreview | RosterFailure> {
  const r = await resolve(token, nowMs)
  if (!r) return failure(client.key)
  return {
    ok: true,
    action: r.action,
    role: r.row.slot.role.name,
    title: r.row.slot.service.title,
    date: r.row.slot.service.date,
    status: r.row.status,
  }
}

/**
 * Applies the token's action (confirm or decline) to its assignment. Idempotent:
 * a repeat tap changes nothing and writes no audit row. The status write and the
 * audit row commit together, with a null (system) actor since the caller is anonymous.
 * @param token the signed link token
 * @param client client IP (audit row) and rate-limit key
 * @param nowMs current time in ms
 */
export async function applyRosterResponse(token: string, client: RosterClient, nowMs: number = Date.now()): Promise<RosterApplyResult> {
  const r = await resolve(token, nowMs)
  if (!r) return failure(client.key)
  const status = r.action === "confirm" ? "CONFIRMED" : "DECLINED"
  const changed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.rosterAssignment.updateMany({
      where: { id: r.id, status: { not: status } },
      data: { status, respondedAt: new Date(nowMs) },
    })
    if (count === 0) return false
    await logAuditTx(tx, null, `ROSTER_ASSIGNMENT_${status}`, "RosterAssignment", r.id, { via: "token" }, client.ip)
    return true
  })
  return { ok: true, action: r.action, changed }
}
