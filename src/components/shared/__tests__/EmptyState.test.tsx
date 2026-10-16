import { render, screen } from "@testing-library/react"
import { Users } from "lucide-react"
import { EmptyState } from "@/components/shared/EmptyState"

describe("EmptyState", () => {
  it("renders title and description with no actions", () => {
    render(<EmptyState icon={Users} title="No people yet" description="They show up here." />)
    expect(screen.getByText("No people yet")).toBeInTheDocument()
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
})
