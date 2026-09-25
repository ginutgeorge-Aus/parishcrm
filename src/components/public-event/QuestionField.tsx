"use client"

import { useState } from "react"
import type { CustomAnswer, CustomQuestion } from "@/lib/eventQuestions"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const OTHER = "__other__"

// Options as rendered. When the write-in affordance is on, drop a literal
// "Other" option (case-insensitive) so a preset's "Other" and the synthetic
// write-in row don't both appear and both store the string "Other".
function visibleOptions(q: CustomQuestion): string[] {
  const opts = q.options ?? []
  return q.allowOther === true ? opts.filter(o => o.trim().toLowerCase() !== "other") : opts
}

export type QuestionFieldProps = {
  q: CustomQuestion
  idPrefix: string
  value: CustomAnswer | undefined
  onChange: (value: CustomAnswer) => void
}

function OtherText({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      id={id}
      aria-label="Other (please specify)"
      className="mt-1"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  )
}

function RadioField({ q, idPrefix, value, onChange }: QuestionFieldProps) {
  const labelClass = "text-sm font-medium text-foreground"
  const opts = visibleOptions(q)
  const strVal = typeof value === "string" ? value : ""
  const derivedOther = q.allowOther === true && strVal !== "" && !opts.includes(strVal)
  const [otherMode, setOtherMode] = useState(derivedOther)
  const showOther = q.allowOther === true && (otherMode || derivedOther)
  return (
    <fieldset key={q.id} className="border-0 m-0 p-0 min-w-0">
      <legend className={labelClass}>{`${q.label}${q.required ? " *" : ""}`}</legend>
      <div className="flex flex-col gap-1 mt-1">
        {opts.map(opt => (
          <label key={opt} className="flex items-center gap-2 py-2.5 text-sm text-foreground">
            <input
              type="radio" className="h-5 w-5 shrink-0" name={`${idPrefix}-${q.id}`} value={opt}
              checked={!showOther && strVal === opt}
              onChange={() => { setOtherMode(false); onChange(opt) }}
            />
            {opt}
          </label>
        ))}
        {q.allowOther && (
          <label className="flex items-center gap-2 py-2.5 text-sm text-foreground">
            <input
              type="radio" className="h-5 w-5 shrink-0" name={`${idPrefix}-${q.id}`}
              aria-label="Other"
              checked={showOther}
              onChange={() => { setOtherMode(true); onChange("") }}
            />
            Other
          </label>
        )}
        {showOther && (
          <OtherText id={`${idPrefix}-${q.id}-other`} value={strVal} onChange={onChange} />
        )}
      </div>
    </fieldset>
  )
}

