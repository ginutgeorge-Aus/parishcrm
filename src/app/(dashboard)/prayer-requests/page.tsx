import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { PrayerRequestForm } from "@/components/pastoral/PrayerRequestForm"
import { PrayerRequestList } from "@/components/pastoral/PrayerRequestList"
import { listPrayerRequests } from "@/lib/actions/prayerRequest"
import { PrayerRequestStatus } from "@/lib/generated/prisma/enums"
import { canManagePrayerRequests } from "@/lib/roleGuard"
import { cn } from "@/lib/utils"

const CHOICES = [
  { value: "active", label: "Active", statuses: [PrayerRequestStatus.ACTIVE] },
  { value: "answered", label: "Answered", statuses: [PrayerRequestStatus.ANSWERED] },
  { value: "archived", label: "Archived", statuses: [PrayerRequestStatus.ARCHIVED] },
] as const

/**
 * Prayer requests, private to ADMIN | PASTOR (PO decision #611). Any other
 * role is sent home before anything is read. Status filter is a search param.
 */
export default async function PrayerRequestsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canManagePrayerRequests(session.user.role)) redirect("/")

  const sp = await searchParams
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status
  const choice = CHOICES.find((c) => c.value === raw) ?? CHOICES[0]
  const res = await listPrayerRequests([...choice.statuses])
  if ("error" in res) redirect("/")

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-foreground">Prayer requests</h2>
      <p className="text-sm text-muted-foreground">
        Private to pastors and admins. Members can also submit one at{" "}
        <Link href="/prayer-request" className="underline">/prayer-request</Link>.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
        {CHOICES.map((c) => (
          <Link
            key={c.value}
            href={c.value === "active" ? "/prayer-requests" : `/prayer-requests?status=${c.value}`}
            aria-current={choice.value === c.value ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3 text-sm sm:min-h-0 sm:py-1",
              choice.value === c.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {c.label}
          </Link>
        ))}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <PrayerRequestList requests={res.requests} />
      </div>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="text-lg font-medium">Add a prayer request</h3>
        <PrayerRequestForm />
      </section>
    </div>
  )
}
