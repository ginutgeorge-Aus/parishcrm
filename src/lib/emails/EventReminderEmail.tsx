import * as React from "react"
import { Heading, Text, Section } from "@react-email/components"
import { EmailLayout } from "@/lib/emails/EmailLayout"
import type { Organizer } from "@/lib/eventOrganizers"

export type EventReminderData = {
  churchName: string
  firstName: string
  eventTitle: string
  eventDateLabel?: string
  eventLocation?: string
  organizers?: Organizer[]
}

const label = { fontSize: "13px", color: "#64748b", margin: "0" } as const
const value = { fontSize: "14px", color: "#0f172a", margin: "0 0 8px", fontWeight: 600 } as const

export function EventReminderEmail(props: EventReminderData) {
  return (
    <EmailLayout previewText={`Reminder: ${props.eventTitle}`} churchName={props.churchName}>
      <Heading as="h2" style={{ fontSize: "20px", color: "#0f172a" }}>
        Event reminder
      </Heading>
      <Text style={{ fontSize: "14px", color: "#334155" }}>
        Hi {props.firstName}, this is a reminder that you&apos;re registered for{" "}
        <strong>{props.eventTitle}</strong>. We look forward to seeing you.
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
      {props.organizers && props.organizers.length > 0 ? (
        <Section>
          <Text style={label}>{props.organizers.length === 1 ? "Organiser" : "Organisers"}</Text>
          {props.organizers.map((o, i) => (
            <Text key={i} style={{ ...value, marginBottom: "4px" }}>
              {o.name}
              {o.phone ? (
                <span style={{ fontWeight: 400, color: "#64748b" }}> — {o.phone}</span>
              ) : null}
            </Text>
          ))}
        </Section>
      ) : null}
    </EmailLayout>
  )
}
