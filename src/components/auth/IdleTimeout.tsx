"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { logout } from "@/lib/actions/session"

const WARN_MS = 60 * 1000
// Throttle server session refreshes so we don't ping on every mousemove; the
// shortest idle window is 15 min, so a 60s cadence tracks activity closely.
const ACTIVITY_PING_MS = 60 * 1000
// How often the idle clock is checked. Activity only stamps a ref, so the
// per-event cost is a timestamp compare; warning/logout lag by at most this.
const CHECK_MS = 1000

const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"]
// Last activity shared by every open tab: logout() ends the session in all of
// them, so an idle tab must not log out while the user works in another.
const SHARED_KEY = "idleTimeout:lastActivity"

// Clock-skew allowance for shared timestamps. A value further ahead than this
// comes from a clock-ahead tab and is ignored: honouring it would defer logout
// until this tab's clock catches up (indefinitely, if the skew is large).
const MAX_SKEW_MS = 5 * 1000

/**
 * Latest activity any tab has shared (0 when none, blocked, invalid, or more
 * than MAX_SKEW_MS in the future).
 */
function readSharedActivity(): number {
  try {
    const raw = window.localStorage.getItem(SHARED_KEY)
    if (raw === null) return 0
    const v = Number(raw)
    return Number.isFinite(v) && v <= Date.now() + MAX_SKEW_MS ? v : 0
  } catch {
    return 0
  }
}

/** Shares this tab's activity with the other tabs (best effort). */
function writeSharedActivity(at: number) {
  try {
    window.localStorage.setItem(SHARED_KEY, String(at))
  } catch {
    // Storage blocked (private mode, policy): this tab keeps its own clock.
  }
}

export function IdleTimeout({ idleMinutes = 60 }: Readonly<{ idleMinutes?: number }>) {
  const idleMs = idleMinutes * 60 * 1000
  const { update } = useSession()
  // next-auth v5 rebuilds `update`'s identity whenever `loading` flips, and
  // calling it toggles `loading` — so depending on it directly re-fires the
  // effect and silently resets the idle clock without any user input.
  // Hold it in a ref so the effect depends only on `idleMs`.
  const updateRef = useRef(update)
  useEffect(() => { updateRef.current = update }, [update])
  const lastActivityRef = useRef(0)
  const lastPingRef = useRef(0)
  // Last activity this tab wrote to shared storage, so each check writes only news.
  const lastSharedRef = useRef(0)
  // Mirrors showWarning for the event handler, which must not re-subscribe.
  const warningRef = useRef(false)
  const [showWarning, setShowWarning] = useState(false)
  // A new idle window (admin changed the setting) starts without a warning.
  const [prevIdleMs, setPrevIdleMs] = useState(idleMs)
  if (prevIdleMs !== idleMs) {
    setPrevIdleMs(idleMs)
    setShowWarning(false)
  }

  /**
   * Records activity and refreshes the server session (throttled) so the
   * server-side idle clock tracks actual use; without this the server would
   * expire an actively-used session at the idle window.
   * @param forcePing ping even inside the throttle window (explicit "Stay logged in")
   */
  const touch = useCallback((forcePing = false) => {
    const now = Date.now()
    lastActivityRef.current = now
    if (forcePing || now - lastPingRef.current > ACTIVITY_PING_MS) {
      lastPingRef.current = now
      void updateRef.current()
    }
  }, [])

  useEffect(() => {
    let loggedOut = false
    // Passive activity is ignored while the warning shows: only the explicit
    // button keeps the session, so a stray mouse move can't dismiss it.
    function onActivity() {
      if (!warningRef.current) touch()
    }
    function check() {
      if (loggedOut) return
      const shared = readSharedActivity()
      // Never knowingly write an older value over a newer one from another tab
      // (a throttled tab would otherwise regress the shared clock).
      if (lastActivityRef.current > Math.max(lastSharedRef.current, shared)) {
        lastSharedRef.current = lastActivityRef.current
        writeSharedActivity(lastActivityRef.current)
      }
      const idle = Date.now() - Math.max(lastActivityRef.current, shared)
      if (idle >= idleMs) {
        loggedOut = true
        void logout()
      } else if (idle >= idleMs - WARN_MS) {
        if (!warningRef.current) {
          warningRef.current = true
          setShowWarning(true)
        }
      } else if (warningRef.current) {
        // Another tab saw activity (or its "Stay logged in"): the session lives on.
        warningRef.current = false
        setShowWarning(false)
      }
    }

    // A changed idleMinutes restarts this effect with a fresh window; drop any
    // warning left from the old one so passive activity counts again (the
    // banner itself is cleared during render, below the state declarations).
    warningRef.current = false
    touch()
    const interval = setInterval(check, CHECK_MS)
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))

    return () => {
      clearInterval(interval)
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { passive: true } as EventListenerOptions))
    }
  }, [idleMs, touch])

  if (!showWarning) return null

  return (
    <div role="alert" aria-live="assertive" className="fixed bottom-4 right-4 z-50 rounded-lg border border-gold bg-gold/10 px-4 py-3 text-sm text-foreground shadow-lg">
      Session expiring in {WARN_MS / 60000} minute{WARN_MS / 60000 !== 1 ? "s" : ""} due to inactivity.{" "}
      <button
        className="font-semibold underline"
        onClick={() => {
          warningRef.current = false
          setShowWarning(false)
          touch(true)
        }}
      >
        Stay logged in
      </button>
    </div>
  )
}
