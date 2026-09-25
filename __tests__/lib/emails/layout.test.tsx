/**
 * @jest-environment node
 */
import * as React from "react"
import { render } from "@react-email/render"
import { EmailLayout } from "@/lib/emails/EmailLayout"
import { Text } from "@react-email/components"

it("renders an EmailLayout to HTML containing children + church name", async () => {
  const html = await render(
    <EmailLayout churchName="Example Church"><Text>Hello body</Text></EmailLayout>
  )
  expect(html).toMatch(/^<!DOCTYPE html/)
  expect(html).toContain("Hello body")
  expect(html).toContain("Example Church")
})

it("produces a plain-text variant", async () => {
  const text = await render(
    <EmailLayout churchName="Example Church"><Text>Hello body</Text></EmailLayout>,
    { plainText: true }
  )
  expect(text).toContain("Hello body")
})
