import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canManageUsers } from "@/lib/roleGuard"
import { createUser } from "@/lib/actions/user"
import { UserForm } from "@/components/users/UserForm"

export default async function NewUserPage() {
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) redirect("/")

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">New user</h2>
      <UserForm action={createUser} currentUserRole={session?.user?.role} />
    </div>
  )
}
