import { render, screen, fireEvent, act } from "@testing-library/react"
import { PasskeySettings } from "@/components/account/PasskeySettings"
import { finishPasskeyRegistration, removePasskey, startPasskeyRegistration } from "@/lib/actions/passkey"
import { startRegistration } from "@simplewebauthn/browser"

jest.mock("@/lib/actions/passkey", () => ({
  startPasskeyRegistration: jest.fn(),
  finishPasskeyRegistration: jest.fn(),
  removePasskey: jest.fn(),
}))
jest.mock("@simplewebauthn/browser", () => ({ startRegistration: jest.fn() }))
const mockRefresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

const mockStart = startPasskeyRegistration as jest.Mock
const mockFinish = finishPasskeyRegistration as jest.Mock
const mockRemove = removePasskey as jest.Mock
const mockBrowserReg = startRegistration as jest.Mock

const passkey = { id: "pk1", name: "My phone", createdAt: new Date("2026-10-01"), lastUsedAt: null, backedUp: true }

afterEach(() => jest.clearAllMocks())

async function addPasskey(name = "Laptop", password = "pw") {
  fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }))
  fireEvent.change(screen.getByLabelText("Passkey name"), { target: { value: name } })
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: password } })
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create passkey" })) })
}

test("explains when passkeys are unavailable and offers nothing", () => {
  render(<PasskeySettings status={{ available: false, passkeys: [] }} />)
  expect(screen.getByText(/need this site to be served over HTTPS/)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument()
})

test("lists passkeys with a synced badge and never-used text", () => {
  render(<PasskeySettings status={{ available: true, passkeys: [passkey] }} />)
  expect(screen.getByText("My phone")).toBeInTheDocument()
  expect(screen.getByText("Synced")).toBeInTheDocument()
  expect(screen.getByText(/Never used/)).toBeInTheDocument()
})

test("removes a passkey only after the server confirms", async () => {
  mockRemove.mockResolvedValue({ success: true })
  render(<PasskeySettings status={{ available: true, passkeys: [passkey] }} />)
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove My phone" })) })
  expect(mockRemove).toHaveBeenCalledWith("pk1")
  expect(mockRefresh).toHaveBeenCalled()
})

test("shows the server error when remove fails", async () => {
  mockRemove.mockResolvedValue({ error: "Passkey not found" })
  render(<PasskeySettings status={{ available: true, passkeys: [passkey] }} />)
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove My phone" })) })
  expect(screen.getByRole("alert")).toHaveTextContent("Passkey not found")
  expect(mockRefresh).not.toHaveBeenCalled()
})

test("adds a passkey: start → browser ceremony → finish with the name", async () => {
  mockStart.mockResolvedValue({ challengeId: "ch1", options: { challenge: "c" } })
  mockBrowserReg.mockResolvedValue({ id: "cred-1" })
  mockFinish.mockResolvedValue({ success: true })
  render(<PasskeySettings status={{ available: true, passkeys: [] }} />)
  await addPasskey("Laptop", "pw")
  expect(mockStart).toHaveBeenCalledWith("pw")
  expect(mockBrowserReg).toHaveBeenCalledWith({ optionsJSON: { challenge: "c" } })
  expect(mockFinish).toHaveBeenCalledWith("ch1", { id: "cred-1" }, "Laptop")
  expect(mockRefresh).toHaveBeenCalled()
})

test("shows a start error (e.g. wrong password) without opening the browser prompt", async () => {
  mockStart.mockResolvedValue({ error: "Incorrect password" })
  render(<PasskeySettings status={{ available: true, passkeys: [] }} />)
  await addPasskey()
  expect(screen.getByRole("alert")).toHaveTextContent("Incorrect password")
  expect(mockBrowserReg).not.toHaveBeenCalled()
})

test("reports a cancelled browser prompt", async () => {
  mockStart.mockResolvedValue({ challengeId: "ch1", options: {} })
  mockBrowserReg.mockRejectedValue(Object.assign(new Error("cancelled"), { name: "NotAllowedError" }))
  render(<PasskeySettings status={{ available: true, passkeys: [] }} />)
  await addPasskey()
  expect(screen.getByRole("alert")).toHaveTextContent("Passkey setup was cancelled.")
  expect(mockFinish).not.toHaveBeenCalled()
})

test("hides Add at the 10-passkey cap", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...passkey, id: `pk${i}`, name: `Key ${i}` }))
  render(<PasskeySettings status={{ available: true, passkeys: ten }} />)
  expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument()
})
