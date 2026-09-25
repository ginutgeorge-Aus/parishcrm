import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageUsers, isAdmin } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DeleteUserButton } from "@/components/users/DeleteUserButton"
import { UnlockUserButton } from "@/components/users/UnlockUserButton"
import { ResendWelcomeButton } from "@/components/users/ResendWelcomeButton"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

const roleVariant: Record<UserRole, "default" | "secondary" | "outline"> = {
  ADMIN: "default",
  PASTOR: "secondary",
  VIEWER: "outline",
  AUDITOR: "outline",
  OFFICE_ADMIN: "secondary",
  EVENT_ORGANISER: "outline",
}

const roleLabel: Record<UserRole, string> = {
  ADMIN: "Admin",
  PASTOR: "Pastor",
  VIEWER: "Viewer",
  AUDITOR: "Auditor",
  OFFICE_ADMIN: "Office Admin",
  EVENT_ORGANISER: "Event Organiser",
}

export default async function UsersPage() {
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) redirect("/")

  // Non-ADMIN actors (OFFICE_ADMIN) may not act on an ADMIN account — every
  // user action rejects it server-side. Hide the controls so they
  // don't offer buttons that then fail.
  const viewerIsAdmin = isAdmin(session?.user?.role)

  const now = new Date()
  const users = await prisma.user.findMany({
    where: { archivedAt: null }, // hide soft-deleted users
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, lockedUntil: true, otpLockedUntil: true },
  })

  // Last successful login per user, derived from the USER_LOGIN audit events
  // already written at every login-success path.
  const lastLogins = await prisma.auditLog.groupBy({
    by: ["userId"],
    where: { action: "USER_LOGIN" },
    _max: { createdAt: true },
  })
  const lastLoginByUser = new Map<number, Date>()
  for (const row of lastLogins) {
    if (row.userId != null && row._max.createdAt) lastLoginByUser.set(row.userId, row._max.createdAt)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Users</h2>
        <Button asChild>
          <Link href="/users/new">New user</Link>
        </Button>
      </div>

      {/* Mobile: card per user (avoids sideways scroll to reach row actions) */}
      <ul className="space-y-2 md:hidden">
        {users.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No users found
          </li>
        )}
        {users.map((u) => {
          const isLocked =
            (!!u.lockedUntil && u.lockedUntil > now) ||
            (!!u.otpLockedUntil && u.otpLockedUntil > now)
          const lastLogin = lastLoginByUser.get(u.id)
          return (
            <li key={u.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{u.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={roleVariant[u.role]}>{roleLabel[u.role] ?? u.role}</Badge>
                  {isLocked && <Badge variant="destructive">Locked</Badge>}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Last login:{" "}
                {lastLogin
                  ? lastLogin.toLocaleString(APP_LOCALE, {
                      day: "numeric", month: "short", year: "numeric",
                      hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE,
                    })
                  : "Never"}
              </p>
              {(viewerIsAdmin || u.role !== "ADMIN") && (
                <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                  {isLocked && <UnlockUserButton userId={u.id} className="h-11 sm:h-7 any-pointer-coarse:h-11" />}
                  <Button variant="ghost" size="sm" asChild className="h-11 sm:h-7 any-pointer-coarse:h-11">
                    <Link href={`/users/${u.id}/edit`}>Edit</Link>
                  </Button>
                  <ResendWelcomeButton userId={u.id} className="h-11 sm:h-7 any-pointer-coarse:h-11" />
                  <DeleteUserButton userId={u.id} userName={u.name} triggerClassName="h-11 sm:h-7 any-pointer-coarse:h-11" />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto md:block">
        <Table className="min-w-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="w-32"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const isLocked =
                (!!u.lockedUntil && u.lockedUntil > now) ||
                (!!u.otpLockedUntil && u.otpLockedUntil > now)
              const lastLogin = lastLoginByUser.get(u.id)
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={roleVariant[u.role]}>{roleLabel[u.role] ?? u.role}</Badge>
                      {isLocked && (
                        <Badge variant="destructive">Locked</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lastLogin
                      ? lastLogin.toLocaleString(APP_LOCALE, {
                          day: "numeric", month: "short", year: "numeric",
                          hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE,
                        })
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    {(viewerIsAdmin || u.role !== "ADMIN") && (
                      <div className="flex flex-wrap gap-2">
                        {isLocked && <UnlockUserButton userId={u.id} />}
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/users/${u.id}/edit`}>Edit</Link>
                        </Button>
                        <ResendWelcomeButton userId={u.id} />
                        <DeleteUserButton userId={u.id} userName={u.name} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
