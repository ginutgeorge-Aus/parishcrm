import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Membership form received",
  robots: { index: false },
}

export default function MembershipSuccessPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-foreground">Thank you</h1>
      <p className="mt-4 text-muted-foreground">
        Your membership registration form has been received. The parish office will review it and be in touch. There is
        nothing further you need to do.
      </p>
    </div>
  )
}
