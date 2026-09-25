/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { ActivityFeed } from "@/components/settings/ActivityFeed"

// Frozen reference so relative-time rendering is deterministic — was real
// `new Date()`, which made "x ago" output flake across the minute boundary.
const NOW = new Date("2026-06-01T12:00:00Z")
const fiveMinAgo = new Date(NOW.getTime() - 5 * 60_000)
const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60_000)

const auditEntries = [
  {
    id: 1,
    action: "USER_CREATED",
    resourceType: "User",
    resourceId: 42,
    createdAt: fiveMinAgo,
    user: { name: "Admin User" },
  },
]

const registrations = [
  {
    id: 1,
    firstName: "John",
    lastName: "Smith",
    createdAt: twoHoursAgo,
    event: { title: "Easter Service" },
  },
]

describe("ActivityFeed", () => {
  // Freeze the clock to NOW so the component's internal relative-time math
  // matches the frozen prop timestamps above.
  beforeEach(() => jest.useFakeTimers({ now: NOW }))
  afterEach(() => jest.useRealTimers())

  it("shows System Activity section for admin", () => {
    render(<ActivityFeed isAdmin auditEntries={auditEntries} registrations={registrations} />)
    expect(screen.getByText("System Activity")).toBeInTheDocument()
    expect(screen.getByText(/USER_CREATED/)).toBeInTheDocument()
    expect(screen.getByText(/Admin User/)).toBeInTheDocument()
  })

  it("hides System Activity section for non-admin", () => {
    render(<ActivityFeed isAdmin={false} auditEntries={auditEntries} registrations={registrations} />)
    expect(screen.queryByText("System Activity")).not.toBeInTheDocument()
    expect(screen.queryByText(/USER_CREATED/)).not.toBeInTheDocument()
  })

  it("shows Recent Registrations for all roles", () => {
    render(<ActivityFeed isAdmin={false} auditEntries={[]} registrations={registrations} />)
    expect(screen.getByText("Recent Registrations")).toBeInTheDocument()
    expect(screen.getByText(/John Smith/)).toBeInTheDocument()
    expect(screen.getByText(/Easter Service/)).toBeInTheDocument()
  })

  it("shows empty state when no registrations", () => {
    render(<ActivityFeed isAdmin={false} auditEntries={[]} registrations={[]} />)
    expect(screen.getByText("No recent registrations.")).toBeInTheDocument()
  })

  it("shows resource ID in audit entry when present", () => {
    render(<ActivityFeed isAdmin auditEntries={auditEntries} registrations={[]} />)
    expect(screen.getByText(/User #42/)).toBeInTheDocument()
  })

  it("omits resource ID in audit entry when null", () => {
    const entries = [{ ...auditEntries[0], resourceId: null }]
    render(<ActivityFeed isAdmin auditEntries={entries} registrations={[]} />)
    expect(screen.queryByText(/#\d/)).not.toBeInTheDocument()
  })

  it("hides System Activity section when admin but no audit entries", () => {
    render(<ActivityFeed isAdmin auditEntries={[]} registrations={registrations} />)
    expect(screen.queryByText("System Activity")).not.toBeInTheDocument()
  })

  it("renders relative timestamp on registration entries", () => {
    render(<ActivityFeed isAdmin={false} auditEntries={[]} registrations={registrations} />)
    expect(screen.getByText(/\d+(m|h|d) ago/)).toBeInTheDocument()
  })

  it("renders System as fallback when audit entry user name is null", () => {
    const entries = [{ ...auditEntries[0], user: { name: null } }]
    render(<ActivityFeed isAdmin auditEntries={entries} registrations={[]} />)
    expect(screen.getByText("System", { exact: true })).toBeInTheDocument()
  })
})
