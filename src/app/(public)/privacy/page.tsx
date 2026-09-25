import type { Metadata } from "next"
import { getChurchSettings } from "@/lib/churchSettings"

export const metadata: Metadata = { title: "Privacy Policy" }

export default async function PrivacyPage() {
  const { name: churchName, email: churchEmail } = await getChurchSettings()
  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold text-foreground mb-1">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground mb-6">Last updated: 24 September 2026</p>

      <section className="space-y-4 text-muted-foreground text-sm leading-relaxed">
        <p>
          <strong>{churchName}</strong> collects and holds personal information to manage
          church membership, events, and communications. This policy explains how we handle
          that information in accordance with the <em>Privacy Act 1988</em> (Cth) and the
          Australian Privacy Principles (APPs).
        </p>

        <h2 className="font-semibold text-foreground mt-6">What we collect</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Name, contact details (email, phone, address)</li>
          <li>Event registration information</li>
          <li>Financial giving records (for PAYG summaries and receipts)</li>
          <li>Pastoral and membership notes (staff access only)</li>
        </ul>

        <h2 className="font-semibold text-foreground mt-6">How we use it</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Managing membership and pastoral care</li>
          <li>Processing event registrations</li>
          <li>Sending giving receipts and church communications (with your consent)</li>
          <li>Financial record-keeping as required by the ATO</li>
        </ul>

        <h2 className="font-semibold text-foreground mt-6">Disclosure</h2>
        <p>
          We do not sell your personal information. We share it only as required by law,
          or with service providers that process it on our behalf to run this system:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Cloudflare Turnstile</strong> — spam and bot protection on public forms
            (membership, event registration, feedback). Your browser loads a Cloudflare
            script that receives technical data such as your IP address and browser
            details to tell people from bots.
          </li>
          <li>
            <strong>Stripe</strong> — card payment processing when you pay for an event by
            card. Your card details go directly to Stripe and are never stored by us.
          </li>
          <li>Our hosting and email delivery providers, which store and transmit the data.</li>
        </ul>

        <h2 className="font-semibold text-foreground mt-6">Data security</h2>
        <p>
          Sensitive personal information is encrypted at rest using AES-256-GCM. Access to
          member records is restricted to authorised church staff on a role-based basis, and
          all access is logged.
        </p>

        <h2 className="font-semibold text-foreground mt-6">Cookies</h2>
        <p>
          We use a single session cookie to keep authorised staff logged in. We do not use
          tracking, advertising, or third-party analytics cookies. The Cloudflare Turnstile
          check on public forms may use its own strictly necessary storage to perform the
          bot check.
        </p>

        <h2 className="font-semibold text-foreground mt-6">Retention</h2>
        <p>
          We keep personal information only as long as it is needed. Event
          registration details (name, contact details and any answers you provide)
          are automatically anonymised six months after the event has finished —
          only the aggregate numbers needed for financial record-keeping are
          retained beyond that. Financial giving records are held for the minimum
          seven years required by the ATO.
        </p>

        <h2 className="font-semibold text-foreground mt-6">Access and correction</h2>
        <p>
          You may request access to or correction of your personal information by contacting
          the church office. You may also request deletion of your records subject to our
          legal record-keeping obligations (minimum 7 years for financial records under ATO
          requirements).
        </p>

        <h2 className="font-semibold text-foreground mt-6">Contact</h2>
        <p>
          {churchEmail ? (
            <>
              For privacy enquiries, contact the church office at{" "}
              <a
                href={`mailto:${churchEmail}`}
                className="underline hover:text-foreground"
              >
                {churchEmail}
              </a>
              .{" "}
            </>
          ) : (
            <>For privacy enquiries, contact the church office. </>
          )}
          This policy may be updated from time to time.
        </p>
      </section>
    </div>
  )
}
