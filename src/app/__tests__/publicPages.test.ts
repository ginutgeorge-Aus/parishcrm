import { render } from "@testing-library/react"

jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({
    name: "Demo Church", address: "", abn: "", email: "admin@demo.example.com", website: "",
  }),
}))

import PrivacyPage from "@/app/(public)/privacy/page"

test("privacy page renders configured church name + contact email", async () => {
  const ui = await PrivacyPage()
  const { container } = render(ui)
  expect(container.textContent).toContain("Demo Church")
  expect(container.textContent).toContain("admin@demo.example.com")
  expect(container.textContent).not.toMatch(/Your Church/i)
})

test("privacy page discloses the third-party processors public visitors reach", async () => {
  const ui = await PrivacyPage()
  const { container } = render(ui)
  expect(container.textContent).toContain("Cloudflare Turnstile")
  expect(container.textContent).toContain("Stripe")
  expect(container.textContent).not.toMatch(/do not sell or share your personal information with third parties except\s+as required by law\./)
})
