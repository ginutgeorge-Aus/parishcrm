import { headers } from "next/headers"
import type { Metadata } from "next"
import { resolveClientIp } from "@/lib/clientIp"
import { previewRosterResponse } from "@/lib/rosterConfirm"
import { respondToRoster } from "@/lib/actions/rosterRespond"
import { ROSTER_RESPOND_TOKEN_RE } from "@/lib/rosterRespondPath"

// Always current; never cached or indexed. The token is the only credential.
export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Roster response",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

type Props = { params: Promise<{ token: string }> }

/**
 * Public one-tap roster page. Shows only the role and service date, then a button
 * that confirms or declines (the link's own action). Any bad, expired or unknown
 * link gets one generic message; repeated failures are rate limited per client.
 * @param props route params (token)
 */
export default async function RosterRespondPage({ params }: Readonly<Props>) {
  const { token } = await params
  const client = resolveClientIp(await headers())
  const preview = ROSTER_RESPOND_TOKEN_RE.test(token) ? await previewRosterResponse(token, client) : { ok: false as const }
  if (!preview.ok) {
    const limited = "limited" in preview && preview.limited
    return (
      <div className="mx-auto max-w-md p-6 text-center text-sm">
        {limited ? "Too many requests. Please try again in a minute." : "This link is not valid or has expired. Please contact the church office."}
      </div>
    )
  }
  const verb = preview.action === "confirm" ? "confirm" : "decline"
  const done = preview.status === (preview.action === "confirm" ? "CONFIRMED" : "DECLINED")
  // A declined place is final for links (staff may have refilled it): a confirm link cannot reverse it.
  const locked = preview.action === "confirm" && preview.status === "DECLINED"
  const when = preview.date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  return (
    <div className="mx-auto max-w-md space-y-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{preview.title}</h1>
      <p>
        {preview.role} · {when}
      </p>
      {locked ? (
        <p role="status">You have already told us you cannot serve. Please contact the church office to change this.</p>
      ) : done ? (
        <p role="status">{verb === "confirm" ? "Thank you, you are confirmed." : "Thank you, we have recorded that you cannot serve."}</p>
      ) : (
        <form action={respondToRoster.bind(null, token)}>
          <button type="submit" className="rounded bg-primary px-4 py-2 text-primary-foreground">
            {verb === "confirm" ? "Confirm I will serve" : "I cannot serve"}
          </button>
        </form>
      )}
    </div>
  )
}
