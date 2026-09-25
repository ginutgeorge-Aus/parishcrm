// src/lib/emails/WelcomeLetterEmail.tsx
import * as React from "react"
import { Heading, Text } from "@react-email/components"
import { EmailLayout } from "./EmailLayout"

export function WelcomeLetterEmail({
  greetingName,
  churchName,
}: {
  greetingName: string
  churchName: string
}) {
  return (
    <EmailLayout churchName={churchName} previewText={`Welcome to ${churchName}`}>
      <Heading as="h2">Welcome to {churchName}</Heading>
      <Text>Dear {greetingName} and Family,</Text>
      <Text>
        Warm greetings in the name of our Lord and Saviour Jesus Christ. Please find your
        welcome letter attached as a PDF. We look forward to welcoming you into our parish family.
      </Text>
      <Text>
        Yours in Christ,
        <br />
        {churchName}
      </Text>
    </EmailLayout>
  )
}
