import { notFound, redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { logAudit } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { MONTH_ABBR } from "@/lib/formatting"
import { sydneyParts } from "@/lib/dates"
import { getChurchSettings } from "@/lib/churchSettings"
import { GROUP_CATEGORY_LABELS, GROUP_ROLE_LABELS } from "@/lib/groups"
import { loadMemberExportRows } from "@/lib/groupMembers"
import { PrintButton } from "@/components/ui/PrintButton"

/** Printable member list (name, role, title, email, mobile) for one group. ADMIN only (decrypted email/mobile, like the families directory print); audited. */
export default async function GroupPrintPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!isAdmin(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()

  const group = await prisma.group.findUnique({ where: { id }, select: { id: true, name: true, category: true } })
  if (!group) notFound()
  const [rows, { name: churchName }, headersList] = await Promise.all([
    loadMemberExportRows(id), getChurchSettings(), headers(),
  ])
  // Production CSP nonces style-src; the print <style> needs the nonce.
  const nonce = headersList.get("x-nonce") ?? undefined
  await logAudit(actorId(session), "GROUP_MEMBERS_PRINTED", "Group", id, { rowCount: rows.length }, auditIpFromHeaders(headersList))

  const { year, month, day } = sydneyParts()
  const generated = `${day} ${MONTH_ABBR[month - 1]} ${year}`

  return (
    <>
      <div className="print:hidden">
        <PrintButton />
      </div>
      <style nonce={nonce}>{`
        :root { --c-meta: oklch(42.2% 0 0); --c-rule: oklch(82.4% 0 0); --c-th: oklch(63.5% 0 0); }
        body { font-family: sans-serif; font-size: 11px; margin: 24px; }
        h1 { font-size: 16px; margin-bottom: 2px; }
        .meta { color: var(--c-meta); font-size: 10px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 9px; text-transform: uppercase; color: var(--c-th); font-weight: 600; border-bottom: 1px solid var(--c-rule); padding: 3px 4px; text-align: left; }
        td { padding: 3px 4px; font-size: 10px; border-bottom: 1px solid var(--c-rule); }
        tr { page-break-inside: avoid; }
        @media print { body { margin: 0; } }
      `}</style>

      <h1>{churchName} — {group.name}</h1>
      <p className="meta">{GROUP_CATEGORY_LABELS[group.category]} · {rows.length} {rows.length === 1 ? "member" : "members"} · Generated: {generated}</p>

      {rows.length === 0 ? (
        <p>No members.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Family</th><th>Role</th><th>Title</th><th>Email</th><th>Mobile</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              // Rows carry no id (export shape); order is stable for one render.
              <tr key={`${r.lastName}-${r.firstName}-${i}`}>
                <td>{r.firstName} {r.lastName}</td>
                <td>{r.familyName}</td>
                <td>{GROUP_ROLE_LABELS[r.role]}</td>
                <td>{r.title}</td>
                <td>{r.email}</td>
                <td>{r.mobile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
