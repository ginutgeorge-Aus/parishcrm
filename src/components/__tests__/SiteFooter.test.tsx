import { render } from "@testing-library/react"
import { SiteFooter } from "@/components/SiteFooter"

test("footer copyright uses the passed church name", () => {
  const { container } = render(<SiteFooter churchName="Demo Church" />)
  expect(container.textContent).toContain("Demo Church")
  expect(container.textContent).not.toMatch(/St\.? Mark/i)
})
