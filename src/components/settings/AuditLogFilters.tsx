"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function AuditLogFilters() {
  const router = useRouter()
  const sp = useSearchParams()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest URL params. A debounced push runs from an older render's closure; reading
  // through this ref means it builds on the current URL (e.g. after back/forward) instead
  // of restoring the filters it captured.
  const spRef = useRef(sp)
  useEffect(() => { spRef.current = sp }, [sp])

  // Controlled inputs. A same-segment soft nav (e.g. Clear) reuses this Client
  // Component instance, so defaultValue would never re-read — the inputs would
  // keep showing stale values after the URL clears. Drive them from state and
  // reset that state explicitly on Clear.
  const [actionVal, setActionVal] = useState(sp.get("action") ?? "")
  const [fromVal, setFromVal] = useState(sp.get("from") ?? "")
  const [toVal, setToVal] = useState(sp.get("to") ?? "")
  // True while a typed action is waiting on its debounce (not yet in the URL).
  const [actionPending, setActionPending] = useState(false)

  /**
   * Navigate to the audit log with one filter key set/cleared. Non-action pushes also
   * carry the current action input so a still-debouncing action isn't dropped.
   */
  const push = useCallback(
    (key: string, value: string) => {
      // An immediate nav (date change, or the debounced action firing) supersedes any
      // still-pending debounced push — otherwise a queued action push with a stale URL
      // closure fires after and drops the just-applied date filter.
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      setActionPending(false)
      const params = new URLSearchParams(spRef.current.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      // A date push cancelled a possibly-pending debounced action push, and `sp` does
      // not have the typed action yet — carry the input's current value so it isn't lost.
      if (key !== "action") {
        if (actionVal) params.set("action", actionVal)
        else params.delete("action")
      }
      params.delete("page")
      router.push(`/settings/audit-log?${params.toString()}`)
    },
    [router, actionVal]
  )

  // Debounce so typing an action filter doesn't fire a navigation per keystroke.
  const debouncedPush = useCallback(
    (key: string, value: string) => {
      if (timer.current) clearTimeout(timer.current)
      setActionPending(true)
      timer.current = setTimeout(() => push(key, value), 350)
    },
    [push]
  )

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Back/forward reuses this instance with a new URL: re-read the inputs from it, or a
  // stale action would show and be re-applied by the next date push. Adjusting state
  // during render (not in an effect) is React's pattern for deriving from a changed
  // input. Skip the action while its debounce is pending so an in-progress edit stays.
  const urlKey = sp.toString()
  const [seenUrl, setSeenUrl] = useState(urlKey)
  if (urlKey !== seenUrl) {
    setSeenUrl(urlKey)
    if (!actionPending) setActionVal(sp.get("action") ?? "")
    setFromVal(sp.get("from") ?? "")
    setToVal(sp.get("to") ?? "")
  }

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <Input
        placeholder="Filter by action (e.g. VIEW_PASTORAL_NOTES)"
        aria-label="Filter audit log by action"
        value={actionVal}
        className="w-72"
        onChange={(e) => {
          setActionVal(e.target.value)
          debouncedPush("action", e.target.value)
        }}
      />
      <Input
        type="date"
        aria-label="From date"
        value={fromVal}
        className="w-44"
        onChange={(e) => {
          setFromVal(e.target.value)
          push("from", e.target.value)
        }}
      />
      <Input
        type="date"
        aria-label="To date"
        value={toVal}
        className="w-44"
        onChange={(e) => {
          setToVal(e.target.value)
          push("to", e.target.value)
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (timer.current) clearTimeout(timer.current)
          timer.current = null
          setActionPending(false)
          setActionVal("")
          setFromVal("")
          setToVal("")
          router.push("/settings/audit-log")
        }}
      >
        Clear
      </Button>
    </div>
  )
}
