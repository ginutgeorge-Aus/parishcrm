import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default async function NewPersonPage() {
  const session = await auth()
  if (!canEdit(session?.user?.role)) redirect("/people")

  const families = await prisma.family.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  async function goToFamily(formData: FormData): Promise<void> {
    "use server"
    const raw = formData.get("familyId")
    const id = parseInt(String(raw), 10)
    if (!Number.isFinite(id) || id <= 0) return
    redirect(`/families/${id}/people/new`)
  }

  return (
    <div className="space-y-4 max-w-sm">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href="/people" className="hover:underline">People</Link>
          {" / New person"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Add new person</h2>
      </div>
      <p className="text-sm text-muted-foreground">Select a family to add a member to.</p>
      <form action={goToFamily} className="space-y-3">
        <label htmlFor="familyId" className="sr-only">Select a family</label>
        <Select name="familyId" required>
          <SelectTrigger id="familyId" className="w-full">
            <SelectValue placeholder="Select a family…" />
          </SelectTrigger>
          <SelectContent>
            {families.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" className="w-full">Continue</Button>
      </form>
    </div>
  )
}
