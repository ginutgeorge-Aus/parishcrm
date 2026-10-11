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

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revoke Chrome on Mac" })) })

  expect(screen.getByText("Chrome on Mac")).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid device")
})

test("keeps the device row when the revoke action throws", async () => {
  mockRevoke.mockRejectedValue(new Error("network"))
  render(<TrustedDeviceList devices={devices} />)

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revoke Chrome on Mac" })) })

  expect(screen.getByText("Chrome on Mac")).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
})

test("removes the device row on a confirmed revoke", async () => {
  mockRevoke.mockResolvedValue({ success: true })
  render(<TrustedDeviceList devices={devices} />)

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revoke Chrome on Mac" })) })

  expect(screen.queryByText("Chrome on Mac")).not.toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

test("each Revoke button names its device for screen readers", () => {
  render(
    <TrustedDeviceList
      devices={[...devices, { id: "dev-2", label: null, createdAt: new Date(), lastUsedAt: new Date() }]}
    />,
  )
  expect(screen.getByRole("button", { name: "Revoke Chrome on Mac" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Revoke Unknown device" })).toBeInTheDocument()
})

test("marks the current device and keeps its Revoke label distinct", () => {
  render(
    <TrustedDeviceList
      devices={[{ ...devices[0], isCurrent: true }, { id: "dev-2", label: "Phone", createdAt: new Date(), lastUsedAt: new Date(), isCurrent: false }]}
    />,
  )
  expect(screen.getByText("This device")).toBeInTheDocument()
  expect(screen.getAllByText("This device")).toHaveLength(1)
  expect(screen.getByRole("button", { name: "Revoke Chrome on Mac (this device)" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Revoke Phone" })).toBeInTheDocument()
})

test("uses the themed divider token, not a hard-coded gray", () => {
  const { container } = render(<TrustedDeviceList devices={devices} />)
  expect(container.querySelector("ul")).toHaveClass("divide-border")
  expect(container.querySelector("ul")).not.toHaveClass("divide-gray-200")
})
