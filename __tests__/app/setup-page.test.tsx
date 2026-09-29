/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import SetupPage from "@/app/(auth)/setup/page"
import { isSetupOpen } from "@/lib/setupState"
import { redirect } from "next/navigation"

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))
jest.mock("@/lib/setupState", () => ({ isSetupOpen: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({ name: "Demo Parish" }),
}))
jest.mock("@/components/auth/SetupForm", () => ({ SetupForm: () => <form aria-label="setup form" /> }))

describe("SetupPage", () => {
  beforeEach(() => jest.clearAllMocks())

  it("redirects to login once setup is closed", async () => {
    ;(isSetupOpen as jest.Mock).mockResolvedValue(false)
    await expect(SetupPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("renders the form while setup is open", async () => {
    ;(isSetupOpen as jest.Mock).mockResolvedValue(true)
    render(await SetupPage())
    expect(screen.getByRole("heading", { level: 1, name: "Create the first administrator" })).toBeInTheDocument()
    expect(screen.getByRole("form", { name: "setup form" })).toBeInTheDocument()
    expect(redirect).not.toHaveBeenCalled()
  })
})
