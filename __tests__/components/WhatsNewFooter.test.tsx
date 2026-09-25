import { render, screen } from "@testing-library/react"
import { WhatsNewFooter } from "@/components/dashboard/WhatsNewFooter"

const ORIG = process.env.NEXT_PUBLIC_APP_VERSION
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_VERSION = ORIG
})

describe("WhatsNewFooter", () => {
  it("shows the version + highlights + history link on a version match", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.10.0"
    render(<WhatsNewFooter />)
    expect(screen.getByText(/v1\.10\.0/)).toBeInTheDocument()
    expect(screen.getByText(/Annual giving summary report/)).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /see all updates/i })
    expect(link).toHaveAttribute("href", "/whats-new")
  })

  it("shows only the history link (no highlights) when version has no entry", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "dev"
    render(<WhatsNewFooter />)
    expect(screen.getByRole("link", { name: /see all updates/i })).toHaveAttribute("href", "/whats-new")
    expect(screen.queryByText(/Annual giving summary report/)).not.toBeInTheDocument()
  })
})
