// Thin wrapper around a full-page browser navigation. jsdom 26 (jest-environment-jsdom
// 30) made `window.location` a non-configurable accessor — matching real browsers —
// so tests can no longer stub `window.location.href` via Object.defineProperty/delete
// (both throw) and a raw assignment silently no-ops (jsdom logs "Not implemented:
// navigation" and never updates the value). Routing the redirect through this module
// lets callers `jest.mock("@/lib/navigate")` instead.
export function navigateTo(url: string): void {
  window.location.href = url
}
