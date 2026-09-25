import { auth } from "@/auth"
import { canViewAccounting, canEdit } from "@/lib/roleGuard"

export const metadata = { title: "Help & Getting Started" }

export default async function HelpPage() {
  const session = await auth()
  const role = session?.user?.role
  const showContent = canEdit(role)
  const showAccounting = canViewAccounting(role)

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-2xl font-semibold text-foreground">Help &amp; Getting Started</h2>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Login &amp; password</h3>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>Log in with your email. On a new device you&apos;ll get a one-time code by email.</li>
          <li>Tick &ldquo;Remember this device&rdquo; to skip the code for 14 days on that device.</li>
          <li>Forgot your password? Use &ldquo;Forgot password&rdquo; on the login page.</li>
          <li>Manage your trusted devices and sign-outs from your account page.</li>
        </ul>
      </section>

      {showContent && (
        <section className="space-y-2">
          <h3 className="text-lg font-medium">People &amp; Families</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>Add a family from Families &rarr; &ldquo;New family&rdquo;, then add members to it.</li>
            <li>Edit a family or person from their detail page.</li>
            <li>You can email a family a secure self-update link to confirm their own details.</li>
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Feedback &amp; bug reports</h3>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>Use the &ldquo;Feedback&rdquo; button in the sidebar — choose Bug, Feature, or Idea.</li>
          <li>Track what you&apos;ve sent and its status (Open / Resolved / Won&apos;t-fix) under &ldquo;My Reports&rdquo;.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Events</h3>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>Browse events in the Events section.</li>
          {showContent && <li>Create events and manage registrations.</li>}
        </ul>
      </section>

      {showAccounting && (
        <section className="space-y-2">
          <h3 className="text-lg font-medium">Accounting</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>View transactions and financial reports from the Accounting section (entry depends on your role).</li>
          </ul>
        </section>
      )}
    </div>
  )
}
