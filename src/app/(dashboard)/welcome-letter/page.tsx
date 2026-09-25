import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { WelcomeLetterClient } from "@/components/welcome-letter/WelcomeLetterClient"

export default async function WelcomeLetterPage() {
  const session = await auth()
  if (!canEdit(session?.user?.role)) redirect("/")

  // Small dataset (church families) — load id/name/memberNo for the picker.
  const families = await prisma.family.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, memberNo: true },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Welcome Letter</h1>
        <p className="text-sm text-muted-foreground">
          Generate and email a new-member welcome letter. Pick a family, review the draft, then send.
        </p>
      </div>
      <WelcomeLetterClient families={families} />
    </div>
  )
}
