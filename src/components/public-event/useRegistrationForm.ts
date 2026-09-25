"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useNonce } from "@/components/NonceProvider"
import { isQuestionApplicable, isAttendeeScoped } from "@/lib/eventQuestions"
import { startEventCheckout } from "@/lib/actions/eventCheckout"
import { focusFirstInvalidField } from "@/lib/formFocus"
import { TURNSTILE_LOAD_TIMEOUT_MS } from "@/components/public/TurnstileWidget"
import {
  allConsentChecked,
  allRequiredChoicesMade,
  allAttendeeRequiredAnswered,
  allNamesFilled,
  computePricing,
} from "@/lib/registrationFormValidation"
import type { AnswerValue } from "@/lib/registrationFormValidation"
import type { CustomQuestionType } from "@/lib/eventQuestions"

// Optional Cloudflare Turnstile. The widget renders only when a site
// key is configured at build time; otherwise the form behaves exactly as before
// (honeypot + timing token). Server verification is the real gate — this is UX.
import { TURNSTILE_SITE_KEY } from "@/lib/appConfig"

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

type TicketType = { id: number; name: string; price: number; capacity: number | null }
type CustomQuestion = { id: string; label: string; type: CustomQuestionType; required: boolean; options?: string[]; body?: string; ticketTypeNames?: string[]; scope?: "order" | "attendee"; statements?: string[] }
type SoldMap = Record<number, number>

export type RegistrationFormProps = {
  slug: string
  ticketTypes: TicketType[]
  soldCounts: SoldMap
  customQuestions: CustomQuestion[]
  allSoldOut: boolean
  formToken: string
  onlinePaymentEnabled?: boolean
  stripeConfigured?: boolean
  passCardFee?: boolean
  cardFeePct?: number
  cardFeeFixedCents?: number
  tieredPricingEnabled?: boolean
  familyPricingTiers?: number[]
  familyWaiverEnabled?: boolean
  churchEmail?: string
}

