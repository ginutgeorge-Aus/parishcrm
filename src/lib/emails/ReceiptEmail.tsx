import * as React from "react"
import { Html, Head, Body, Container, Section, Row, Column, Text, Hr } from "@react-email/components"
import { PRIMARY_HEX } from "@/lib/theme/palette"

export type ReceiptData = {
  transactionId: number
  date: string
  description: string
  amount: string
  type: "INCOME" | "EXPENSE"
  account: string
  reference?: string
  notes?: string
  familyName?: string
  personName?: string
  churchName: string
  churchAddress: string
  churchAbn: string
  churchEmail: string
}

const detail = (label: string, value: string) => (
  <Row key={label}>
    <Column style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9", fontSize: "14px", color: "#64748b", width: "38%", verticalAlign: "top" }}>{label}</Column>
    <Column style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9", fontSize: "14px", fontWeight: 500, color: PRIMARY_HEX, verticalAlign: "top" }}>{value}</Column>
  </Row>
)

export function ReceiptEmail({ data, intro, signoff }: { data: ReceiptData; intro: string; signoff: string }) {
  const amountColor = data.type === "INCOME" ? "#16a34a" : "#dc2626"
  const typeLabel = data.type === "INCOME" ? "Income" : "Expense"
  return (
    <Html lang="en">
      <Head />
      <Body style={{ margin: 0, padding: "32px 16px", background: "#f8fafc", fontFamily: "Arial, sans-serif" }}>
        <Container style={{ maxWidth: "560px", background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <Section style={{ background: PRIMARY_HEX, padding: "24px 28px" }}>
            <Text style={{ fontSize: "18px", fontWeight: "bold", color: "#ffffff", margin: 0 }}>{data.churchName}</Text>
            <Text style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0" }}>Official Receipt</Text>
          </Section>
          <Section style={{ background: "#f8fafc", padding: "10px 28px", borderBottom: "1px solid #e2e8f0" }}>
            <Text style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>Receipt #{data.transactionId} · {data.date}</Text>
          </Section>
          {intro ? (
            <Section style={{ padding: "16px 28px 0" }}>
              <Text style={{ fontSize: "14px", color: "#334155", margin: 0, whiteSpace: "pre-line" }}>{intro}</Text>
            </Section>
          ) : null}
          <Section style={{ padding: "28px 28px 8px" }}>
            <Text style={{ fontSize: "36px", fontWeight: "bold", color: amountColor, lineHeight: 1, margin: 0 }}>{data.amount}</Text>
            <Text style={{ fontSize: "12px", color: "#64748b", margin: "6px 0 0", textTransform: "uppercase", letterSpacing: "0.5px" }}>{typeLabel}</Text>
          </Section>
          <Section style={{ padding: "8px 28px 24px" }}>
            {detail("Description", data.description)}
            {detail("Account", data.account)}
            {data.reference ? detail("Reference", data.reference) : null}
            {data.familyName ? detail("Family", data.familyName) : null}
            {data.personName ? detail("Person", data.personName) : null}
            {data.notes ? detail("Notes", data.notes) : null}
          </Section>
          <Hr />
          <Section style={{ background: "#f8fafc", padding: "16px 28px" }}>
            <Text style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
              {data.churchName} · ABN {data.churchAbn}<br />
              {data.churchAddress}<br />
              {data.churchEmail}<br />
              <span style={{ whiteSpace: "pre-line" }}>{signoff}</span>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
