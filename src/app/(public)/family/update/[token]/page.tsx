import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { hashInviteToken } from "@/lib/familyUpdateToken"
import { issueFormToken } from "@/lib/formToken"
import { FamilyUpdateForm } from "@/components/family-update/FamilyUpdateForm"
import { getChurchSettings } from "@/lib/churchSettings"
import type { Metadata } from "next"

// noindex/nofollow: opaque-token page exposing family PII.
export const metadata: Metadata = {
  title: "Update your family details",
  robots: { index: false, follow: false },
}

type Props = { params: Promise<{ token: string }> }

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-md mx-auto mt-20 text-center px-6">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-muted-foreground">{body}</p>
    </div>
  )
}

export default async function FamilyUpdatePage(props: Props) {
  const { token } = await props.params
  const invite = await prisma.familyUpdateInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: {
      family: {
        include: {
          // select only the columns the form pre-fills — never the encrypted
          // pastoralNotes/emergencyContact/notes/bankingName/hash columns.
          people: {
            where: { archivedAt: null },
            orderBy: { id: "asc" },
            select: {
              id: true, title: true, firstName: true, middleName: true,
              lastName: true, suffix: true, gender: true, dateOfBirth: true,
              email: true, mobile: true, workPhone: true, homePhone: true,
            },
          },
        },
      },
    },
  })

  // A family archived after the invite was mailed must not render its
  // decrypted PII to the (unauthenticated) link holder — mirrors the
  // archivedAt gate on the submit/approve paths.
  if (!invite || invite.status === "REVOKED" || invite.expiresAt < new Date() || invite.family?.archivedAt) {
    return (
      <Notice
        title="Link expired"
        body="This update link is no longer valid. Please ask the church office to send a new one."
      />
    )
  }
  if (invite.status === "SUBMITTED") {
    return (
      <Notice
        title="Thank you"
        body="Your update has been received and is awaiting review by the church office."
      />
    )
  }

  const f = invite.family
  const initial = {
    family: {
      address: f.address ? safeDecrypt(f.address) : "",
      suburb: f.suburb ? safeDecrypt(f.suburb) : "",
      state: f.state ? safeDecrypt(f.state) : "",
      postcode: f.postcode ? safeDecrypt(f.postcode) : "",
      homePhone: f.homePhone ? safeDecrypt(f.homePhone) : "",
      marriageDate: f.marriageDate ? f.marriageDate.toISOString().slice(0, 10) : "",
    },
    members: f.people.map((p) => ({
      personId: p.id,
      title: p.title ?? "",
      firstName: p.firstName,
      middleName: p.middleName ?? "",
      lastName: p.lastName,
      suffix: p.suffix ?? "",
      gender: p.gender ?? "",
      dateOfBirth: p.dateOfBirth ? safeDecrypt(p.dateOfBirth) : "",
      email: p.email ? safeDecrypt(p.email) : "",
      mobile: p.mobile ? safeDecrypt(p.mobile) : "",
      workPhone: p.workPhone ? safeDecrypt(p.workPhone) : "",
      homePhone: p.homePhone ? safeDecrypt(p.homePhone) : "",
    })),
  }

  // eslint-disable-next-line react-hooks/purity
  const formToken = issueFormToken(Date.now())

  const { website } = await getChurchSettings()

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold mb-1">Update your family details</h1>
      <p className="text-muted-foreground mb-6">
        {f.name}. Review the details below, make any changes, and submit. The church office will
        confirm your changes.
      </p>
      <FamilyUpdateForm token={token} formToken={formToken} initial={initial} churchWebsite={website} />
    </div>
  )
}
