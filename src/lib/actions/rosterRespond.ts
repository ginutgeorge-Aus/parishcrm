"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { resolveClientIp } from "@/lib/clientIp"
import { applyRosterResponse } from "@/lib/rosterConfirm"
import { ROSTER_RESPOND_TOKEN_RE } from "@/lib/rosterRespondPath"

/**
 * Public (unauthenticated) confirm/decline submit for the roster link page. The
 * signed, expiring token is the only credential and carries the action. Always
 * redirects back to the token page, which shows the outcome (or the same
 * "link not valid" message for any failure); a state change needs this POST, so
 * mail scanners that merely fetch the link never confirm or decline anyone.
 * @param token the signed token from the page path
 */
export async function respondToRoster(token: string): Promise<void> {
  if (!ROSTER_RESPOND_TOKEN_RE.test(token)) redirect("/")
  await applyRosterResponse(token, resolveClientIp(await headers()))
  redirect(`/roster/respond/${token}`)
}
