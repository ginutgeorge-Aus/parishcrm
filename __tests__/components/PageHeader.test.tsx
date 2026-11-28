/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { PageHeader } from "@/components/shared/PageHeader"

describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<PageHeader title="People" />)
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument()
  })

  it("renders eyebrow, description, meta and actions when given", () => {
    render(
      <PageHeader
        title="Jane Doe"
        eyebrow={<nav aria-label="Breadcrumb">Families / Doe</nav>}
        description="Household contact"
        meta={<span>Adult</span>}
        actions={<button type="button">Edit</button>}
      />,
    )
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument()
    expect(screen.getByText("Household contact")).toBeInTheDocument()
    expect(screen.getByText("Adult")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument()
  })

  it("omits the optional regions when not given", () => {
    const { container } = render(<PageHeader title="Users" />)
    expect(container.querySelectorAll("p")).toHaveLength(0)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("stacks on phone and wraps the action row so nothing overflows at 375px", () => {
    const { container } = render(<PageHeader title="Budget vs Actual" actions={<button type="button">Print</button>} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("flex-col")
    expect(root.className).toContain("sm:flex-row")
    const actions = screen.getByRole("button", { name: "Print" }).parentElement as HTMLElement
    expect(actions.className).toContain("flex-wrap")
  })

  it("shows the badge beside the title, outside the h1", () => {
    render(<PageHeader title="Session" badge={<span>OPEN</span>} />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Session$/)
    expect(screen.getByText("OPEN")).toBeInTheDocument()
  })

  it("top-aligns the action row when align=start and hides an empty action row", () => {
    const { container } = render(<PageHeader title="T" align="start" actions={<></>} />)
    expect((container.firstElementChild as HTMLElement).className).toContain("sm:items-start")
    expect(container.querySelector(".empty\\:hidden")).not.toBeNull()
  })

  it("lets callers add classes (e.g. print:hidden) to the root", () => {
    const { container } = render(<PageHeader title="Report" className="print:hidden" />)
    expect((container.firstElementChild as HTMLElement).className).toContain("print:hidden")
  })
})
