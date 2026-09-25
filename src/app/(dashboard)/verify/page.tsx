import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { TEST_CHECKPOINTS } from "@/lib/testCheckpoints"
import { CheckpointRow } from "@/components/settings/CheckpointRow"
import { cn } from "@/lib/utils"

type Status = "PENDING" | "WORKING" | "BROKEN"
const FILTERS = ["pending", "working", "broken", "all"] as const
type Filter = (typeof FILTERS)[number]

const TAB_LABEL: Record<Filter, string> = {
  pending: "Pending",
  working: "Working",
  broken: "Not working",
  all: "All",
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")

  const { filter: rawFilter } = await searchParams
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter ?? "")
    ? (rawFilter as Filter)
    : "pending"

  const results = await prisma.checkpointResult.findMany({
    select: { checkpointId: true, status: true, issueNumber: true },
  })
  const byId = new Map(results.map((r) => [r.checkpointId, r]))

  const rows = TEST_CHECKPOINTS.map((c) => {
    const r = byId.get(c.id)
    const status: Status = r ? (r.status as "WORKING" | "BROKEN") : "PENDING"
    return { checkpoint: c, status, issueNumber: r?.issueNumber ?? null }
  })

  const pendingCount = rows.filter((r) => r.status === "PENDING").length

  const visible = rows.filter((r) => {
    if (filter === "all") return true
    if (filter === "pending") return r.status === "PENDING"
    if (filter === "working") return r.status === "WORKING"
    return r.status === "BROKEN"
  })

  // Group visible rows by version, preserving the (newest-first) authoring order.
  const versions: string[] = []
  const grouped = new Map<string, typeof visible>()
  for (const row of visible) {
    const v = row.checkpoint.version
    if (!grouped.has(v)) {
      grouped.set(v, [])
      versions.push(v)
    }
    grouped.get(v)!.push(row)
  }

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-2xl font-semibold text-foreground">Verify</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Check each change works. {pendingCount} pending verification.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "pending" ? "/verify" : `/verify?filter=${f}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              f === filter
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input text-muted-foreground hover:bg-muted",
            )}
          >
            {TAB_LABEL[f]}
          </Link>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <div className="space-y-6">
          {versions.map((v) => (
            <section key={v}>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{v}</h3>
              <div className="space-y-2">
                {grouped.get(v)!.map((row) => (
                  <CheckpointRow
                    key={row.checkpoint.id}
                    checkpoint={row.checkpoint}
                    status={row.status}
                    issueNumber={row.issueNumber}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
