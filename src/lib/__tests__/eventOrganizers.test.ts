import { parseOrganizers, MAX_ORGANIZERS } from "@/lib/eventOrganizers"

function fd(rows: { name?: string; phone?: string }[]): FormData {
  const f = new FormData()
  rows.forEach((r, i) => {
    if (r.name !== undefined) f.set(`organizer.${i}.name`, r.name)
    if (r.phone !== undefined) f.set(`organizer.${i}.phone`, r.phone)
  })
  return f
}

describe("parseOrganizers", () => {
  it("returns [] when no organizer fields present", () => {
    expect(parseOrganizers(new FormData())).toEqual([])
  })

  it("parses name + phone", () => {
    expect(parseOrganizers(fd([{ name: "John", phone: "0412 345 678" }]))).toEqual([
      { name: "John", phone: "0412 345 678" },
    ])
  })

  it("phone optional — name-only row omits phone", () => {
    expect(parseOrganizers(fd([{ name: "Mary" }]))).toEqual([{ name: "Mary" }])
  })

  it("blank/whitespace phone is dropped, not stored empty", () => {
    expect(parseOrganizers(fd([{ name: "Mary", phone: "   " }]))).toEqual([{ name: "Mary" }])
  })

  it("trims name and phone", () => {
    expect(parseOrganizers(fd([{ name: "  John  ", phone: "  0412  " }]))).toEqual([
      { name: "John", phone: "0412" },
    ])
  })

  it("skips rows with blank name (contiguous scan stops at first missing index)", () => {
    // index 0 present but blank name → dropped; scan is index-driven so keep 1 present
    const f = new FormData()
    f.set("organizer.0.name", "   ")
    f.set("organizer.0.phone", "0400")
    f.set("organizer.1.name", "Real")
    expect(parseOrganizers(f)).toEqual([{ name: "Real" }])
  })

  it("keeps multiple organizers in order", () => {
    expect(
      parseOrganizers(fd([
        { name: "A", phone: "1" },
        { name: "B" },
        { name: "C", phone: "3" },
      ])),
    ).toEqual([{ name: "A", phone: "1" }, { name: "B" }, { name: "C", phone: "3" }])
  })

  it("caps at MAX_ORGANIZERS", () => {
    const rows = Array.from({ length: MAX_ORGANIZERS + 5 }, (_, i) => ({ name: `N${i}` }))
    expect(parseOrganizers(fd(rows))).toHaveLength(MAX_ORGANIZERS)
  })

  it("caps name and phone length", () => {
    const long = "x".repeat(500)
    const [org] = parseOrganizers(fd([{ name: long, phone: long }]))
    expect(org.name.length).toBeLessThanOrEqual(200)
    expect((org.phone ?? "").length).toBeLessThanOrEqual(50)
  })
})
