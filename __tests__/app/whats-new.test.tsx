/** @jest-environment node */
import WhatsNewPage from "@/app/(dashboard)/whats-new/page"
import { WHATS_NEW } from "@/lib/whatsNew"

describe("/whats-new page", () => {
  it("renders an entry per version with its highlights", async () => {
    const el = (await WhatsNewPage()) as React.ReactElement
    const text = JSON.stringify(el)
    for (const e of WHATS_NEW) {
      expect(text).toContain(e.version)
      expect(text).toContain(e.highlights[0])
    }
  })
})
