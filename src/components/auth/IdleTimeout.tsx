"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { logout } from "@/lib/actions/session"

const WARN_MS = 60 * 1000
// Throttle server session refreshes so we don't ping on every mousemove; the
// shortest idle window is 15 min, so a 60s cadence tracks activity closely.
const ACTIVITY_PING_MS = 60 * 1000

const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"]

export function IdleTimeout({ idleMinutes = 60 }: { idleMinutes?: number }) {
  const idleMs = idleMinutes * 60 * 1000
  const { update } = useSession()
  // next-auth v5 rebuilds `update`'s identity whenever `loading` flips, and
  // calling it toggles `loading` — so depending on it directly re-fires the
  // effect and silently resets the idle timers without any user input.
  // Hold it in a ref so the effect depends only on `idleMs`.
  const updateRef = useRef(update)
  useEffect(() => { updateRef.current = update }, [update])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPingRef = useRef(0)
  const [showWarning, setShowWarning] = useState(false)

  useEffect(() => {
    function reset() {
      setShowWarning(false)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current)

      // refresh the server session token on real activity (throttled) so
      // the server-side idle clock tracks actual use. Without this the server
      // would expire an actively-used session at the idle window.
      const now = Date.now()
      if (now - lastPingRef.current > ACTIVITY_PING_MS) {
        lastPingRef.current = now
        void updateRef.current()
      }

      warnTimerRef.current = setTimeout(() => setShowWarning(true), idleMs - WARN_MS)
      timerRef.current = setTimeout(() => { void logout() }, idleMs)
    }

    reset()
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }))

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current)
      EVENTS.forEach((e) => window.removeEventListener(e, reset, { passive: true } as EventListenerOptions))
    }
  }, [idleMs])

  if (!showWarning) return null

  return (
    <div role="alert" aria-live="assertive" className="fixed bottom-4 right-4 z-50 rounded-lg border border-gold bg-gold/10 px-4 py-3 text-sm text-foreground shadow-lg">
      Session expiring in {WARN_MS / 60000} minute{WARN_MS / 60000 !== 1 ? "s" : ""} due to inactivity.{" "}
      <button
        className="font-semibold underline"
        onClick={() => {
          setShowWarning(false)
          window.dispatchEvent(new MouseEvent("mousemove"))
        }}
      >
        Stay logged in
      </button>
    </div>
  )
}
