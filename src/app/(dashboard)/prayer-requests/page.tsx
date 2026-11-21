import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { FilterChip } from "@/components/pastoral/FilterChip"
import { PrayerRequestForm } from "@/components/pastoral/PrayerRequestForm"
import { PrayerRequestList } from "@/components/pastoral/PrayerRequestList"
import { listPrayerRequests } from "@/lib/actions/prayerRequest"
import { PrayerRequestStatus } from "@/lib/generated/prisma/enums"
import { canManagePrayerRequests } from "@/lib/roleGuard"

const CHOICES = [
  { value: "active", label: "Active", statuses: [PrayerRequestStatus.ACTIVE] },
  { value: "answered", label: "Answered", statuses: [PrayerRequestStatus.ANSWERED] },
  { value: "archived", label: "Archived", statuses: [PrayerRequestStatus.ARCHIVED] },
] as const

/**
 * Absolute URL of the public prayer form so staff can copy it. Uses the origin
 * of AUTH_URL; falls back to the relative path when it is unset or invalid.
 * @returns the absolute URL, or "/prayer-request"
 */
function publicFormUrl(): string {
  try {
    return new URL("/prayer-request", new URL(process.env.AUTH_URL ?? "").origin).toString()
  } catch {
    return "/prayer-request"
  }
}

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
        Private to pastors and admins. Anyone can also submit one at{" "}
        <Link href="/prayer-request" className="underline">{publicFormUrl()}</Link>.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
        {CHOICES.map((c) => (
          <FilterChip
            key={c.value}
            href={c.value === "active" ? "/prayer-requests" : `/prayer-requests?status=${c.value}`}
            active={choice.value === c.value}
          >
            {c.label}
          </FilterChip>
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
