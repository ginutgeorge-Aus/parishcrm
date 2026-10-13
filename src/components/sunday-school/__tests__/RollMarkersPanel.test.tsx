import { render, screen } from "@testing-library/react"

jest.mock("@/lib/actions/sundaySchoolAttendance", () => ({ addRollMarker: jest.fn(), removeRollMarker: jest.fn() }))

import { RollMarkersPanel } from "@/components/sunday-school/RollMarkersPanel"

const markers = [{ id: 1, name: "Volunteer One", email: "volunteer@example.com", active: true }]
const assignable = [{ id: 2, name: "Volunteer Two", email: "volunteer2@example.com" }]

describe("RollMarkersPanel", () => {
  it("offers remove and add while editable", () => {
    render(<RollMarkersPanel classId={1} markers={markers} assignable={assignable} />)
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument()
  })
  it("lists assignments without remove/add when read-only (locked year)", () => {
    render(<RollMarkersPanel classId={1} markers={markers} assignable={assignable} readOnly />)
    expect(screen.getByText(/Volunteer One/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull()
    expect(screen.queryByText(/No unassigned Event organiser logins/)).toBeNull()
  })
})
