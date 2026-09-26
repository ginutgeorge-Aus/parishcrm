import { auth } from "@/auth"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { decrypt } from "@/lib/crypto"
import { readPayload, buildNotesBlock, overseasFieldLabels } from "@/lib/membership"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { findMembershipMatches } from "@/lib/actions/membership"
import { MEMBERSHIP_STATUS_LABELS } from "@/lib/membershipLabels"
import { ReviewPanel } from "./ReviewPanel"
import { APP_LOCALE } from "@/lib/appConfig"

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="py-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  )
}

export default async function MembershipDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/")

  const { id: idStr } = await params
  const id = Number.parseInt(idStr, 10)
  if (Number.isNaN(id) || id <= 0) notFound()

  const app = await prisma.membershipApplication.findUnique({ where: { id } })
  if (!app) notFound()

  // Retention purge: the PII purge sets payload/signature to "" and
  // stamps anonymizedAt, keeping the decision row for the audit trail. readPayload
  // would JSON.parse("") and 500, so render a redacted state instead of parsing.
  if (app.anonymizedAt) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Application redacted</h2>
          <span className="rounded-md border px-2 py-0.5 text-sm text-muted-foreground">{MEMBERSHIP_STATUS_LABELS[app.status]}</span>
        </div>
        <section className="rounded-md border p-4 text-sm text-muted-foreground">
          The personal details of this application were removed under the data-retention policy
          on {app.anonymizedAt.toLocaleDateString(APP_LOCALE)}. The decision is retained for the audit trail.
        </section>
      </div>
    )
  }

  const p = readPayload(app.payload as string)
  const signature = decrypt(app.signature)
  const [matches, membershipSettings] = await Promise.all([
    app.status === "PENDING" ? findMembershipMatches(id) : Promise.resolve([]),
    getMembershipSettings(),
  ])
  const { parishFields } = membershipSettings
  const ol = overseasFieldLabels(p, membershipSettings)
  const pe = p.personal

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">{pe.name}</h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-md border px-2 py-0.5 text-muted-foreground">{MEMBERSHIP_STATUS_LABELS[app.status]}</span>
          <Link href={`/memberships/${id}/print`} target="_blank" className="text-primary underline">
            Print form
          </Link>
        </div>
      </div>

      <section className="rounded-md border p-4">
        <h3 className="font-semibold mb-2">Personal</h3>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Field label="Sex" value={pe.gender} />
          <Field label="Date of Birth" value={pe.dateOfBirth} />
          <Field label="Email" value={pe.email} />
          <Field label="Mobile" value={pe.mobile} />
          <Field label="Address" value={[pe.address, pe.suburb, pe.state, pe.postcode].filter(Boolean).join(", ")} />
          <Field label="Qualification & Profession" value={pe.qualificationProfession} />
          {(parishFields || pe.motherParish) && <Field label="Previous church" value={pe.motherParish} />}
          <Field label="Marital Status" value={pe.maritalStatus} />
          <Field label={ol.homeAddress} value={pe.addressInIndia} />
          <Field label={ol.arrivalDate} value={pe.dateOfArrivalNsw} />
        </div>
      </section>

      {p.spouse && (
        <section className="rounded-md border p-4">
          <h3 className="font-semibold mb-2">Spouse</h3>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field label="Name" value={p.spouse.name} />
            <Field label="Date of Birth" value={p.spouse.dateOfBirth} />
            <Field label="Date of Marriage" value={p.spouse.dateOfMarriage} />
            <Field label="Email" value={p.spouse.email} />
            {(parishFields || p.spouse.parish) && <Field label="Spouse's church" value={p.spouse.parish} />}
          </div>
        </section>
      )}

      {p.children.length > 0 && (
        <section className="rounded-md border p-4">
          <h3 className="font-semibold mb-2">Children</h3>
          <ul className="text-sm list-disc pl-5">
            {p.children.map((c, i) => (
              <li key={i}>{[c.name, c.sex, c.dateOfBirth].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </section>
      )}

      {p.dependents.length > 0 && (
        <section className="rounded-md border p-4">
          <h3 className="font-semibold mb-2">Other Dependents</h3>
          <ul className="text-sm list-disc pl-5">
            {p.dependents.map((d, i) => (
              <li key={i}>{[d.name, d.sex, d.dateOfBirth, d.relationship].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border p-4">
        <h3 className="font-semibold mb-2">Subscription & Declaration</h3>
        <Field label="Monthly Subscription" value={app.monthlyDues ? `$${app.monthlyDues.toString()}` : null} />
        <Field label="Signed at" value={[app.placeSigned, app.signedDate?.toLocaleDateString(APP_LOCALE)].filter(Boolean).join(" · ")} />
        <div className="mt-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Signature</span>
          {/* eslint-disable-next-line @next/next/no-img-element, no-restricted-syntax -- white backdrop is intentional: signature ink is dark, must stay white in dark mode */}
          <img src={signature} alt="Applicant signature" className="mt-1 max-h-36 rounded border bg-white" />
        </div>
      </section>

      <section className="rounded-md border p-4">
        <h3 className="font-semibold mb-2">Other details</h3>
        <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{buildNotesBlock(p, membershipSettings)}</pre>
      </section>

      <ReviewPanel applicationId={id} matches={matches} status={app.status} />
    </div>
  )
}
