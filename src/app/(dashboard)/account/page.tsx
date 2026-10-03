import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { listTrustedDevices } from "@/lib/actions/trustedDevice"
import { getTotpStatus } from "@/lib/actions/totp"
import { TrustedDeviceList } from "@/components/account/TrustedDeviceList"
import { TotpSettings } from "@/components/account/TotpSettings"
import { DemoNotice } from "@/components/DemoNotice"

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const [devices, totpStatus] = await Promise.all([listTrustedDevices(), getTotpStatus()])

  return (
    <div className="max-w-lg">
      <h2 className="text-2xl font-semibold text-foreground mb-2">My Account</h2>
      <DemoNotice />
      <h3 className="text-sm font-medium text-muted-foreground mt-6 mb-2">Authenticator app</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Use an authenticator app for your sign-in code instead of email. You can still get an emailed
        code if you don&apos;t have your phone.
      </p>
      <TotpSettings status={totpStatus} />
      <h3 className="text-sm font-medium text-muted-foreground mt-6 mb-2">Trusted devices</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Devices where you chose &ldquo;Remember this device&rdquo; skip the sign-in code for 14 days.
        Revoke any you don&apos;t recognise.
      </p>
      <TrustedDeviceList devices={devices} />
    </div>
  )
}
