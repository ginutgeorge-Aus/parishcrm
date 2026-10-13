import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { updateClass } from "@/lib/actions/sundaySchool"
import { lockedYears } from "@/lib/sundaySchoolYearLock"
import { ClassForm } from "@/components/sunday-school/ClassForm"
import { ArchiveClassButton } from "@/components/sunday-school/ArchiveClassButton"

/** Edit a live Sunday School class (name, level, location) or archive it. canEdit only. */
export default async function EditClassPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!canEdit(session?.user?.role)) redirect("/sunday-school")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()

  const cls = await prisma.sundaySchoolClass.findUnique({
    where: { id },
    select: { id: true, year: true, name: true, level: true, location: true, archivedAt: true },
  })
  if (!cls || cls.archivedAt) notFound()
  // Rolled-over years are read-only; updateClass/archiveClass refuse them too.
  if ((await lockedYears([cls.year])).has(cls.year)) redirect(`/sunday-school/${cls.id}`)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/sunday-school?year=${cls.year}`} className="hover:underline">Sunday School</Link>
          {" / "}
          <Link href={`/sunday-school/${cls.id}`} className="hover:underline">{cls.name}</Link>
          {" / Edit"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Edit class</h2>
      </div>
      <ClassForm action={updateClass.bind(null, cls.id)} year={cls.year} cls={cls} />
      <div className="max-w-md border-t pt-4">
        <ArchiveClassButton classId={cls.id} year={cls.year} />
      </div>
    </div>
  )
}
