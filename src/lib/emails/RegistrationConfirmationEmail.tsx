import * as React from "react"
import { Heading, Text, Section, Button, Hr } from "@react-email/components"
import { EmailLayout, emailButton } from "@/lib/emails/EmailLayout"
import type { Organizer } from "@/lib/eventOrganizers"

export type RegistrationConfirmationData = {
  churchName: string
  eventTitle: string
  eventDateLabel?: string
  eventLocation?: string
  registrantName: string
  items: { quantity: number; ticketName: string; attendeeNames: string[] }[]
  totalLabel: string
  waivedCount?: number
  payment?: { bankBsb?: string | null; bankAccount?: string | null; reference: string }
  googleCalendarUrl?: string
  organizers?: Organizer[]
}

const label = { fontSize: "13px", color: "#64748b", margin: "0" } as const
const value = { fontSize: "14px", color: "#0f172a", margin: "0 0 8px", fontWeight: 600 } as const

function PaymentDetails({
  churchName,
  payment,
}: Readonly<{
  churchName: string
  payment: NonNullable<RegistrationConfirmationData["payment"]>
}>) {
  return (
    <Section style={{ background: "#f8fafc", borderRadius: "8px", padding: "16px", marginTop: "12px" }}>
      <Text style={{ ...label, fontWeight: 700, textTransform: "uppercase" }}>
        Bank transfer details
      </Text>
      <Text style={label}>Account name</Text>
      <Text style={value}>{churchName}</Text>
      {payment.bankBsb ? (
        <>
          <Text style={label}>BSB</Text>
          <Text style={value}>{payment.bankBsb}</Text>
        </>
      ) : null}
      {payment.bankAccount ? (
        <>
          <Text style={label}>Account number</Text>
          <Text style={value}>{payment.bankAccount}</Text>
        </>
      ) : null}
      <Text style={label}>Reference</Text>
      <Text style={{ ...value, color: "#16a34a" }}>{payment.reference}</Text>
      <Text style={{ fontSize: "12px", color: "#94a3b8", marginTop: "8px" }}>
        Your spot is held for 7 days pending payment.
      </Text>
    </Section>
  )
}

function OrganizerList({ organizers }: Readonly<{ organizers: Organizer[] }>) {
  return (
    <Section style={{ marginTop: "16px" }}>
      <Text style={{ ...label, fontWeight: 700, textTransform: "uppercase" }}>
        {organizers.length === 1 ? "Organiser" : "Organisers"}
      </Text>
      {organizers.map((o, i) => (
        <Text key={i} style={{ ...value, marginBottom: "4px" }}>
          {o.name}
          {o.phone ? (
            <span style={{ fontWeight: 400, color: "#64748b" }}> — {o.phone}</span>
          ) : null}
        </Text>
      ))}
    </Section>
  )
}

export function RegistrationConfirmationEmail(props: RegistrationConfirmationData) {
  const { payment, organizers } = props
  return (
    <EmailLayout
      previewText={`You're registered for ${props.eventTitle}`}
      churchName={props.churchName}
    >
      <Heading as="h2" style={{ fontSize: "20px", color: "#0f172a" }}>
        You&apos;re registered!
      </Heading>
      <Text style={{ fontSize: "14px", color: "#334155" }}>
        Hi {props.registrantName}, thanks for registering for{" "}
        <strong>{props.eventTitle}</strong>.
      </Text>

      {props.eventDateLabel ? (
        <Section>
          <Text style={label}>When</Text>
          <Text style={value}>{props.eventDateLabel}</Text>
        </Section>
      ) : null}
      {props.eventLocation ? (
        <Section>
          <Text style={label}>Where</Text>
          <Text style={value}>{props.eventLocation}</Text>
        </Section>
      ) : null}

      <Hr />
      <Section>
        {props.items.map((it, i) => (
          <Text key={i} style={{ fontSize: "14px", color: "#334155", margin: "0 0 4px" }}>
            {it.quantity}× {it.ticketName}
            {it.attendeeNames.length > 0 ? ` — ${it.attendeeNames.join(", ")}` : ""}
          </Text>
        ))}
        <Text style={{ fontSize: "15px", color: "#0f172a", fontWeight: 700, marginTop: "8px" }}>
          Total: {props.totalLabel}
        </Text>
        {props.waivedCount && props.waivedCount > 0 ? (
          <Text style={{ fontSize: "13px", color: "#15803d", margin: "4px 0 0" }}>
            Family waiver applied — {props.waivedCount} member{props.waivedCount === 1 ? "" : "s"} free.
          </Text>
        ) : null}
      </Section>

      {payment ? <PaymentDetails churchName={props.churchName} payment={payment} /> : null}

      {organizers && organizers.length > 0 ? <OrganizerList organizers={organizers} /> : null}

      {props.googleCalendarUrl ? (
        <Section style={{ marginTop: "16px" }}>
          <Button href={props.googleCalendarUrl} style={emailButton}>
            Add to Google Calendar
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  )
}