export function useRegistrationForm({
  slug,
  ticketTypes,
  customQuestions,
  formToken,
  onlinePaymentEnabled = false,
  stripeConfigured = false,
  passCardFee = false,
  cardFeePct = 0,
  cardFeeFixedCents = 0,
  tieredPricingEnabled = false,
  familyPricingTiers = [],
  familyWaiverEnabled = false,
}: RegistrationFormProps) {
  const router = useRouter()
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [names, setNames] = useState<Record<number, string[]>>({})
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  // attendeeAnswers[ttId][attendeeIndex][questionId] = answer
  const [attendeeAnswers, setAttendeeAnswers] = useState<Record<number, Array<Record<string, AnswerValue>>>>({})
  // Honeypot: hidden from real users; scripted bots tend to fill it.
  const [website, setWebsite] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Pay-now (Stripe) vs pay-later (bank transfer). Defaults to "bank" so the
  // form behaves exactly as before when the radio isn't shown.
  const [method, setMethod] = useState<"card" | "bank">("bank")
  // Turnstile: empty until the widget solves; only gates submit when enabled.
  const [turnstileToken, setTurnstileToken] = useState("")
  // true once the load timeout elapses with no widget ever mounted
  // (ad-blocker/firewall/tracking protection) — distinct from "not solved yet".
  const [turnstileLoadFailed, setTurnstileLoadFailed] = useState(false)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const turnstileMounted = useRef(false)
  const nonce = useNonce()

  // Load Turnstile's api.js (explicit render) once and mount the widget. The
  // script carries the CSP nonce so it loads under strict-dynamic.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    const mount = () => {
      if (!window.turnstile || !turnstileRef.current || turnstileRef.current.childElementCount > 0) return
      window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t: string) => setTurnstileToken(t),
        "error-callback": () => setTurnstileToken(""),
        "expired-callback": () => setTurnstileToken(""),
      })
      turnstileMounted.current = true
      setTurnstileLoadFailed(false)
    }
    const timer = window.setTimeout(() => {
      if (!turnstileMounted.current) setTurnstileLoadFailed(true)
    }, TURNSTILE_LOAD_TIMEOUT_MS)
    if (window.turnstile) { mount(); return () => window.clearTimeout(timer) }
    const existing = document.getElementById("cf-turnstile-script") as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener("load", mount)
      return () => { window.clearTimeout(timer); existing.removeEventListener("load", mount) }
    }
    const s = document.createElement("script")
    s.id = "cf-turnstile-script"
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    s.async = true
    s.defer = true
    if (nonce) s.nonce = nonce
    s.addEventListener("load", mount)
    document.head.appendChild(s)
    return () => { window.clearTimeout(timer); s.removeEventListener("load", mount) }
  }, [nonce])

  // When Turnstile is off (no site key) this is always true — no gating.
  const turnstileSolved = !TURNSTILE_SITE_KEY || turnstileToken.length > 0

  const totalTickets = Object.values(quantities).reduce((s, n) => s + n, 0)

  const selectedTicketNames = new Set(
    ticketTypes.filter((tt) => (quantities[tt.id] ?? 0) > 0).map((tt) => tt.name)
  )
  const applicableQuestions = customQuestions.filter((q) => isQuestionApplicable(q, selectedTicketNames))

  // Split into order-level vs attendee-scoped
  const orderQuestions = applicableQuestions.filter(q => !isAttendeeScoped(q))

  const consentChecked = allConsentChecked(orderQuestions, answers)
  const requiredChoicesMade = allRequiredChoicesMade(orderQuestions, answers)
  const attendeeRequiredAnswered = allAttendeeRequiredAnswered(ticketTypes, quantities, customQuestions, attendeeAnswers)
  const namesFilled = allNamesFilled(ticketTypes, quantities, names)

  const { totalAmount, tiered, overMax, showFee, feeCents } = computePricing({
    ticketTypes, quantities, tieredPricingEnabled, familyPricingTiers,
    familyWaiverEnabled, passCardFee, method, cardFeePct, cardFeeFixedCents,
  })

  // Only offer the online-payment choice when the event opts in, Stripe is
  // actually configured server-side, and there's something to charge.
  const showMethodChoice = onlinePaymentEnabled && stripeConfigured && totalAmount > 0

  const ticketSummary = ticketTypes
    .filter(tt => (quantities[tt.id] ?? 0) > 0)
    .map(tt => `${quantities[tt.id]} ${tt.name}`)
    .join(" + ")

  // the submit button is gated on several conditions. Once a ticket is
  // selected, spell out which requirements are still unmet so a filled-but-one-
  // field-short visitor isn't left staring at a silently-disabled button.
  const submitBlockers: string[] = []
  if (totalTickets > 0) {
    if (!namesFilled) submitBlockers.push("Enter a name for each attendee")
    if (!consentChecked) submitBlockers.push("Tick the required consent box(es)")
    if (!requiredChoicesMade) submitBlockers.push("Answer the required questions")
    if (!attendeeRequiredAnswered) submitBlockers.push("Complete the required attendee questions")
    if (!turnstileSolved) submitBlockers.push("Complete the verification")
    if (overMax && tiered && !tiered.ok) submitBlockers.push(`This event allows a maximum of ${tiered.maxAttendees} registrants per registration`)
  }

  // Gate submit on requirements, but keep the button focusable (aria-disabled,
  // not native disabled) so keyboard/SR users can reach it and read why.
  const requirementsUnmet =
    totalTickets === 0 || !namesFilled || !consentChecked ||
    !requiredChoicesMade || !attendeeRequiredAnswered || !turnstileSolved || overMax

  function handleQuantityChange(id: number, qty: number) {
    setQuantities(prev => ({ ...prev, [id]: qty }))
    // Resize this type's name array to qty: keep typed names on increase,
    // drop trailing entries on decrease.
    setNames(prev => {
      const current = prev[id] ?? []
      const next = Array.from({ length: qty }, (_, i) => current[i] ?? "")
      return { ...prev, [id]: next }
    })
    // Resize attendeeAnswers parallel to names
    setAttendeeAnswers(prev => {
      const current = prev[id] ?? []
      const next = Array.from({ length: qty }, (_, i) => current[i] ?? {})
      return { ...prev, [id]: next }
    })
  }

  function handleNameChange(id: number, index: number, value: string) {
    setNames(prev => {
      const current = [...(prev[id] ?? [])]
      current[index] = value
      return { ...prev, [id]: current }
    })
  }

  function handleAttendeeAnswerChange(ttId: number, index: number, qid: string, value: AnswerValue) {
    setAttendeeAnswers(prev => {
      const ttAnswers = prev[ttId] ? [...prev[ttId]] : []
      const attendee = ttAnswers[index] ? { ...ttAnswers[index] } : {}
      attendee[qid] = value
      ttAnswers[index] = attendee
      return { ...prev, [ttId]: ttAnswers }
    })
  }

  function attendeeQuestions(tt: TicketType): CustomQuestion[] {
    return customQuestions.filter(q => isAttendeeScoped(q) && isQuestionApplicable(q, new Set([tt.name])))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (totalTickets === 0) { setError("Select at least one ticket"); return }
    // Focusable-but-blocked button can fire submit; re-check the gate here.
    if (requirementsUnmet) {
      focusFirstInvalidField(e.currentTarget)
      return
    }

    setSubmitting(true)
    try {
      const applicableAnswers = Object.fromEntries(
        Object.entries(answers).filter(([id]) => orderQuestions.some((q) => q.id === id))
      )
      // Build filtered attendeeAnswers — only applicable attendee-scoped questions per ticket type
      const filteredAttendeeAnswers: Record<number, Array<Record<string, AnswerValue>>> = {}
      for (const tt of ticketTypes) {
        const qty = quantities[tt.id] ?? 0
        if (qty === 0) continue
        const attQuestions = customQuestions.filter(
          q => isAttendeeScoped(q) && isQuestionApplicable(q, new Set([tt.name]))
        )
        filteredAttendeeAnswers[tt.id] = Array.from({ length: qty }, (_, i) => {
          const raw = attendeeAnswers[tt.id]?.[i] ?? {}
          return Object.fromEntries(
            attQuestions.map(q => [q.id, raw[q.id]]).filter(([, v]) => v !== undefined) as [string, AnswerValue][]
          )
        })
      }
      const body = { firstName, lastName, email, phone, tickets: quantities, attendeeNames: names, customAnswers: applicableAnswers, attendeeAnswers: filteredAttendeeAnswers, website, formToken, turnstileToken }

      if (showMethodChoice && method === "card") {
        const result = await startEventCheckout(slug, body)
        if (!result.ok) { setError(result.error); return }
        // Full-page navigation to Stripe Checkout, not a render-time mutation —
        // safe inside this submit event handler.
         
        window.location.href = result.url
        return
      }

      const res = await fetch(`/api/events/${slug}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Registration failed"); return }
      // a duplicate hit no longer echoes the original registration's
      // token (security fix — a second submitter has no proof they're the
      // original), so there's no ref to build a success-page link from.
      if (data.duplicate && !data.ref) {
        setError("You're already registered with this email — check your inbox for your confirmation.")
        return
      }
      const dupParam = data.duplicate ? "&dup=1" : ""
      router.push(`/e/${slug}/success?ref=${encodeURIComponent(data.ref)}${dupParam}`)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return {
    // field state
    firstName, setFirstName, lastName, setLastName, email, setEmail, phone, setPhone,
    website, setWebsite,
    quantities, names, attendeeAnswers, answers, setAnswers,
    method, setMethod,
    // derived
    orderQuestions, totalAmount, ticketSummary, showFee, feeCents, showMethodChoice,
    submitBlockers, requirementsUnmet, submitting, error,
    // turnstile
    turnstileEnabled: !!TURNSTILE_SITE_KEY, turnstileRef, turnstileLoadFailed,
    // handlers
    handleSubmit, handleQuantityChange, handleNameChange, handleAttendeeAnswerChange, attendeeQuestions,
  }
}
