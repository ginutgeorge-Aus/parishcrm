/**
 * @jest-environment node
 */
// Node env (no jsdom `window`) so this reproduces real SSR: reading
// window.location.origin at render time throws here, exactly as on the server.
import { renderToStaticMarkup } from "react-dom/server"

// The component imports the server-action module; mock it so the test doesn't
// pull next-auth/prisma into the node runtime. We only exercise SSR here.
jest.mock("@/lib/actions/eventAccess", () => ({
  setVolunteerView: jest.fn(),
  regenerateVolunteerToken: jest.fn(),
}))

import { VolunteerViewToggle } from "@/components/events/VolunteerViewToggle"

describe("VolunteerViewToggle SSR safety", () => {
  // Regression: reading window.location.origin during render crashes SSR
  // ("window is not defined"), 500-ing the registrations page for editors.
  it("server-renders with a token without touching window", () => {
    const html = renderToStaticMarkup(
      <VolunteerViewToggle eventId={1} slug="picnic" initialToken="tok123" />,
    )
    expect(html).toContain("Volunteer view")
    // origin is empty on the server → relative link, no window access
    expect(html).toContain("/e/picnic/crew/tok123")
  })

  it("server-renders with no token (link hidden)", () => {
    const html = renderToStaticMarkup(
      <VolunteerViewToggle eventId={1} slug="picnic" initialToken={null} />,
    )
    expect(html).toContain("Turn on")
    expect(html).not.toContain("/crew/")
  })
})
