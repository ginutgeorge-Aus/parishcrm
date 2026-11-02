import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { MONTH_ABBR } from "@/lib/formatting"
import { sydneyParts } from "@/lib/dates"
import { getChurchSettings } from "@/lib/churchSettings"
import { PrintButton } from "@/components/ui/PrintButton"

const ROLE_LABEL: Record<string, string> = {
  HEAD: "Head",
  SPOUSE: "Spouse",
  CHILD: "Child",
  OTHER: "Other",
}

// The directory legitimately prints every active family, but an unbounded
// findMany decrypts the whole roster into memory — same defensive cap the CSV
// export routes carry. Fetch one past the cap to detect truncation.
const MAX_DIRECTORY_FAMILIES = 10000

export default async function FamilyDirectoryPrintPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isAdmin(session?.user?.role)) redirect("/")

  const fetched = await prisma.family.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    take: MAX_DIRECTORY_FAMILIES + 1,
    select: {
      id: true,
      name: true,
      memberNo: true,
      address: true,
      suburb: true,
      state: true,
      postcode: true,
      homePhone: true,
      people: {
        where: { archivedAt: null },
        orderBy: [{ role: "asc" }, { firstName: "asc" }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          mobile: true,
        },
      },
    },
  })

  const truncated = fetched.length > MAX_DIRECTORY_FAMILIES
  const families = truncated ? fetched.slice(0, MAX_DIRECTORY_FAMILIES) : fetched

  const headersList = await headers()
  const ip = auditIpFromHeaders(headersList)
  // Production CSP nonces style-src; the print <style> needs the nonce.
  const nonce = headersList.get("x-nonce") ?? undefined
  await logAudit(
    actorId(session),
    "DIRECTORY_PRINTED",
    "Family",
    undefined,
    { familyCount: families.length },
    ip
  )

  const { year, month, day } = sydneyParts()
  const generated = `${day} ${MONTH_ABBR[month - 1]} ${year}`
  const { name: churchName } = await getChurchSettings()

  const decrypted = families.map((f) => ({
    ...f,
    address: f.address ? safeDecrypt(f.address) : null,
    suburb: f.suburb ? safeDecrypt(f.suburb) : null,
    state: f.state ? safeDecrypt(f.state) : null,
    postcode: f.postcode ? safeDecrypt(f.postcode) : null,
    homePhone: f.homePhone ? safeDecrypt(f.homePhone) : null,
    people: f.people.map((p) => ({
      ...p,
      mobile: p.mobile ? safeDecrypt(p.mobile) : null,
    })),
  }))

  return (
    <>
      <div className="print:hidden">
        <PrintButton />
      </div>
      <style nonce={nonce}>{`
        /* Print-scoped palette — CSS vars defined here apply reliably in @media print (unlike app :root tokens). */
        :root { --c-meta: oklch(42.2% 0 0); --c-rule: oklch(82.4% 0 0); --c-rule-light: oklch(93.3% 0 0); --c-dim: oklch(56.5% 0 0); --c-address: oklch(30.2% 0 0); --c-th: oklch(63.5% 0 0); --c-warning: oklch(54.5% 0.238 48.5); }
        body { font-family: sans-serif; font-size: 11px; margin: 24px; }
        h1 { font-size: 16px; margin-bottom: 2px; }
        .meta { color: var(--c-meta); font-size: 10px; margin-bottom: 20px; }
        .warning { color: var(--c-warning); }
        .meta-cell { color: var(--c-meta); }
        .family { margin-bottom: 14px; page-break-inside: avoid; }
        .family-name { font-weight: 700; font-size: 12px; border-bottom: 1px solid var(--c-rule); padding-bottom: 2px; margin-bottom: 4px; }
        .family-name span { font-weight: 400; color: var(--c-dim); font-size: 10px; margin-left: 6px; }
        .address { color: var(--c-address); margin-bottom: 3px; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        th { font-size: 9px; text-transform: uppercase; color: var(--c-th); font-weight: 600; border-bottom: 1px solid var(--c-rule-light); padding: 2px 4px; text-align: left; }
        td { padding: 2px 4px; font-size: 10px; }
        @media print { body { margin: 0; } }
      `}</style>

      <h1>{churchName} — Church Directory</h1>
      <p className="meta">Active families · Generated: {generated} · {decrypted.length} families</p>

      {truncated && (
        <p className="meta warning">
          Showing the first {MAX_DIRECTORY_FAMILIES.toLocaleString()} families (alphabetical).
          More active families exist — this print is capped.
        </p>
      )}

      {decrypted.map((f) => {
        const addressParts = [f.address, f.suburb, f.state, f.postcode].filter(Boolean)
        const addressLine = addressParts.length > 0 ? addressParts.join(", ") : null

        return (
          <div key={f.id} className="family">
            <div className="family-name">
              {f.name}
              {f.memberNo && <span>{f.memberNo}</span>}
            </div>
            {(addressLine || f.homePhone) && (
              <div className="address">
                {addressLine && <span>{addressLine}</span>}
                {addressLine && f.homePhone && " · "}
                {f.homePhone && <span>Ph: {f.homePhone}</span>}
              </div>
            )}
            {f.people.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Mobile</th>
                  </tr>
                </thead>
                <tbody>
                  {f.people.map((p) => (
                    <tr key={p.id}>
                      <td>{p.firstName} {p.lastName}</td>
                      <td className="meta-cell">{ROLE_LABEL[p.role] ?? p.role}</td>
                      <td className="meta-cell">{p.mobile ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </>
  )
}
