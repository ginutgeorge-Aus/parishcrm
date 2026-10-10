import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { sydneyTodayYMD } from "@/lib/dates"
import { prisma } from "@/lib/prisma"
import { loadRoll } from "@/lib/sundaySchoolRoll"
import { parseRollDate } from "@/lib/sundaySchoolRollView"
import { Badge } from "@/components/ui/badge"
import { RollList } from "@/components/sunday-school/RollList"

/**
 * Server-rendered body shared by the staff (`/sunday-school/[id]/roll`) and organiser
 * (`/my-classes/[id]/roll`) roll pages. Callers gate access and decide
 * `canMark`; this validates `?date=`, loads the roll and renders it. A past
 * year's class with no date opens on its last day instead of erroring.
 */
export async function renderRollView({
  classId, rawDate, canMark, hrefBase, backHref, backLabel,
}: Readonly<{ classId: number; rawDate: string | undefined; canMark: boolean; hrefBase: string; backHref: string; backLabel: string }>) {
  const cls = await prisma.sundaySchoolClass.findUnique({ where: { id: classId }, select: { year: true, name: true } })
  if (!cls) notFound()
  const today = sydneyTodayYMD()
  const parsed = parseRollDate(rawDate, cls.year, today)
  if (!parsed.ok && !rawDate?.trim() && cls.year < Number.parseInt(today.slice(0, 4), 10)) {
    redirect(`${hrefBase}?date=${cls.year}-12-31`)
  }
  const roll = parsed.ok ? await loadRoll(classId, parsed.ymd) : null
  if (parsed.ok && !roll) notFound()

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={backHref} className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">
        ← {backLabel}
      </Link>
      <h1 className="mb-4 flex items-center gap-2 text-2xl font-bold text-foreground">
        Roll · {cls.name}
        {roll?.cls.archived && <Badge variant="secondary">Archived</Badge>}
      </h1>
      {parsed.ok && roll ? (
        <RollList
          classId={classId}
          date={parsed.ymd}
          today={today}
          rows={roll.rows}
          readOnly={roll.cls.archived || !canMark}
          dateHrefBase={hrefBase}
        />
      ) : (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">{parsed.ok ? "Class not found" : parsed.error}</p>
          <Link href={hrefBase} className="text-sm text-primary hover:underline">Back to today&apos;s roll</Link>
        </div>
      )}
    </div>
  )
}
