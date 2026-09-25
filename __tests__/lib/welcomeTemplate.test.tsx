/** @jest-environment node */
import * as React from "react"
import { render } from "@react-email/render"
import { WelcomeEmail } from "@/lib/emails/WelcomeEmail"

const props = {
  setPasswordUrl: "https://app.example.com/reset-password?token=abc",
  helpUrl: "https://app.example.com/help",
  churchName: "Example Church",
  intro: "Hello Jane Doe,",
  body: "An account has been created for you (Office Admin). This link expires in 7 days.",
  signoff: "Log in securely and manage records.",
}

describe("WelcomeEmail", () => {
  it("renders set-password and help URLs in html and text", async () => {
    const html = await render(<WelcomeEmail {...props} />)
    const text = await render(<WelcomeEmail {...props} />, { plainText: true })
    expect(html).toContain(props.setPasswordUrl)
    expect(html).toContain(props.helpUrl)
    expect(text).toContain(props.setPasswordUrl)
    expect(text).toContain(props.helpUrl)
  })
  it("renders the role and expiry window supplied via slots", async () => {
    const html = await render(<WelcomeEmail {...props} />)
    expect(html).toContain("Office Admin")
    expect(html).toContain("7 days")
  })
  it("escapes script-y slot input (React auto-escape)", async () => {
    const html = await render(<WelcomeEmail {...props} intro={"<b>x</b>"} />)
    expect(html).not.toContain("<b>x</b>")
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
  })
})
