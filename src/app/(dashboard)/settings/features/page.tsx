import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { readRawOverrides } from "@/lib/featureFlags"
import { FeaturesForm } from "@/components/settings/FeaturesForm"
import { DemoNotice } from "@/components/DemoNotice"

export const dynamic = "force-dynamic"

type Props = Readonly<{ searchParams: Promise<{ welcome?: string }> }>

/** Settings → Features: ADMIN picks which features this church uses. */
export default async function FeaturesPage({ searchParams }: Props) {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")
  const [{ welcome }, initial] = await Promise.all([searchParams, readRawOverrides()])
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-semibold text-foreground mb-6">Features</h2>
      <DemoNotice />
      <FeaturesForm initial={initial} welcome={welcome === "1"} />
    </div>
  )
}
