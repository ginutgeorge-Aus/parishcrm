/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react"
import { getNonce } from "get-nonce"
import { NonceProvider, useNonce } from "@/components/NonceProvider"

function Probe() {
  return <span data-testid="nonce">{useNonce()}</span>
}

describe("NonceProvider", () => {
  it("exposes the nonce through context", () => {
    const { getByTestId } = render(
      <NonceProvider nonce="abc123">
        <Probe />
      </NonceProvider>,
    )
    expect(getByTestId("nonce").textContent).toBe("abc123")
  })

  // Radix's scroll lock (react-remove-scroll → react-style-singleton) injects
  // a <style> tag at runtime, reading its nonce from get-nonce. Without this,
  // opening any Dialog/Select logs a style-src CSP violation in production.
  it("registers the nonce with get-nonce for runtime-injected styles", () => {
    render(
      <NonceProvider nonce="xyz789">
        <Probe />
      </NonceProvider>,
    )
    expect(getNonce()).toBe("xyz789")
  })
})
