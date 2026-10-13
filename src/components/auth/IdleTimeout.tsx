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

/**
 * Monotonic now in ms. Local idle time is measured on this clock so a
 * wall-clock step (NTP correction, manual change) can't force an instant
 * logout (forward) or postpone one (back).
 */
function monoNow(): number {
  return performance.now()
}

/**
 * Converts a monotonic stamp to wall-clock ms at the current offset, for the
 * cross-tab share (tabs don't share a monotonic origin). Floored so a value
 * adopted from the share doesn't read back as newer than the stored one.
 * @param at a monoNow() stamp
 */
function toWall(at: number): number {
  return Math.floor(Date.now() - (monoNow() - at))
}

/**
 * Converts a wall-clock ms value (from the cross-tab share) to a monoNow() stamp.
 * @param at wall-clock ms
 */
function fromWall(at: number): number {
  return monoNow() - (Date.now() - at)
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
  // monoNow() stamps. -Infinity so the first touch() always pings and shares
  // (the monotonic clock starts near 0 at page load).
  const lastActivityRef = useRef(Number.NEGATIVE_INFINITY)
  const lastPingRef = useRef(Number.NEGATIVE_INFINITY)
  // When touch() last shared activity, so a mousemove storm writes at most once a second.
  const lastPublishRef = useRef(Number.NEGATIVE_INFINITY)
  // A "Stay logged in" renewal is in flight; the button is disabled meanwhile.
  const [renewing, setRenewing] = useState(false)
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
   * Shares this tab's latest activity if it's newer than the stored value. Never
   * writes an older value over a newer one from another tab (a throttled tab
   * would otherwise regress the shared clock), and re-writes ours whenever the
   * store holds something older — e.g. a racing tab's late write, or our own
   * value hidden as "future" after a wall-clock rollback.
   * @param shared the latest shared activity, already read by the caller
   */
  const publish = useCallback((shared = readSharedActivity()) => {
    const ours = toWall(lastActivityRef.current)
    if (ours > shared) writeSharedActivity(ours)
  }, [])

  /**
   * Records activity and refreshes the server session (throttled) so the
   * server-side idle clock tracks actual use; without this the server would
   * expire an actively-used session at the idle window.
   * @param forceShare share the activity regardless of the once-a-second
   * share throttle (explicit "Stay logged in")
   */
  const touch = useCallback((forceShare = false) => {
    const now = monoNow()
    lastActivityRef.current = now
    if (now - lastPingRef.current > ACTIVITY_PING_MS) {
      lastPingRef.current = now
      void updateRef.current()
    }
    // Share now (at most once a second) rather than on the next check: a
    // just-foregrounded tab's interval may still be throttled, and another tab
    // must not time out on the old stamp first.
    if (forceShare || now - lastPublishRef.current >= CHECK_MS) {
      lastPublishRef.current = now
      publish()
    }
  }, [publish])

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
      // Adopt newer activity from another tab onto our monotonic clock, so a
      // later wall-clock step can't age or rejuvenate it; else share ours.
      if (shared > toWall(lastActivityRef.current)) lastActivityRef.current = fromWall(shared)
      else publish(shared)
      const idle = monoNow() - lastActivityRef.current
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
    touch() // also shares the new tab's activity at once
    const interval = setInterval(check, CHECK_MS)
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))

    return () => {
      clearInterval(interval)
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { passive: true } as EventListenerOptions))
    }
  }, [idleMs, touch, publish])

  /**
   * Renews the server session, and only on success dismisses the warning and
   * restarts the idle window. A null or failed renewal keeps the warning and
   * the old deadline: the server session was not extended.
   */
  async function stayLoggedIn() {
    setRenewing(true)
    let session = null
    try {
      session = await updateRef.current()
    } catch {
      // Treated like a null session below.
    } finally {
      setRenewing(false)
    }
    if (!session) return
    warningRef.current = false
    setShowWarning(false)
    lastPingRef.current = monoNow() // just renewed: touch() needn't ping again
    touch(true)
  }

  if (!showWarning) return null

  return (
    <div role="alert" aria-live="assertive" className="fixed bottom-4 right-4 z-50 rounded-lg border border-gold bg-gold/10 px-4 py-3 text-sm text-foreground shadow-lg">
      Session expiring in {WARN_MS / 60000} minute{WARN_MS / 60000 !== 1 ? "s" : ""} due to inactivity.{" "}
      <button
        className="font-semibold underline disabled:opacity-60"
        disabled={renewing}
        onClick={() => { void stayLoggedIn() }}
      >
        Stay logged in
      </button>
    </div>
  )
}
