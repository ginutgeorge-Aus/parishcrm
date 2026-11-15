import * as React from "react"
import { Heading, Text, Section, Button } from "@react-email/components"
import { EmailLayout } from "@/lib/emails/EmailLayout"
import { PRIMARY_DARK_HEX } from "@/lib/theme/palette"

/** Data for one fundraiser payment reminder. Money fields are pre-formatted display strings. */
export type FundraiserReminderData = {
  churchName: string
  eventTitle: string
  name: string
  quantity: number
  unitLabel: string
  unitPrice: string
  owed: string
  paid: string
  remaining: string
  /** Pay-online link; null when online payment is off or Stripe is unconfigured. */
  payUrl: string | null
  /** Card fee shown beside the pay link when the church passes it on; else null. */
  cardFee: string | null
  /** Church bank/payment instructions (free text, may be multi-line); null or blank omits the bank-transfer section. */
  bankDetails: string | null
  /** Reference the payer must quote on a bank transfer (shown only with bank details). */
  bankRef: string
}

const label = { fontSize: "13px", color: "#64748b", margin: "0" } as const
const value = { fontSize: "14px", color: "#0f172a", margin: "0 0 8px", fontWeight: 600 } as const
const body = { fontSize: "14px", color: "#334155" } as const

/**
 * Reminder email for an unpaid or part-paid fundraiser entry: what is owed,
 * how to pay online (when enabled) and by bank transfer with the entry's reference
 * (only when bank details are set).
 * @param props - Reminder data.
 */
export function FundraiserReminderEmail(props: Readonly<FundraiserReminderData>) {
  const bankDetails = props.bankDetails?.trim() ?? ""
  return (
    <EmailLayout previewText={`Payment reminder: ${props.eventTitle}`} churchName={props.churchName}>
      <Heading as="h2" style={{ fontSize: "20px", color: "#0f172a" }}>
        Payment reminder — {props.eventTitle}
      </Heading>
      <Text style={body}>Hi {props.name},</Text>
      <Text style={body}>
        This is a friendly reminder about your payment for {props.quantity} × {props.unitLabel} at {props.unitPrice} each.
      </Text>
      <Section>
        <Text style={label}>Total</Text>
        <Text style={value}>{props.owed}</Text>
        <Text style={label}>Paid so far</Text>
        <Text style={value}>{props.paid}</Text>
        <Text style={label}>Still to pay</Text>
        <Text style={value}>{props.remaining}</Text>
      </Section>
      {props.payUrl && (
        <Section style={{ marginTop: "8px" }}>
          <Text style={body}>You can pay by card online:</Text>
          <Button
            href={props.payUrl}
            style={{ background: PRIMARY_DARK_HEX, color: "#fff", padding: "10px 16px", borderRadius: "6px", fontSize: "14px" }}
          >
            Pay online
          </Button>
          {props.cardFee && (
            <Text style={{ fontSize: "12px", color: "#64748b" }}>A card processing fee of {props.cardFee} applies to online payments.</Text>
          )}
        </Section>
      )}
      {bankDetails && (
        <Section style={{ marginTop: "16px" }}>
          <Text style={body}>Or pay by bank transfer:</Text>
          {bankDetails.split(/\n+/).filter(Boolean).map((line, i) => (
            <Text key={i} style={{ fontSize: "14px", color: "#334155", margin: "0" }}>{line}</Text>
          ))}
          <Text style={{ ...body, marginTop: "8px" }}>
            Please use this reference: <strong>{props.bankRef}</strong>
          </Text>
        </Section>
      )}
    </EmailLayout>
  )
}
