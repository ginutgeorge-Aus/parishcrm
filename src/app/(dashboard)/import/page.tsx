import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { ImportClient } from "@/components/import/ImportClient"

export default async function ImportPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/families")

  return <ImportClient />
}