function CheckboxField({ q, idPrefix, value, onChange }: QuestionFieldProps) {
  const labelClass = "text-sm font-medium text-foreground"
  const opts = visibleOptions(q)
  const arr = Array.isArray(value) ? (value as string[]) : []
  const known = arr.filter(v => opts.includes(v))
  const derivedWriteIn = q.allowOther ? arr.find(v => !opts.includes(v)) : undefined
  // Hold the write-in text locally so it doesn't visually clear when the typed
  // value happens to equal a predefined option (which the flat array would
  // otherwise absorb into `known`, blanking the box).
  const [writeInText, setWriteInText] = useState(derivedWriteIn ?? "")
  const [otherMode, setOtherMode] = useState(derivedWriteIn !== undefined)
  const showOther = q.allowOther === true && otherMode
  // A write-in equal to a configured option collapses into that option — never
  // emitted twice. `absorbed` marks that option as present only because
  // of the write-in (not ticked), so editing/clearing the write-in or leaving
  // Other drops it instead of leaving it falsely selected.
  const [absorbed, setAbsorbed] = useState(false)
  const ticked = () => (absorbed ? known.filter(v => v !== writeInText.trim()) : known)
  const emit = (explicit: string[], text: string, other: boolean) => {
    const t = other ? text.trim() : ""
    const absorb = !!t && !explicit.includes(t) && opts.includes(t)
    setAbsorbed(absorb)
    onChange(t && !explicit.includes(t) ? [...explicit, t] : explicit)
  }
  const setWriteIn = (text: string) => { setWriteInText(text); emit(ticked(), text, true) }
  return (
    <fieldset key={q.id} className="border-0 m-0 p-0 min-w-0">
      <legend className={labelClass}>{`${q.label}${q.required ? " *" : ""}`}</legend>
      <div className="flex flex-col gap-1 mt-1">
        {opts.map(opt => {
          const checked = known.includes(opt)
          return (
            <label key={opt} className="flex items-center gap-2 py-2.5 text-sm text-foreground">
              <input
                type="checkbox" className="h-5 w-5 shrink-0" value={opt}
                aria-required={q.required || undefined}
                checked={checked}
                onChange={() => {
                  if (!checked) return emit([...ticked(), opt], writeInText, showOther)
                  // Unticking the option the write-in matches must clear the
                  // write-in too, or emit() re-adds it and the box can't be
                  // unchecked.
                  if (showOther && writeInText.trim() === opt) {
                    setWriteInText("")
                    return emit(ticked().filter(v => v !== opt), "", true)
                  }
                  emit(ticked().filter(v => v !== opt), writeInText, showOther)
                }}
              />
              {opt}
            </label>
          )
        })}
        {q.allowOther && (
          <label className="flex items-center gap-2 py-2.5 text-sm text-foreground">
            <input
              type="checkbox" className="h-5 w-5 shrink-0"
              aria-label="Other"
              aria-required={q.required || undefined}
              checked={showOther}
              onChange={() => {
                const next = !otherMode
                setOtherMode(next)
                emit(ticked(), writeInText, next)
              }}
            />
            Other
          </label>
        )}
        {showOther && (
          <OtherText id={`${idPrefix}-${q.id}-other`} value={writeInText} onChange={setWriteIn} />
        )}
      </div>
    </fieldset>
  )
}

