// src/lib/emails/EmailLayout.tsx
import * as React from "react"
import { Html, Head, Preview, Body, Container, Section, Text } from "@react-email/components"

export const emailButton = {
  display: "inline-block",
  padding: "10px 20px",
  minHeight: "44px",
  lineHeight: "1.5",
  background: "#16a34a",
  color: "#ffffff",
  borderRadius: "0px",
  textDecoration: "none",
} as const

const body = { margin: 0, padding: "24px 0", background: "#f8fafc", fontFamily: "Arial, sans-serif" } as const
const container = { maxWidth: "560px", margin: "0 auto", background: "#ffffff", borderRadius: "0px", border: "1px solid #e2e8f0", padding: "24px 28px" } as const
const footer = { fontSize: "11px", color: "#94a3b8", lineHeight: "1.6", marginTop: "24px" } as const

export function EmailLayout({
  children,
  previewText,
  churchName,
}: {
  children: React.ReactNode
  previewText?: string
  churchName: string
}) {
  return (
    <Html lang="en">
      <Head />
      {previewText ? <Preview>{previewText}</Preview> : null}
      <Body style={body}>
        <Container style={container}>
          {children}
          <Section>
            <Text style={footer}>{churchName}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
