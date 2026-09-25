import { parseOrganizers, MAX_ORGANIZERS } from "@/lib/eventOrganizers"

function organizerForm(rows: { name?: string; phone?: string }[]) {
  const fd = new FormData()
  rows.forEach((r, i) => {
    fd.set(`organizer.${i}.name`, r.name ?? "")
    if (r.phone !== undefined) fd.set(`organizer.${i}.phone`, r.phone)
  })
  return fd
}

describe("parseOrganizers", () => {
  it("parses name + optional phone", () => {
    const fd = organizerForm([{ name: "Jane", phone: "0400000000" }, { name: "No Phone" }])
    expect(parseOrganizers(fd)).toEqual([
      { name: "Jane", phone: "0400000000" },
      { name: "No Phone" },
    ])
  })

  it("returns an empty array when no organizer fields are present", () => {
    expect(parseOrganizers(new FormData())).toEqual([])
  })

  it("drops blank-name rows without breaking subsequent ones", () => {
    const fd = organizerForm([{ name: "" }, { name: "Jane" }])
    expect(parseOrganizers(fd)).toEqual([{ name: "Jane" }])
  })

  it("caps at MAX_ORGANIZERS filled rows", () => {
    const rows = Array.from({ length: MAX_ORGANIZERS + 5 }, (_, i) => ({ name: `Person ${i}` }))
    const result = parseOrganizers(organizerForm(rows))
    expect(result).toHaveLength(MAX_ORGANIZERS)
  })

  // a blank name is skipped without growing the output array, so the
  // loop must hard-stop on the iteration count, not just organizers.length —
  // otherwise thousands of contiguous blank rows before one filled row force
  // unbounded FormData reads before the cap can ever trip.
  it("bounds total iterations, not just the output count, when many rows are blank", () => {
    const blanks = Array.from({ length: 1000 }, () => ({ name: "" }))
    const fd = organizerForm([...blanks, { name: "Late Arrival" }])
    expect(parseOrganizers(fd)).toEqual([])
  })

  it("truncates an over-long name and phone", () => {
    const fd = organizerForm([{ name: "x".repeat(300), phone: "9".repeat(100) }])
    const [org] = parseOrganizers(fd)
    expect(org.name.length).toBe(200)
    expect(org.phone!.length).toBe(50)
  })
})
