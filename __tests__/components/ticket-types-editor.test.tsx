import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { TicketTypesEditor } from "@/components/events/TicketTypesEditor"
import type { Row, TicketTypeRow } from "@/components/events/TicketTypesEditor"

// Wrapper that owns the state — mirrors how EventForm uses the controlled editor.
function Wrapper({ initial }: { initial: Omit<Row, "_key">[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map((r, i) => ({ ...r, _key: `tt-init-${i}` })))
  const add = () => setRows((r) => [...r, { name: "", price: "", capacity: "", countsTowardWaiver: "true", _key: `tt-new-${r.length}` }])
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i))
  const update = (i: number, field: keyof TicketTypeRow, value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))
  return <TicketTypesEditor rows={rows} onAdd={add} onRemove={remove} onUpdate={update} />
}

describe("TicketTypesEditor — id round-trip", () => {
  it("renders a hidden id input for existing ticket types", () => {
    const { container } = render(
      <Wrapper initial={[{ id: "5", name: "Adult", price: "50.00", capacity: "", countsTowardWaiver: "true" }]} />
    )
    const hidden = container.querySelector('input[name="ticketType.0.id"]') as HTMLInputElement
    expect(hidden).not.toBeNull()
    expect(hidden.type).toBe("hidden")
    expect(hidden.value).toBe("5")
  })

  it("renders an empty id for newly added rows", async () => {
    const user = userEvent.setup()
    const { container } = render(<Wrapper initial={[]} />)
    await user.click(screen.getByRole("button", { name: "+ Add ticket type" }))
    const hidden = container.querySelector('input[name="ticketType.0.id"]') as HTMLInputElement
    expect(hidden).not.toBeNull()
    expect(hidden.value).toBe("")
  })
})

describe("TicketTypesEditor — tickets optional", () => {
  it("starts with zero rows when event has no ticket types", () => {
    const { container } = render(<Wrapper initial={[]} />)
    expect(container.querySelector('input[name="ticketType.0.name"]')).toBeNull()
  })

  it("allows removing the last remaining row", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Wrapper initial={[{ id: "5", name: "Adult", price: "50.00", capacity: "", countsTowardWaiver: "true" }]} />
    )
    await user.click(screen.getByRole("button", { name: /remove ticket type/i }))
    expect(container.querySelector('input[name="ticketType.0.name"]')).toBeNull()
  })

  it("keeps name and price required on rows the user adds", async () => {
    const user = userEvent.setup()
    render(<Wrapper initial={[]} />)
    await user.click(screen.getByRole("button", { name: "+ Add ticket type" }))
    expect(screen.getByLabelText("Ticket name (row 1)")).toBeRequired()
    expect(screen.getByLabelText("Ticket price (row 1)")).toBeRequired()
    expect(screen.getByLabelText("Ticket capacity (row 1)")).not.toBeRequired()
  })
})
