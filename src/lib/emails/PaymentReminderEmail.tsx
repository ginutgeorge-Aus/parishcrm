import * as React from "react"
import { Heading, Text, Section, Button } from "@react-email/components"
import { EmailLayout } from "@/lib/emails/EmailLayout"
import { PRIMARY_DARK_HEX } from "@/lib/theme/palette"

export type PaymentReminderData = {
  churchName: string
  eventTitle: string
  recipientName: string
  amountDue: string
  message: string
  eventUrl: string
}

const label = { fontSize: "13px", color: "#64748b", margin: "0" } as const
const value = { fontSize: "14px", color: "#0f172a", margin: "0 0 8px", fontWeight: 600 } as const

export function PaymentReminderEmail(props: PaymentReminderData) {
  return (
    <EmailLayout previewText={`Payment pending: ${props.eventTitle}`} churchName={props.churchName}>
      <Heading as="h2" style={{ fontSize: "20px", color: "#0f172a" }}>
        Payment pending — {props.eventTitle}
      </Heading>
      <Text style={{ fontSize: "14px", color: "#334155" }}>Hi {props.recipientName},</Text>
      {/* Operator's editable message. Rendered as its own paragraph — never merged
          into template slots, and split on blank lines so multi-paragraph text
          keeps its breaks. */}
      {props.message.split(/\n{2,}/).map((para, i) => (
        <Text key={i} style={{ fontSize: "14px", color: "#334155", whiteSpace: "pre-line" }}>
          {para}
        </Text>
      ))}
      <Section>
        <Text style={label}>Amount due</Text>
        <Text style={value}>{props.amountDue}</Text>
      </Section>
      <Section style={{ marginTop: "16px" }}>
        <Button
          href={props.eventUrl}
          style={{ background: PRIMARY_DARK_HEX, color: "#fff", padding: "10px 16px", borderRadius: "6px", fontSize: "14px" }}
        >
          View event &amp; pay
        </Button>
      </Section>
    </EmailLayout>
  )
}
