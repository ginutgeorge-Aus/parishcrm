import type { Metadata } from "next"
import { getChurchSettings } from "@/lib/churchSettings"
import { PublicPrayerRequestForm } from "./PublicPrayerRequestForm"

export const metadata: Metadata = {
  title: "Prayer request",
  robots: { index: false },
}

/** Public prayer request page: anyone can send a request to the pastors. */
export default async function PrayerRequestPage() {
  const { name } = await getChurchSettings()
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground">Prayer request</h1>
      <p className="text-sm text-muted-foreground">
        Share a prayer request with the pastors of {name}. It is private unless you tick the box to share it. Giving your
        name and contact details is optional.
      </p>
      <PublicPrayerRequestForm />
    </div>
  )
}
