/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ImportClient } from "@/components/import/ImportClient"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

const validRow = {
  family: { name: "Sample" },
  person: { firstName: "Ann", lastName: "Sample" },
}

async function previewWith(result: { rows: unknown[]; duplicates: string[]; errors: Array<{ row: number; message: string }> }) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => result }) as unknown as typeof fetch
  const user = userEvent.setup()
  const { container } = render(<ImportClient />)
  const input = container.querySelector("input[type=file]") as HTMLInputElement
  await user.upload(input, new File(["x"], "f.csv", { type: "text/csv" }))
  await user.click(screen.getByRole("button", { name: /check for duplicates/i }))
  await screen.findByRole("button", { name: /^import /i })
}

it("lists each parse error with row number and message", async () => {
  await previewWith({
    rows: [validRow],
    duplicates: [],
    errors: [
      { row: 3, message: "family_name is required" },
      { row: 7, message: "invalid dob" },
    ],
  })
  expect(screen.getByText(/2 rows have parse errors/i)).toBeInTheDocument()
  expect(screen.getByText("3")).toBeInTheDocument()
  expect(screen.getByText("family_name is required")).toBeInTheDocument()
  expect(screen.getByText("7")).toBeInTheDocument()
  expect(screen.getByText("invalid dob")).toBeInTheDocument()
})

it("uses singular grammar for one error", async () => {
  await previewWith({ rows: [validRow], duplicates: [], errors: [{ row: 2, message: "bad" }] })
  expect(screen.getByText(/1 row has a parse error/i)).toBeInTheDocument()
})

it("caps the list at 20 and says how many more", async () => {
  const errors = Array.from({ length: 25 }, (_, i) => ({ row: i + 2, message: `msg ${i}` }))
  await previewWith({ rows: [validRow], duplicates: [], errors })
  expect(screen.getByText("msg 19")).toBeInTheDocument()
  expect(screen.queryByText("msg 20")).not.toBeInTheDocument()
  expect(screen.getByText(/and 5 more/i)).toBeInTheDocument()
})

it("shows a headings hint when no row parses", async () => {
  await previewWith({ rows: [], duplicates: [], errors: [{ row: 2, message: "family_name is required" }] })
  expect(screen.getByText(/column headings do not match the expected format/i)).toBeInTheDocument()
})

it("renders error text as text, not HTML", async () => {
  await previewWith({ rows: [validRow], duplicates: [], errors: [{ row: 2, message: "<b>boom</b>" }] })
  expect(screen.getByText("<b>boom</b>")).toBeInTheDocument()
})
