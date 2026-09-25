import type { Metadata } from "next"
import { MembershipForm } from "./MembershipForm"
import { getChurchSettings } from "@/lib/churchSettings"
import { getMembershipSettings } from "@/lib/membershipSettings"

export const metadata: Metadata = {
  title: "Membership Registration",
  robots: { index: false },
}

export default async function MembershipFormPage() {
  const [{ name, website, email }, { parishFields, minDues, homeAddressLabel, arrivalDateLabel }] = await Promise.all([getChurchSettings(), getMembershipSettings()])
  return (
    <MembershipForm
      churchName={name}
      churchWebsite={website}
      churchEmail={email}
      parishFields={parishFields}
      minDues={minDues}
      homeAddressLabel={homeAddressLabel}
      arrivalDateLabel={arrivalDateLabel}
    />
  )
}
