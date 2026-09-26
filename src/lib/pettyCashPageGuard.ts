import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { canAccessAccounting } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"

// Shared entry guard for petty-cash session sub-pages: accounting role, then a
// valid session id param. Redirects / 404s; returns the parsed session id.
export async function requirePettyCashSessionId(rawId: string): Promise<number> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/petty-cash")
  return parseRouteId(rawId) ?? notFound()
}
