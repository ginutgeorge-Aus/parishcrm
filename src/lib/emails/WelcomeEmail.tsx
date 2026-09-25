// src/lib/emails/WelcomeEmail.tsx
import * as React from "react"
import { Heading, Text, Button, Link, Section } from "@react-email/components"
import { EmailLayout, emailButton } from "./EmailLayout"

export function WelcomeEmail({
  setPasswordUrl,
  helpUrl,
  churchName,
  intro,
  body,
  signoff,
}: {
  setPasswordUrl: string
  helpUrl: string
  churchName: string
  intro: string
  body: string
  signoff: string
}) {
  return (
    <EmailLayout churchName={churchName} previewText={`Welcome to ${churchName} — set your password`}>
      <Heading as="h2">Welcome to {churchName}</Heading>
      <Text style={{ whiteSpace: "pre-line" }}>{intro}</Text>
      <Text style={{ whiteSpace: "pre-line" }}>{body}</Text>
      <Section style={{ margin: "16px 0" }}>
        <Button href={setPasswordUrl} style={emailButton}>Set your password</Button>
      </Section>
      <Text style={{ color: "#6b7280", fontSize: "13px" }}>Or copy this link: {setPasswordUrl}</Text>
      <Text style={{ whiteSpace: "pre-line" }}>{signoff}</Text>
      <Text>Full guide: <Link href={helpUrl}>{helpUrl}</Link></Text>
      <Text style={{ color: "#6b7280", fontSize: "13px" }}>
        If the link expires, ask an administrator to resend it, or use &ldquo;Forgot password&rdquo; on the login page.
      </Text>
    </EmailLayout>
  )
}
