/** @jest-environment node */
import { render } from "@react-email/render"
import { MembershipNotificationEmail } from "@/lib/emails/MembershipNotificationEmail"

describe("MembershipNotificationEmail", () => {
  it("renders applicant name and a review link", async () => {
    const html = await render(
      <MembershipNotificationEmail applicantName="John Miller" reviewUrl="https://app/memberships" />
    )
    expect(html).toContain("John Miller")
    expect(html).toContain("https://app/memberships")
  })
})
