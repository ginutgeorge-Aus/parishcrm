import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { listTrustedDevices } from "@/lib/actions/trustedDevice"
import { TrustedDeviceList } from "@/components/account/TrustedDeviceList"

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const devices = await listTrustedDevices()

  return (
    <div className="max-w-lg">
      <h2 className="text-2xl font-semibold text-foreground mb-2">My Account</h2>
      <h3 className="text-sm font-medium text-muted-foreground mt-6 mb-2">Trusted devices</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Devices where you chose &ldquo;Remember this device&rdquo; skip the email code for 14 days.
        Revoke any you don&apos;t recognise.
      </p>
      <TrustedDeviceList devices={devices} />
    </div>
  )
}
