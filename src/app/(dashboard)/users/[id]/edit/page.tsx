import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageUsers, isAdmin } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"
import { updateUser } from "@/lib/actions/user"
import { UserForm } from "@/components/users/UserForm"

export default async function EditUserPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) redirect("/")

  const id = parseInt(params.id, 10)
  if (isNaN(id) || id <= 0 || id > 2147483647) notFound()

  // Select only the fields UserForm needs. The full row includes passwordHash,
  // OTP/reset-token state and lockout timestamps; passing it into a Client
  // Component ships every column into the RSC payload the browser receives
  // (TS prop narrowing is compile-time only, not a runtime filter) —.
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, archivedAt: true },
  })
  // Soft-deleted users are gone — don't render the tombstoned email.
  if (!user || user.archivedAt) notFound()

  // Non-ADMIN actors may not edit an ADMIN account — mirror the updateUser
  // server guard so OFFICE_ADMIN never lands on a form that would fail.
  if (user.role === UserRole.ADMIN && !isAdmin(session?.user?.role)) redirect("/users")

  // Don't ship archivedAt into the Client Component RSC payload.
  const { archivedAt: _archivedAt, ...userForForm } = user
  const action = updateUser.bind(null, user.id)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Edit user</h2>
      <UserForm action={action} user={userForForm} currentUserRole={session?.user?.role} />
    </div>
  )
}
