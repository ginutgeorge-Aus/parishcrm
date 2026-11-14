import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { parseRouteId } from "@/lib/validation"
import { formatSydneyDateTime } from "@/lib/dates"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { lockedYears } from "@/lib/sundaySchoolYearLock"
import { ymdToDbDate } from "@/lib/sundaySchoolRollView"
import { CHILD_SKIP_LABELS, loadStudentParents } from "@/lib/sundaySchoolParents"
import { loadSsMessageHistory, type SsHistoryMessage } from "@/lib/sundaySchoolMessageHistory"
import { STATUS_LABELS } from "@/lib/groupMessageHistory"
import { sendSsParentMessage } from "@/lib/actions/sundaySchoolMessage"
import { ParentMessageForm } from "@/components/sunday-school/ParentMessageForm"

/** Route specifics that differ between the staff dashboard and the volunteer portal. */
const SCOPES = {
  dashboard: { base: "/sunday-school", backLabel: "Class", deniedRedirectsHome: true },
  organiser: { base: "/my-classes", backLabel: "My classes", deniedRedirectsHome: false },
} as const

/**
 * True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30, arrays, junk).
 * @param v raw query value
 */
function isRealYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = ymdToDbDate(v)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * Sent parent emails for a class, newest first, with a per-status tally. Names
 * and counts only, never an address. The caller loads them (loadSsMessageHistory)
 * after checking access; kept synchronous so it renders inside any page.
 * @param messages the class's recent messages
 */
export function ParentMessageHistory({ messages }: Readonly<{ messages: SsHistoryMessage[] }>) {
  if (messages.length === 0) return <p className="text-sm text-muted-foreground">No parent emails sent yet.</p>
  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <details key={m.id} className="rounded-lg border bg-card p-3">
          <summary className="cursor-pointer space-y-1">
            <span className="font-medium text-foreground">{m.subject}</span>
            <span className="block text-xs text-muted-foreground">
              {formatSydneyDateTime(m.createdAt)} · {m.sentBy} ·{" "}
              {Object.entries(m.counts).map(([k, n]) => `${n} ${(STATUS_LABELS[k] ?? k).toLowerCase()}`).join(", ") || "no recipients"}
            </span>
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm">{m.body}</p>
        </details>
      ))}
    </div>
  )
}

/**
 * Shared body of the staff (`/sunday-school/[id]/message`) and volunteer
 * (`/my-classes/[id]/message`) parent-email pages. Page guard: canMarkRoll (the
 * send action re-checks it). Staff without access go home; volunteers get a 404
 * so class ids can't be probed. A missing, archived or locked-year class shows
 * no compose form. `?absent=YYYY-MM-DD` pre-selects the children marked ABSENT
 * on that date's roll; otherwise the whole class is selected.
 * @param params route params promise holding the class id
 * @param searchParams `absent` (roll date) and `sent` (success notice)
 * @param scope "dashboard" or "organiser"
 */
export async function renderParentMessagePage(
  params: Promise<{ id: string }>,
  searchParams: Promise<{ absent?: string | string[]; sent?: string | string[] }>,
  scope: keyof typeof SCOPES,
) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const id = parseRouteId((await params).id)
  if (id === null) notFound()
  const { base, backLabel, deniedRedirectsHome } = SCOPES[scope]
  if (!(await canMarkRoll(actorId(session), id, session.user.role))) {
    if (deniedRedirectsHome) redirect("/")
    notFound()
  }
  const cls = await prisma.sundaySchoolClass.findFirst({ where: { id, archivedAt: null }, select: { id: true, name: true, year: true } })
  if (!cls) notFound()
  const locked = (await lockedYears([cls.year])).has(cls.year)

  const sp = await searchParams
  const absent = isRealYmd(sp.absent) ? sp.absent : null
  const students = locked ? [] : await loadStudentParents(id)
  let preselected = students.map((s) => s.personId)
  if (absent) {
    const marks = await prisma.sundaySchoolAttendance.findMany({
      where: { status: "ABSENT", session: { classId: id, date: ymdToDbDate(absent) } },
      select: { personId: true },
    })
    preselected = marks.map((m) => m.personId)
  }
  const backHref = scope === "dashboard" ? `${base}/${id}` : base

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href={backHref} className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">← {backLabel}</Link>
        <h1 className="text-2xl font-bold text-foreground">Email parents · {cls.name}</h1>
        {absent && <p className="text-sm text-muted-foreground">Children marked absent on {absent} are selected.</p>}
      </div>
      {typeof sp.sent === "string" && <p role="status" className="rounded-lg border bg-card p-3 text-sm">Email queued. Delivery status shows below.</p>}
      {locked ? (
        <p className="text-sm text-muted-foreground">This school year is locked, so parents can no longer be emailed from this class.</p>
      ) : (
        <ParentMessageForm
          action={sendSsParentMessage.bind(null, id)}
          students={students.map((s) => ({ personId: s.personId, name: s.name, parentIds: s.parentIds, skipLabel: s.reason ? CHILD_SKIP_LABELS[s.reason] : null }))}
          preselected={preselected}
        />
      )}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Sent emails</h2>
        <ParentMessageHistory messages={await loadSsMessageHistory(id)} />
      </section>
    </div>
  )
}