function SelectField({ q, idPrefix, value, onChange }: QuestionFieldProps) {
  const inputClass = "w-full mt-1"
  const labelClass = "text-sm font-medium text-foreground"
  const opts = visibleOptions(q)
  const strVal = typeof value === "string" ? value : ""
  const derivedOther = q.allowOther === true && strVal !== "" && !opts.includes(strVal)
  const [otherMode, setOtherMode] = useState(derivedOther)
  const showOther = q.allowOther === true && (otherMode || derivedOther)
  return (
    <div key={q.id}>
      <label htmlFor={`${idPrefix}-${q.id}`} className={labelClass}>{`${q.label}${q.required ? " *" : ""}`}</label>
      <Select
        value={showOther ? OTHER : (strVal || undefined)}
        onValueChange={(v: string) => { if (v === OTHER) { setOtherMode(true); onChange("") } else { setOtherMode(false); onChange(v) } }}
      >
        <SelectTrigger id={`${idPrefix}-${q.id}`} className={inputClass}>
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {opts.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
          {q.allowOther && <SelectItem value={OTHER}>Other</SelectItem>}
        </SelectContent>
      </Select>
      {showOther && (
        <OtherText id={`${idPrefix}-${q.id}-other`} value={strVal} onChange={onChange} />
      )}
    </div>
  )
}

export function QuestionField({ q, idPrefix, value, onChange }: QuestionFieldProps) {
  const inputClass = "w-full mt-1"
  const labelClass = "text-sm font-medium text-foreground"
  const labelText = `${q.label}${q.required ? " *" : ""}`

  switch (q.type) {
    case "textarea":
      return (
        <div key={q.id}>
          <label htmlFor={`${idPrefix}-${q.id}`} className={labelClass}>{labelText}</label>
          <Textarea
            id={`${idPrefix}-${q.id}`}
            required={q.required}
            value={(value as string) ?? ""}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
            rows={3}
          />
        </div>
      )

    case "number":
      return (
        <div key={q.id}>
          <label htmlFor={`${idPrefix}-${q.id}`} className={labelClass}>{labelText}</label>
          <Input
            id={`${idPrefix}-${q.id}`}
            type="number"
            required={q.required}
            value={(value as string) ?? ""}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      )

    case "date":
      return (
        <div key={q.id}>
          <label htmlFor={`${idPrefix}-${q.id}`} className={labelClass}>{labelText}</label>
          <Input
            id={`${idPrefix}-${q.id}`}
            type="date"
            required={q.required}
            value={(value as string) ?? ""}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      )

    case "phone":
      return (
        <div key={q.id}>
          <label htmlFor={`${idPrefix}-${q.id}`} className={labelClass}>{labelText}</label>
          <Input
            id={`${idPrefix}-${q.id}`}
            type="tel"
            inputMode="tel"
            required={q.required}
            value={(value as string) ?? ""}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      )

    case "email":
      return (
        <div key={q.id}>
          <label htmlFor={`${idPrefix}-${q.id}`} className={labelClass}>{labelText}</label>
          <Input
            id={`${idPrefix}-${q.id}`}
            type="email"
            inputMode="email"
            required={q.required}
            value={(value as string) ?? ""}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      )

    case "radio":
      return <RadioField q={q} idPrefix={idPrefix} value={value} onChange={onChange} />

    case "checkbox":
      return <CheckboxField q={q} idPrefix={idPrefix} value={value} onChange={onChange} />

    case "select":
      return <SelectField q={q} idPrefix={idPrefix} value={value} onChange={onChange} />

    case "consent": {
      // Each consent's "agree" text is identical, so name the checkbox by its
      // topic (label + body) via aria-labelledby — otherwise multiple consents
      // are indistinguishable to a screen reader.
      const topicId = `${idPrefix}-${q.id}-topic`
      const bodyId = `${idPrefix}-${q.id}-body`
      const agreeId = `${idPrefix}-${q.id}-agree`

      if (q.statements && q.statements.length > 0) {
        const n = q.statements.length
        const arr = Array.isArray(value) ? (value as boolean[]) : []
        const at = (k: number) => arr[k] === true
        const emit = (k: number, checked: boolean) => {
          const next = Array.from({ length: n + 1 }, (_, idx) => (idx === k ? checked : at(idx)))
          onChange(next)
        }
        return (
          <div key={q.id} className="flex flex-col gap-2">
            <p id={topicId} className="text-sm font-medium text-foreground">{labelText}</p>
            {q.body && (
              <p id={bodyId} className="whitespace-pre-wrap text-sm text-foreground border border-border rounded-lg p-3 bg-muted">{q.body}</p>
            )}
            {q.statements.map((s, k) => {
              const sId = `${idPrefix}-${q.id}-s${k}`
              return (
                <label key={k} className="flex items-start gap-2 py-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 mt-0.5"
                    required={q.required}
                    aria-labelledby={sId}
                    checked={at(k)}
                    onChange={e => emit(k, e.target.checked)}
                  />
                  <span id={sId} className="whitespace-pre-wrap">{s}</span>
                </label>
              )
            })}
            <label className="flex items-center gap-2 py-2.5 text-sm text-foreground border-t border-border pt-3">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0"
                required={q.required}
                aria-labelledby={`${topicId} ${agreeId}`}
                checked={at(n)}
                onChange={e => emit(n, e.target.checked)}
              />
              <span id={agreeId}>I have read and agree to the above</span>
            </label>
          </div>
        )
      }

      return (
        <div key={q.id} className="flex flex-col gap-2">
          <p id={topicId} className="text-sm font-medium text-foreground">{labelText}</p>
          {q.body && (
            <p id={bodyId} className="whitespace-pre-wrap text-sm text-foreground border border-border rounded-lg p-3 bg-muted">{q.body}</p>
          )}
          <label className="flex items-center gap-2 py-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0"
              required={q.required}
              aria-labelledby={`${topicId}${q.body ? ` ${bodyId}` : ""} ${agreeId}`}
              checked={(value as boolean) === true}
              onChange={e => onChange(e.target.checked)}
            />
            <span id={agreeId}>I have read and agree to the above</span>
          </label>
        </div>
      )
    }

    default: // text
      return (
        <div key={q.id}>
          <label htmlFor={`${idPrefix}-${q.id}`} className={labelClass}>{labelText}</label>
          <Input
            id={`${idPrefix}-${q.id}`}
            required={q.required}
            value={(value as string) ?? ""}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
        </div>
      )
  }
}
