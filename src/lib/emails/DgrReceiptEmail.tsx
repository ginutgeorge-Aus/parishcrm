// src/lib/emails/DgrReceiptEmail.tsx
import * as React from "react"
import { Html, Head, Preview, Body, Container, Section, Text, Hr } from "@react-email/components"
import { PRIMARY_HEX } from "@/lib/theme/palette"

export function DgrReceiptEmail({
  churchName,
  churchAbn,
  churchAddress,
  churchEmail,
  receiptNo,
  fyLabel,
  issueDate,
  documentTitle,
  totalLabel,
  totalDonationsLabel,
  coveredPeriod,
  intro,
  body,
  signoff,
}: {
  churchName: string
  churchAbn: string
  churchAddress: string
  churchEmail: string
  receiptNo: string
  fyLabel: string
  issueDate: string
  documentTitle: string
  totalLabel: string
  totalDonationsLabel: string
  coveredPeriod: string
  intro: string
  body: string
  signoff: string
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your annual tax-deductible donation receipt is attached</Preview>
      <Body style={{ margin: 0, padding: "32px 16px", background: "#f8fafc", fontFamily: "Arial, sans-serif" }}>
        <Container style={{ maxWidth: "560px", background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <Section style={{ background: PRIMARY_HEX, padding: "24px 28px" }}>
            <Text style={{ fontSize: "18px", fontWeight: "bold", color: "#ffffff", margin: 0 }}>{churchName}</Text>
            <Text style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0" }}>{documentTitle}</Text>
          </Section>
          <Section style={{ background: "#f8fafc", padding: "10px 28px", borderBottom: "1px solid #e2e8f0" }}>
            <Text style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>Receipt {receiptNo} · FY {fyLabel} · Issued {issueDate}</Text>
          </Section>
          <Section style={{ padding: "16px 28px 0" }}>
            <Text style={{ fontSize: "14px", color: "#334155", margin: 0, whiteSpace: "pre-line" }}>{intro}</Text>
          </Section>
          <Section style={{ padding: "20px 28px 8px" }}>
            <Text style={{ fontSize: "36px", fontWeight: "bold", color: "#16a34a", lineHeight: 1, margin: 0 }}>{totalLabel}</Text>
            <Text style={{ fontSize: "12px", color: "#64748b", margin: "6px 0 0", textTransform: "uppercase", letterSpacing: "0.5px" }}>{totalDonationsLabel}</Text>
          </Section>
          <Section style={{ padding: "8px 28px 4px" }}>
            <Text style={{ fontSize: "14px", color: "#334155", margin: 0, whiteSpace: "pre-line" }}>{body}</Text>
            <Text style={{ fontSize: "13px", color: "#64748b", margin: "12px 0 0" }}>{coveredPeriod}</Text>
          </Section>
          <Hr />
          <Section style={{ background: "#f8fafc", padding: "16px 28px" }}>
            <Text style={{ fontSize: "11px", color: "#334155", lineHeight: 1.6, margin: 0 }}>
              {churchName} · ABN {churchAbn}<br />
              {churchAddress}<br />
              {churchEmail}<br />
              <span style={{ whiteSpace: "pre-line" }}>{signoff}</span>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
