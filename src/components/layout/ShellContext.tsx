"use client"

import { createContext, useContext, useId, useMemo, useRef, useState } from "react"

type Shell = {
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  /** The top bar's hamburger; the drawer returns focus here on close. */
  menuButtonRef: React.RefObject<HTMLButtonElement | null>
  /** id of the mobile drawer, for the hamburger's aria-controls. */
  drawerId: string
}

const ShellContext = createContext<Shell | null>(null)

/** Shares the mobile drawer's open state between TopBar and Sidebar. */
export function ShellProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerId = useId()
  const value = useMemo(() => ({ mobileOpen, setMobileOpen, menuButtonRef, drawerId }), [mobileOpen, drawerId])
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

/** Shell state; throws outside ShellProvider so a missing provider fails loudly. */
export function useShell(): Shell {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error("useShell must be used within ShellProvider")
  return ctx
}
