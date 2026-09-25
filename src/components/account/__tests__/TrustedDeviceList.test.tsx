import { render, screen, fireEvent, act } from "@testing-library/react"
import { TrustedDeviceList } from "@/components/account/TrustedDeviceList"
import { revokeTrustedDevice } from "@/lib/actions/trustedDevice"

jest.mock("@/lib/actions/trustedDevice", () => ({
  revokeTrustedDevice: jest.fn(),
}))

const mockRevoke = revokeTrustedDevice as jest.Mock

const devices = [
  { id: "dev-1", label: "Chrome on Mac", createdAt: new Date(), lastUsedAt: new Date() },
]

afterEach(() => jest.clearAllMocks())

test("keeps the device row and shows the error when revoke returns {error}", async () => {
  // A failed revocation must NOT strip the row — a device that still bypasses
  // OTP would otherwise look revoked.
  mockRevoke.mockResolvedValue({ error: "Invalid device" })
  render(<TrustedDeviceList devices={devices} />)

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revoke" })) })

  expect(screen.getByText("Chrome on Mac")).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid device")
})

test("keeps the device row when the revoke action throws", async () => {
  mockRevoke.mockRejectedValue(new Error("network"))
  render(<TrustedDeviceList devices={devices} />)

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revoke" })) })

  expect(screen.getByText("Chrome on Mac")).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
})

test("removes the device row on a confirmed revoke", async () => {
  mockRevoke.mockResolvedValue({ success: true })
  render(<TrustedDeviceList devices={devices} />)

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revoke" })) })

  expect(screen.queryByText("Chrome on Mac")).not.toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
