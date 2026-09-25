"use client"

import { createContext, useContext } from "react"

// The per-request CSP nonce (set in middleware as `x-nonce`) made
// available to client components so they can attach it to inline `<style>`
// tags they render. Server components read the nonce from `headers()` directly;
// client components (e.g. the chart styling in components/ui/chart.tsx) can't,
// so the root layout reads it once and threads it down through this context.
const NonceContext = createContext<string | undefined>(undefined)

export function NonceProvider({
  nonce,
  children,
}: {
  nonce: string | undefined
  children: React.ReactNode
}) {
  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>
}

export function useNonce(): string | undefined {
  return useContext(NonceContext)
}
