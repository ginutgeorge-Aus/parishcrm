import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { MergeClient } from "@/components/families/MergeClient"

export default async function FamilyMergePage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isAdmin(session.user.role)) redirect("/families")

  // Fetch all active families in bounded pages so large churches aren't
  // silently truncated by a single 1,000-row cap.
  const PAGE_SIZE = 1000
  const families = await prisma.family.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, memberNo: true },
    take: PAGE_SIZE,
  })

  let lastBatchLength = families.length

  while (lastBatchLength === PAGE_SIZE) {
    const nextBatch = await prisma.family.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, memberNo: true },
      take: PAGE_SIZE,
      cursor: { id: families[families.length - 1].id },
      skip: 1,
    })
    families.push(...nextBatch)
    lastBatchLength = nextBatch.length
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href="/families" className="hover:underline">Families</Link>
          {" / Merge duplicates"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Merge duplicate families</h2>
      </div>
      <MergeClient families={families} />
    </div>
  )
}
