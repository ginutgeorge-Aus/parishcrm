// src/lib/emails/GivingStatementEmail.tsx
import * as React from "react"
import { Html, Head, Preview, Body, Container, Section, Text, Hr } from "@react-email/components"
import { PRIMARY_HEX } from "@/lib/theme/palette"

export type GivingStatementEmailData = {
  churchName: string
  churchAbn: string
  churchAddress: string
  churchEmail: string
  familyName: string
  fyLabel: string
  periodLabel: string
  totalLabel: string
}

/** Branded covering email for the annual giving statement PDF attachment. */
export function GivingStatementEmail({ data }: Readonly<{ data: GivingStatementEmailData }>) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your annual giving statement is attached</Preview>
      <Body style={{ margin: 0, padding: "32px 16px", background: "#f8fafc", fontFamily: "Arial, sans-serif" }}>
        <Container style={{ maxWidth: "560px", background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <Section style={{ background: PRIMARY_HEX, padding: "24px 28px" }}>
            <Text style={{ fontSize: "18px", fontWeight: "bold", color: "#ffffff", margin: 0 }}>{data.churchName}</Text>
            <Text style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0" }}>Annual giving statement · FY {data.fyLabel}</Text>
          </Section>
          <Section style={{ padding: "16px 28px 0" }}>
            <Text style={{ fontSize: "14px", color: "#334155", margin: 0 }}>Dear {data.familyName},</Text>
            <Text style={{ fontSize: "14px", color: "#334155", margin: "12px 0 0" }}>
              Thank you for your generous support. Attached is your giving statement for {data.periodLabel}.
            </Text>
          </Section>
          <Section style={{ padding: "16px 28px 8px" }}>
            <Text style={{ fontSize: "36px", fontWeight: "bold", color: "#16a34a", lineHeight: 1, margin: 0 }}>{data.totalLabel}</Text>
            <Text style={{ fontSize: "12px", color: "#64748b", margin: "6px 0 0", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total given</Text>
          </Section>
          <Section style={{ padding: "8px 28px 4px" }}>
            <Text style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              This is a summary of gifts recorded in our books, not a tax receipt.
            </Text>
          </Section>
          <Hr />
          <Section style={{ background: "#f8fafc", padding: "16px 28px" }}>
            <Text style={{ fontSize: "11px", color: "#334155", lineHeight: 1.6, margin: 0 }}>
              {data.churchName}{data.churchAbn ? ` · ABN ${data.churchAbn}` : ""}<br />
              {data.churchAddress}<br />
              {data.churchEmail}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
