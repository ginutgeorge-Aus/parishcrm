// src/lib/emails/MembershipNotificationEmail.tsx
import * as React from "react"
import { Heading, Text, Button, Section } from "@react-email/components"
import { EmailLayout, emailButton } from "./EmailLayout"
import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"

export function MembershipNotificationEmail({
  applicantName,
  reviewUrl,
  churchName = DEFAULT_CHURCH_NAME,
}: {
  applicantName: string
  reviewUrl: string
  churchName?: string
}) {
  return (
    <EmailLayout churchName={churchName} previewText={`New membership application from ${applicantName}`}>
      <Heading as="h2">New membership application</Heading>
      <Text>
        <strong>{applicantName}</strong> submitted a membership registration form. Review it and approve into a family or reject.
      </Text>
      <Section style={{ textAlign: "center", margin: "24px 0" }}>
        <Button href={reviewUrl} style={emailButton}>Review application</Button>
      </Section>
      <Text style={{ color: "#6b7280", fontSize: "13px" }}>
        Details are private — open the CRM to view the full form.
      </Text>
    </EmailLayout>
  )
}
