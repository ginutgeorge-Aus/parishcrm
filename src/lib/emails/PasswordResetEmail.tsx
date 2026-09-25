// src/lib/emails/PasswordResetEmail.tsx
import * as React from "react"
import { Heading, Text, Button, Section } from "@react-email/components"
import { EmailLayout, emailButton } from "./EmailLayout"

export function PasswordResetEmail({ resetUrl, churchName }: { resetUrl: string; churchName: string }) {
  return (
    <EmailLayout churchName={churchName} previewText="Reset your password">
      <Heading as="h2">Password Reset</Heading>
      <Text>Click the button below to reset your password. This link expires in 1 hour.</Text>
      <Section style={{ margin: "16px 0" }}>
        <Button href={resetUrl} style={emailButton}>Reset Password</Button>
      </Section>
      <Text style={{ color: "#6b7280", fontSize: "13px" }}>Or copy this link: {resetUrl}</Text>
      <Text style={{ color: "#6b7280", fontSize: "13px" }}>If you did not request this, you can ignore this email.</Text>
    </EmailLayout>
  )
}
