"use client"

import { useEffect, useRef, useState } from "react"
import { useNonce } from "@/components/NonceProvider"
import { FormFeedback } from "@/components/ui/FormFeedback"

import { TURNSTILE_SITE_KEY } from "@/lib/appConfig"

// if the CF script/widget never loads (ad-blocker, corporate/school
// firewall, mobile tracking protection), the box stays blank forever and the
// server-side token check permanently blocks submission with no recovery path.
// Give it a generous window before assuming it failed.
export const TURNSTILE_LOAD_TIMEOUT_MS = 9000
export const TURNSTILE_LOAD_FAILED_MESSAGE =
  "Verification didn't load. Check your connection, disable tracking protection, or contact your church administrator."
// Adds the configured church email so a visitor who can't load the widget has a
// real contact, not just "your church administrator".
export const turnstileLoadFailedMessage = (churchEmail?: string): string =>
  churchEmail ? `${TURNSTILE_LOAD_FAILED_MESSAGE.slice(0, -1)} at ${churchEmail}.` : TURNSTILE_LOAD_FAILED_MESSAGE

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}
// Read window.turnstile without a `declare global` — the event RegistrationForm
// already augments Window.turnstile; re-declaring collides.
const getTurnstile = (): TurnstileApi | undefined =>
  (globalThis as unknown as { turnstile?: TurnstileApi }).turnstile

// Renders the Cloudflare Turnstile widget and reports the solved token to the
// parent. No-op (renders nothing) when TURNSTILE_SITE_KEY is unset,
// so local/dev/tests need no configuration. Same explicit-render pattern as the
// membership + event-registration forms.
export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onToken)
  const widgetId = useRef<string | null>(null)
  const mounted = useRef(false)
  const nonce = useNonce()
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => { cb.current = onToken }, [onToken])

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    const mount = () => {
      const ts = getTurnstile()
      if (!ts || !ref.current || ref.current.childElementCount > 0) return
      widgetId.current = ts.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t: string) => cb.current(t),
        "error-callback": () => cb.current(""),
        "expired-callback": () => cb.current(""),
      })
      mounted.current = true
      setLoadFailed(false)
    }
    const cleanupWidget = () => {
      if (widgetId.current) {
        getTurnstile()?.remove(widgetId.current)
        widgetId.current = null
      }
    }
    const timer = window.setTimeout(() => {
      if (!mounted.current) setLoadFailed(true)
    }, TURNSTILE_LOAD_TIMEOUT_MS)
    if (getTurnstile()) {
      mount()
      return () => { window.clearTimeout(timer); cleanupWidget() }
    }
    const existing = document.getElementById("cf-turnstile-script") as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener("load", mount)
      return () => {
        window.clearTimeout(timer)
        existing.removeEventListener("load", mount)
        cleanupWidget()
      }
    }
    const s = document.createElement("script")
    s.id = "cf-turnstile-script"
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    s.async = true
    s.defer = true
    if (nonce) s.nonce = nonce
    document.head.appendChild(s)
    s.addEventListener("load", mount)
    return () => {
      window.clearTimeout(timer)
      s.removeEventListener("load", mount)
      cleanupWidget()
    }
  }, [nonce])

  if (!TURNSTILE_SITE_KEY) return null
  return (
    <div>
      <div ref={ref} className="cf-turnstile mt-2" />
      <FormFeedback state={{ error: loadFailed ? TURNSTILE_LOAD_FAILED_MESSAGE : null }} className="mt-2" />
    </div>
  )
}
