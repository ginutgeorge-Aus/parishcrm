import { render, screen } from "@testing-library/react"
import { Users } from "lucide-react"
import { EmptyState } from "@/components/shared/EmptyState"

describe("EmptyState", () => {
  it("renders title and description with no actions", () => {
    render(<EmptyState icon={Users} title="No people yet" description="They show up here." />)
    expect(screen.getByRole("heading", { level: 3, name: "No people yet" })).toBeInTheDocument()
    expect(screen.getByText("They show up here.")).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("renders each action as a link", () => {
    render(
      <EmptyState
        title="No people yet"
        actions={[
          { label: "Add person", href: "/people/new" },
          { label: "Import CSV", href: "/import" },
        ]}
      />
    )
    expect(screen.getByRole("link", { name: "Add person" })).toHaveAttribute("href", "/people/new")
    expect(screen.getByRole("link", { name: "Import CSV" })).toHaveAttribute("href", "/import")
  })

  it("uses the requested heading level", () => {
    render(<EmptyState title="No events yet" headingLevel={2} />)
    expect(screen.getByRole("heading", { level: 2, name: "No events yet" })).toBeInTheDocument()
  })

  it("keys actions by label so two actions may share an href", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    render(
      <EmptyState
        title="x"
        actions={[
          { label: "One", href: "/same" },
          { label: "Two", href: "/same" },
        ]}
      />
    )
    expect(screen.getAllByRole("link")).toHaveLength(2)
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("same key"), expect.anything(), expect.anything())
    spy.mockRestore()
  })
})
