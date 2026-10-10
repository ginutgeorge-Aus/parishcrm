import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BrandingForm, checkBrandingFile } from "../BrandingForm"
import { uploadBranding } from "@/lib/actions/branding"

jest.mock("@/lib/actions/branding", () => ({ uploadBranding: jest.fn(), resetBranding: jest.fn() }))

const mockUpload = uploadBranding as jest.Mock

const fileOf = (type: string, bytes: number) => new File([new Uint8Array(bytes)], "logo", { type })

const pick = (file: File) => {
  const input = screen.getByLabelText("Upload Logo image") as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

beforeEach(() => jest.clearAllMocks())

describe("checkBrandingFile", () => {
  it("accepts a small PNG", () => {
    expect(checkBrandingFile(fileOf("image/png", 10))).toBeNull()
  })
  it("rejects a missing or empty file", () => {
    expect(checkBrandingFile(null)).toMatch(/choose an image/i)
    expect(checkBrandingFile(fileOf("image/png", 0))).toMatch(/choose an image/i)
  })
  it("rejects an unsupported type", () => {
    expect(checkBrandingFile(fileOf("image/svg+xml", 10))).toMatch(/PNG, JPEG or WebP/)
  })
  it("rejects a file over 2 MB", () => {
    expect(checkBrandingFile(fileOf("image/png", 2 * 1024 * 1024 + 1))).toMatch(/too large/i)
  })
})

describe("BrandingForm", () => {
  it("shows the error as soon as an oversized file is picked and does not upload it", () => {
    render(<BrandingForm />)
    const input = pick(fileOf("image/png", 2 * 1024 * 1024 + 1))
    expect(screen.getByText("File too large (max 2 MB).")).toBeInTheDocument()
    fireEvent.submit(input.form!)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("keeps the chosen file when the server rejects the upload", async () => {
    mockUpload.mockResolvedValue({ error: "Could not read that image." })
    render(<BrandingForm />)
    const file = fileOf("image/png", 10)
    const input = pick(file)
    fireEvent.submit(input.form!)
    await waitFor(() => expect(screen.getByText("Could not read that image.")).toBeInTheDocument())
    expect(mockUpload).toHaveBeenCalledWith("logo", expect.any(FormData))
    expect(input.files?.[0]).toBe(file)
  })
})
