"use client"

import { TicketPicker } from "./TicketPicker"
import { QuestionField } from "./QuestionField"
import { Input } from "@/components/ui/input"
import { fmtAUD } from "@/lib/formatting"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { turnstileLoadFailedMessage } from "@/components/public/TurnstileWidget"
import { useRegistrationForm } from "./useRegistrationForm"
import type { RegistrationFormProps } from "./useRegistrationForm"

export function RegistrationForm(props: RegistrationFormProps) {
  const {
    firstName, setFirstName, lastName, setLastName, email, setEmail, phone, setPhone,
    website, setWebsite,
    quantities, names, attendeeAnswers, answers, setAnswers,
    method, setMethod,
    orderQuestions, totalAmount, ticketSummary, showFee, feeCents, showMethodChoice,
    submitBlockers, requirementsUnmet, submitting, error,
    turnstileEnabled, turnstileRef, turnstileLoadFailed,
    handleSubmit, handleQuantityChange, handleNameChange, handleAttendeeAnswerChange, attendeeQuestions,
  } = useRegistrationForm(props)

  const { ticketTypes, soldCounts, allSoldOut } = props

  if (allSoldOut) {
    return (
      <div className="flex-[1.2] bg-card border-t md:border-t-0 md:border-l border-border p-4 sm:p-6 flex items-center justify-center">
        <p className="text-muted-foreground text-center">Sold out</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex-[1.2] bg-card border-t md:border-t-0 md:border-l border-border p-4 sm:p-6 flex flex-col gap-4"
    >
      <h2 className="text-lg font-bold text-foreground">Register for this event</h2>

      {/* Honeypot: off-screen, aria-hidden, not tabbable. Real users
          never see or fill it; scripted bots that fill every input trip it. */}
      <div aria-hidden="true" className="absolute h-px w-px overflow-hidden [clip-path:inset(50%)]">
        <label htmlFor="reg-website">Website</label>
        <Input
          id="reg-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={e => setWebsite(e.target.value)}
        />
      </div>

      <TicketPicker
        ticketTypes={ticketTypes}
        soldCounts={soldCounts}
        quantities={quantities}
        names={names}
        onChange={handleQuantityChange}
        onNameChange={handleNameChange}
        attendeeQuestions={attendeeQuestions}
        attendeeAnswers={attendeeAnswers}
        onAttendeeAnswerChange={handleAttendeeAnswerChange}
      />

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Your Details</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="reg-firstName" className="text-sm font-medium text-foreground">First name *</label>
            <Input
              id="reg-firstName"
              required
              autoComplete="given-name"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="reg-lastName" className="text-sm font-medium text-foreground">Last name *</label>
            <Input
              id="reg-lastName"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="reg-email" className="text-sm font-medium text-foreground">Email *</label>
            <Input
              id="reg-email"
              required
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="reg-phone" className="text-sm font-medium text-foreground">Phone</label>
            <Input
              id="reg-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
      </div>

      {orderQuestions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Additional Info</p>
          <div className="flex flex-col gap-3">
            {orderQuestions.map(q => (
              <QuestionField
                key={q.id}
                q={q}
                idPrefix="reg-q"
                value={answers[q.id]}
                onChange={v => setAnswers(prev => ({ ...prev, [q.id]: v }))}
              />
            ))}
          </div>
        </div>
      )}

      {showMethodChoice && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Payment method</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 min-h-11 text-sm text-foreground">
              <input
                type="radio"
                name="paymentMethod"
                value="card"
                checked={method === "card"}
                onChange={() => setMethod("card")}
              />
              Pay now by card
            </label>
            <label className="flex items-center gap-2 min-h-11 text-sm text-foreground">
              <input
                type="radio"
                name="paymentMethod"
                value="bank"
                checked={method === "bank"}
                onChange={() => setMethod("bank")}
              />
              Pay later by bank transfer
            </label>
          </div>
        </div>
      )}

      {/* Cloudflare Turnstile: renders only when a site key is configured. */}
      {turnstileEnabled && (
        <>
          <div ref={turnstileRef} className="cf-turnstile" />
          <FormFeedback state={{ error: turnstileLoadFailed ? turnstileLoadFailedMessage(props.churchEmail) : null }} className="mt-2" />
        </>
      )}

      <FormFeedback state={{ error }} />

      <div className="sticky bottom-0 md:static bg-card border-t border-border pt-4 mt-auto">
        {showFee && (
          <div className="flex justify-between items-center text-sm text-muted-foreground mb-1">
            <span>Card fee</span>
            <span>{fmtAUD(feeCents / 100)}</span>
          </div>
        )}
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-muted-foreground">
            {ticketSummary || "No tickets selected"}
          </span>
          <span className="font-bold text-foreground text-lg">
            {fmtAUD(showFee ? totalAmount + feeCents / 100 : totalAmount)}
          </span>
        </div>
        {submitBlockers.length > 0 && (
          <div id="reg-blockers" role="status" aria-live="polite" className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium mb-1">Before you can reserve:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {submitBlockers.map(b => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          aria-disabled={requirementsUnmet || submitting}
          aria-describedby={submitBlockers.length > 0 ? "reg-blockers" : undefined}
          aria-busy={submitting}
          className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-semibold text-sm aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
        >
          {submitting ? "Processing…" : "Reserve My Tickets"}
        </button>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Bank transfer details shown on next page
        </p>
      </div>
    </form>
  )
}
