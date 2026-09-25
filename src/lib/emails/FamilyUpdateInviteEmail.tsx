// src/lib/emails/FamilyUpdateInviteEmail.tsx
import * as React from "react"
import { Heading, Text, Button, Section } from "@react-email/components"
import { EmailLayout, emailButton } from "./EmailLayout"

export function FamilyUpdateInviteEmail({
  updateUrl,
  churchName,
  intro,
  body,
  signoff,
}: {
  updateUrl: string
  churchName: string
  intro: string
  body: string
  signoff: string
}) {
  return (
    <EmailLayout churchName={churchName} previewText="Update your family details">
      <Heading as="h2">Update your family details</Heading>
      <Text style={{ whiteSpace: "pre-line" }}>{intro}</Text>
      <Text style={{ whiteSpace: "pre-line" }}>{body}</Text>
      <Section style={{ margin: "16px 0" }}>
        <Button href={updateUrl} style={emailButton}>Update details</Button>
      </Section>
      <Text style={{ color: "#6b7280", fontSize: "13px" }}>Or copy this link: {updateUrl}</Text>
      <Text style={{ color: "#6b7280", fontSize: "13px", whiteSpace: "pre-line" }}>{signoff}</Text>
    </EmailLayout>
  )
}
