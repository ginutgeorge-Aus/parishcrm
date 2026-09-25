/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ImportClient } from "@/components/import/ImportClient"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

// Minimal CheckResult shape the component reads from /api/import/families/check
const makeCheckResponse = (overrides: {
  rows?: object[]
  duplicates?: string[]
  errors?: object[]
} = {}) => ({
  rows: overrides.rows ?? [
    {
      family: { name: "Smith", memberNo: "C35", address: "1 High St", suburb: "Sydney", state: "NSW", postcode: "2000" },
      person: { firstName: "John", lastName: "Smith", dob: null, gender: "MALE", role: "HEAD", classification: "MEMBER", email: null, mobile: null },
    },
  ],
  duplicates: overrides.duplicates ?? [],
  errors: overrides.errors ?? [],
})

// Minimal ImportResult shape from /api/import/families
const makeImportResponse = (overrides: {
  imported?: number
  skipped?: number
  errors?: Array<{ row: number; message: string }>
} = {}) => ({
  imported: overrides.imported ?? 1,
  skipped: overrides.skipped ?? 0,
  errors: overrides.errors ?? [],
})

function makeFile(name = "import.csv") {
  return new File(["family_name\nSmith"], name, { type: "text/csv" })
}

beforeEach(() => {
  jest.restoreAllMocks()
})

// ---- helpers ----

async function renderAndSelectFile(file = makeFile()) {
  const user = userEvent.setup()
  render(<ImportClient />)
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(input, file)
  return user
}

async function doCheck(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /check for duplicates/i }))
}

// ---- tests ----

describe("ImportClient — initial state", () => {
  it("renders the file upload form with no file chosen", () => {
    render(<ImportClient />)
    expect(screen.getByText(/no file chosen/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /check for duplicates/i })).toBeDisabled()
  })

  it("enables the Check button after a file is selected", async () => {
    const user = userEvent.setup()
    render(<ImportClient />)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, makeFile())
    expect(screen.getByRole("button", { name: /check for duplicates/i })).not.toBeDisabled()
    expect(screen.getByText("import.csv")).toBeInTheDocument()
  })
})

describe("ImportClient — check / preview path", () => {
  it("shows a preview table after a successful check", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeCheckResponse(),
    }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)

    expect(await screen.findByText("Smith")).toBeInTheDocument()
    expect(screen.getByText("John Smith")).toBeInTheDocument()
    expect(screen.getByText(/new/i)).toBeInTheDocument()
  })

  it("marks a duplicate family with 'Exists' badge", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeCheckResponse({ duplicates: ["Smith"] }),
    }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)

    expect(await screen.findByText(/exists.*will skip/i)).toBeInTheDocument()
  })

  it("shows an error banner when check returns ok:false", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "No file provided" }),
    }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)

    expect(await screen.findByText("No file provided")).toBeInTheDocument()
    // Form is still visible — user can retry
    expect(screen.getByRole("button", { name: /check for duplicates/i })).toBeInTheDocument()
  })

  it("disables the Import button when all rows are duplicates", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeCheckResponse({ duplicates: ["Smith"] }),
    }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)

    await screen.findByText(/exists.*will skip/i)
    expect(screen.getByRole("button", { name: /import/i })).toBeDisabled()
  })
})

describe("ImportClient — COMMIT path", () => {
  async function setupPreview(checkBody = makeCheckResponse()) {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => checkBody,
    }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)
    // Wait for preview table
    await screen.findByText("Smith")
    return user
  }

  it("POSTs to /api/import/families on confirm", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeCheckResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => makeImportResponse() })
    global.fetch = fetchMock as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)
    await screen.findByText("Smith")

    await user.click(screen.getByRole("button", { name: /import/i }))

    await waitFor(() => {
      const commitCall = fetchMock.mock.calls.find(([url]) => url === "/api/import/families")
      expect(commitCall).toBeDefined()
      const [, opts] = commitCall!
      expect(opts.method).toBe("POST")
      expect(opts.body).toBeInstanceOf(FormData)
    })
  })

  it("shows the imported/skipped result after a successful commit", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeCheckResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => makeImportResponse({ imported: 3, skipped: 1 }) }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)
    await screen.findByText("Smith")

    await user.click(screen.getByRole("button", { name: /import/i }))

    expect(await screen.findByText(/3 imported/i)).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument()
    // Preview table gone
    expect(screen.queryByRole("button", { name: /import/i })).not.toBeInTheDocument()
  })

  it("shows per-row errors in result when commit returns errors array", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeCheckResponse() })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeImportResponse({
          imported: 0,
          skipped: 0,
          errors: [{ row: 2, message: "Invalid dob format" }],
        }),
      }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)
    await screen.findByText("Smith")
    await user.click(screen.getByRole("button", { name: /import/i }))

    expect(await screen.findByText("Invalid dob format")).toBeInTheDocument()
    expect(screen.getByText(/0 imported/i)).toBeInTheDocument()
  })

  it("surfaces error banner and allows retry when commit returns ok:false", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeCheckResponse() })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Import failed" }) }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)
    await screen.findByText("Smith")
    await user.click(screen.getByRole("button", { name: /import/i }))

    expect(await screen.findByText("Import failed")).toBeInTheDocument()
    // Import button still present — user can retry
    expect(screen.getByRole("button", { name: /import/i })).toBeInTheDocument()
  })

  it("shows loading state during commit and re-enables on ok:false", async () => {
    // Verifies the component correctly transitions loading=true → loading=false
    // on a failed (ok:false) commit, leaving the user able to retry.
    let resolveFetch!: (v: unknown) => void
    const pendingFetch = new Promise((resolve) => { resolveFetch = resolve })

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeCheckResponse() })
      .mockReturnValueOnce(pendingFetch) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)
    await screen.findByText("Smith")
    await user.click(screen.getByRole("button", { name: /import/i }))

    // Button disabled while loading
    expect(screen.getByRole("button", { name: /importing/i })).toBeDisabled()

    // Resolve with a failure response
    resolveFetch({ ok: false, json: async () => ({ error: "Server error" }) })

    expect(await screen.findByText("Server error")).toBeInTheDocument()
    // Import button re-enabled after error
    expect(screen.getByRole("button", { name: /import/i })).not.toBeDisabled()
  })

  it("commit sends the same file chosen at upload (FormData contains 'file')", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeCheckResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => makeImportResponse() })
    global.fetch = fetchMock as jest.Mock

    const file = makeFile("families-june.csv")
    const user = userEvent.setup()
    render(<ImportClient />)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, file)
    await doCheck(user)
    await screen.findByText("Smith")
    await user.click(screen.getByRole("button", { name: /import/i }))

    await waitFor(() => {
      const commitCall = fetchMock.mock.calls.find(([url]) => url === "/api/import/families")
      expect(commitCall).toBeDefined()
      const formData: FormData = commitCall![1].body
      expect(formData.get("file")).toBe(file)
    })
  })
})

describe("ImportClient — cancel / reset", () => {
  it("returns to the upload form when Cancel is clicked from preview", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeCheckResponse(),
    }) as jest.Mock

    const user = await renderAndSelectFile()
    await doCheck(user)
    await screen.findByText("Smith")

    await user.click(screen.getByRole("button", { name: /cancel/i }))

    expect(screen.getByText(/no file chosen/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /check for duplicates/i })).toBeDisabled()
  })
})
