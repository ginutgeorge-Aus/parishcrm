import "@testing-library/jest-dom"

// Ensure fetch is available for Stripe SDK in test environment
if (!global.fetch) {
  global.fetch = jest.fn() as unknown as typeof fetch
}

// AUTH_SECRET is set in every real (dev/prod) env — NextAuth and the HMAC
// helpers (otp.ts, formToken.ts) require it and now throw without it.
// Provide a default so suites that exercise the public registration form
// (events-register, public-event-page) don't have to set it themselves; tests
// that assert the unset/fallback behaviour (env-check, otp, formToken) still
// delete or override it locally.
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-auth-secret"

// ENCRYPTION_KEY is not loaded from .env.local in the test env (Next.js skips
// .env.local when NODE_ENV=test). Provide a default 32-byte key so suites that
// exercise real encrypt/decrypt (rather than mocking @/lib/crypto) don't have
// to set it themselves.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "KZXs0hqT9LR30viJcsm2QLGGG8FbSem+APKBUa+95xU="

// jsdom shims for Radix Popover + cmdk (BankReviewTable member combobox tests)
if (typeof global !== "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = global.ResizeObserver ?? (ResizeObserverMock as unknown as typeof ResizeObserver)

  if (typeof Element !== "undefined") {
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})
    Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false)
    Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {})
    Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {})
  }
}
