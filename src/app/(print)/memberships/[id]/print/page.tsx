import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canEdit } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { decrypt } from "@/lib/crypto"
import { readPayload, officeSignatureLabel, overseasFieldLabels } from "@/lib/membership"
import { getChurchSettings } from "@/lib/churchSettings"
import { getLetterSettings } from "@/lib/letterSettings"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { PRIMARY_HEX } from "@/lib/theme/palette"
import { redirect, notFound } from "next/navigation"
import { headers } from "next/headers"
import { PrintButton } from "@/components/ui/PrintButton"
import { APP_LOCALE } from "@/lib/appConfig"

type Props = { params: Promise<{ id: string }> }

function Line({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      <span className="val">{value || ""}</span>
    </div>
  )
}

function yesNo(v: boolean | null | undefined): string {
  if (v == null) return ""
  return v ? "Yes" : "No"
}

export default async function MembershipPrintPage(props: Props) {
  const { id: idStr } = await props.params
  const session = await auth()
  if (!session) redirect("/login")
  const headersList = await headers()
  const nonce = headersList.get("x-nonce") ?? undefined
  // Renders decrypted applicant PII — gate to edit roles, same as the other
  // print pages (VIEWER/AUDITOR must not reach it directly).
  if (!canEdit(session?.user?.role)) redirect("/")

  const id = Number.parseInt(idStr, 10)
  if (Number.isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const app = await prisma.membershipApplication.findUnique({ where: { id } })
  if (!app) notFound()

  // Retention purge: payload/signature emptied + anonymizedAt stamped.
  // There is nothing left to print, so 404 rather than JSON.parse("") a 500.
  if (app.anonymizedAt) notFound()

  const p = readPayload(app.payload as string)
  const signature = decrypt(app.signature)
  const pe = p.personal
  await logAudit(actorId(session), "MEMBERSHIP_PRINTED", "MembershipApplication", id, undefined, auditIpFromHeaders(headersList))

  const [{ name: churchName, address: churchAddress }, membershipSettings, { signerTitle }] = await Promise.all([
    getChurchSettings(),
    getMembershipSettings(),
    getLetterSettings(),
  ])
  const { parishFields, homeAddressLabel, arrivalDateLabel } = membershipSettings
  const ol = overseasFieldLabels(p, membershipSettings)

  return (
    <div className="sheet">
      <div className="print:hidden">
        <PrintButton />
      </div>
      <style nonce={nonce}>{`
        @page { size: A4; margin: 14mm; }
        .sheet { font-family: Arial, sans-serif; color: #0f172a; font-size: 12px; max-width: 800px; margin: 0 auto; padding: 16px; }
        .head { text-align: center; border-bottom: 2px solid ${PRIMARY_HEX}; padding-bottom: 8px; margin-bottom: 12px; }
        .head h1 { color: ${PRIMARY_HEX}; font-size: 20px; margin: 0; }
        .title { text-align: center; font-weight: bold; letter-spacing: 1px; color: ${PRIMARY_HEX}; margin: 10px 0; }
        .band { background: ${PRIMARY_HEX}; color: #fff; font-weight: bold; padding: 4px 8px; margin: 14px 0 6px; }
        .row { display: flex; gap: 8px; padding: 2px 0; border-bottom: 1px dotted #cbd5e1; }
        .lbl { width: 220px; font-weight: 600; }
        .val { flex: 1; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        th, td { border: 1px solid #94a3b8; padding: 3px 6px; text-align: left; font-size: 11px; }
        th { background: #e2e8f0; }
        .sig { max-height: 120px; border: 1px solid #94a3b8; background: #fff; }
        .office { border: 1px solid #94a3b8; padding: 8px; margin-top: 16px; }
        @media print { button { display: none; } }
      `}</style>

      <div className="head">
        <h1>{churchName}</h1>
        <div>{churchAddress}</div>
      </div>
      <div className="title">MEMBERSHIP REGISTRATION FORM</div>

      <div className="band">A. Personal Particulars</div>
      <Line label="Name" value={pe.name} />
      <Line label="Sex" value={pe.gender} />
      <Line label="Date of Birth" value={pe.dateOfBirth} />
      <Line label="E-mail ID" value={pe.email} />
      <Line label="Mobile" value={pe.mobile} />
      <Line label="Residential Address" value={[pe.address, pe.suburb, pe.state, pe.postcode].filter(Boolean).join(", ")} />
      <Line label="Qualification & Profession" value={pe.qualificationProfession} />
      {(parishFields || pe.motherParish) && <Line label="Previous church" value={pe.motherParish} />}
      {(homeAddressLabel || pe.addressInIndia) && <Line label={ol.homeAddress} value={pe.addressInIndia} />}
      {(arrivalDateLabel || pe.dateOfArrivalNsw) && <Line label={ol.arrivalDate} value={pe.dateOfArrivalNsw} />}
      <Line label="Marital Status" value={pe.maritalStatus} />
      {(parishFields || pe.transferCertFurnished != null) && (
        <Line label="Transfer letter provided" value={yesNo(pe.transferCertFurnished)} />
      )}

      {p.spouse && (
        <>
          <div className="band">B. Details of Family (Spouse)</div>
          <Line label="Name of Spouse" value={p.spouse.name} />
          <Line label="Date of Birth" value={p.spouse.dateOfBirth} />
          <Line label="Date of Marriage" value={p.spouse.dateOfMarriage} />
          {(parishFields || p.spouse.parish) && <Line label="Spouse's church" value={p.spouse.parish} />}
          <Line label="Spouse working" value={yesNo(p.spouse.working)} />
          <Line label="Spouse E-mail ID" value={p.spouse.email} />
        </>
      )}

      {p.children.length > 0 && (
        <>
          <div className="band">C. Name of Children</div>
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Sex</th><th>Date of Birth</th><th>Occupation</th><th>Phone / Email</th></tr>
            </thead>
            <tbody>
              {p.children.map((c, i) => (
                <tr key={i}><td>{i + 1}</td><td>{c.name}</td><td>{c.sex}</td><td>{c.dateOfBirth}</td><td>{c.occupation}</td><td>{c.phoneEmail}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {p.dependents.length > 0 && (
        <>
          <div className="band">D. Other Dependents</div>
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Sex</th><th>Date of Birth</th><th>Relationship</th><th>Phone / Email</th></tr>
            </thead>
            <tbody>
              {p.dependents.map((d, i) => (
                <tr key={i}><td>{i + 1}</td><td>{d.name}</td><td>{d.sex}</td><td>{d.dateOfBirth}</td><td>{d.relationship}</td><td>{d.phoneEmail}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {p.relativesInAustralia.length > 0 && (
        <>
          <div className="band">E. Any Other Relatives in Australia</div>
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Place</th><th>Relationship</th><th>Phone / Email</th></tr>
            </thead>
            <tbody>
              {p.relativesInAustralia.map((r, i) => (
                <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td>{r.place}</td><td>{r.relationship}</td><td>{r.phoneEmail}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="band">F. Subscription & Declaration</div>
      <Line label="Monthly Subscription" value={app.monthlyDues ? `$${app.monthlyDues.toString()}` : ""} />
      <p style={{ fontStyle: "italic", margin: "8px 0" }}>
        I declare that the above information is true and correct to the best of my knowledge.
      </p>
      <Line label="Place" value={app.placeSigned} />
      <Line label="Date" value={app.signedDate?.toLocaleDateString(APP_LOCALE)} />
      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 600 }}>Signature</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={signature} alt="Signature" className="sig" />
      </div>

      <div className="office">
        <div style={{ fontWeight: "bold", color: PRIMARY_HEX }}>FOR OFFICE USE ONLY</div>
        {parishFields && <Line label="Transfer letter / NOC / Affidavit received" value="" />}
        <Line label="Membership Registration No." value="" />
        <Line label="Book No." value="" />
        <Line label="Date" value="" />
        <Line label={officeSignatureLabel(signerTitle)} value="" />
      </div>
    </div>
  )
}
