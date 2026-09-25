"use client"

import { useRef, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CUSTOM_QUESTION_TYPES, QUESTION_PRESETS, parseTicketTypeNames, type CustomQuestionType } from "@/lib/eventQuestions"

// id is stable across edits — submitted as customQuestion.<i>.id so
// deleting/reordering a question never shifts a later question into a
// different id, which used to silently relabel historical
// Registration.customAnswers (keyed by id). Optional on the prop type: a
// freshly-added row gets one client-side; an existing row loaded from the DB
// always has one.
type QuestionRow = { id?: string; label: string; type: CustomQuestionType; required: boolean; options: string; body: string; ticketTypeNames: string; scope: "order" | "attendee"; allowOther: boolean; statements?: string }
// _key is a stable client-only React key (not submitted) so removing/reordering
// a row doesn't reattach input state to the wrong row, as index keys would.
type Row = QuestionRow & { _key: string }

type Props = {
  initial: QuestionRow[]
  ticketTypeNames: string[]
}

const OPTIONS_TYPES: CustomQuestionType[] = ["select", "radio", "checkbox"]

function humanLabel(type: CustomQuestionType): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

// Ticket-type scoping is stored/matched by raw name, so renaming a
// ticket type in the same edit session leaves a row's stored selection
// pointing at the old name. Reconcile against the *current* available names
// on every render: only names that still exist are ever submitted, and any
// dropped ("dangling") name surfaces as a visible warning rather than being
// silently kept in the hidden field.
function reconcileTicketNames(raw: string, available: string[]) {
  const all = parseTicketTypeNames(raw)
  return {
    selected: all.filter((s) => available.includes(s)),
    dangling: all.filter((s) => !available.includes(s)),
  }
}

export function CustomQuestionsEditor({ initial, ticketTypeNames: availableTicketNames }: Props) {
  // Index-derived keys for initial rows (pure initializer); ref counter only for
  // rows added in the handler. Keys travel with the row object, so remove/reorder
  // keeps row identity stable. See TicketTypesEditor for the same pattern.
  const keySeq = useRef(0)
  const [rows, setRows] = useState<Row[]>(
    () => initial.map((r, i) => ({ ...r, id: r.id ?? crypto.randomUUID(), _key: `cq-init-${i}` }))
  )

  const add = () => setRows(r => [...r, { id: crypto.randomUUID(), label: "", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false, statements: "", _key: `cq-new-${keySeq.current++}` }])
  const remove = (i: number) => setRows(r => r.filter((_, idx) => idx !== i))
  const update = <K extends keyof QuestionRow>(i: number, field: K, value: QuestionRow[K]) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: value } : row))
  const addPreset = (preset: typeof QUESTION_PRESETS[number]) =>
    setRows(r => [...r, {
      id: crypto.randomUUID(),
      label: preset.question.label,
      type: preset.question.type,
      required: preset.question.required,
      options: preset.question.options ? preset.question.options.join(", ") : "",
      body: preset.question.body ?? "",
      ticketTypeNames: "",
      scope: "order",
      allowOther: false,
      _key: `cq-new-${keySeq.current++}`,
    }])

  return (
    <div>
      {QUESTION_PRESETS.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {QUESTION_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={row._key} className="flex flex-col gap-2 bg-muted rounded-lg p-3 border border-border">
            <input type="hidden" name={`customQuestion.${i}.id`} value={row.id} />
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                aria-label={`Question label (row ${i + 1})`}
                name={`customQuestion.${i}.label`}
                value={row.label}
                onChange={e => update(i, "label", e.target.value)}
                placeholder="Question label"
                className="flex-1"
              />
              <Select
                name={`customQuestion.${i}.type`}
                value={row.type}
                onValueChange={(v: string) => update(i, "type", v as CustomQuestionType)}
              >
                <SelectTrigger aria-label={`Question type (row ${i + 1})`} className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_QUESTION_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{humanLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label htmlFor={`customQuestion.${i}.required`} className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
                <Checkbox
                  id={`customQuestion.${i}.required`}
                  name={`customQuestion.${i}.required`}
                  checked={row.required}
                  value="true"
                  onCheckedChange={(c: boolean | "indeterminate") => update(i, "required", c === true)}
                />
                Required
              </label>
              <label htmlFor={`customQuestion.${i}.scope`} className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
                <Checkbox
                  id={`customQuestion.${i}.scope`}
                  name={`customQuestion.${i}.scope`}
                  value="attendee"
                  checked={row.scope === "attendee"}
                  onCheckedChange={(c: boolean | "indeterminate") => update(i, "scope", c === true ? "attendee" : "order")}
                />
                Per attendee
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove question (row ${i + 1})`}
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X />
              </Button>
            </div>
            {OPTIONS_TYPES.includes(row.type) && (
              <>
                <Input
                  aria-label={`Options for question ${i + 1}`}
                  name={`customQuestion.${i}.options`}
                  value={row.options}
                  onChange={e => update(i, "options", e.target.value)}
                  placeholder="Options comma-separated, e.g. Vegetarian, Vegan, None"
                />
                <label htmlFor={`customQuestion.${i}.allowOther`} className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
                  <Checkbox
                    id={`customQuestion.${i}.allowOther`}
                    name={`customQuestion.${i}.allowOther`}
                    value="true"
                    checked={row.allowOther}
                    onCheckedChange={(c: boolean | "indeterminate") => update(i, "allowOther", c === true)}
                  />
                  Allow &ldquo;Other&rdquo; write-in
                </label>
              </>
            )}
            {row.type === "consent" && (
              <>
                <textarea
                  aria-label={`Consent body for question ${i + 1}`}
                  name={`customQuestion.${i}.body`}
                  value={row.body}
                  onChange={e => update(i, "body", e.target.value)}
                  placeholder="Consent statement text"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                />
                <textarea
                  aria-label={`Consent statements for question ${i + 1}`}
                  name={`customQuestion.${i}.statements`}
                  value={row.statements ?? ""}
                  onChange={e => update(i, "statements", e.target.value)}
                  placeholder="One statement per line — each gets its own tick"
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                />
              </>
            )}
            {availableTicketNames.length > 0 && (() => {
              const { selected, dangling } = reconcileTicketNames(row.ticketTypeNames, availableTicketNames)
              return (
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>Show only for:</span>
                  {availableTicketNames.map((tn) => {
                    const checked = selected.includes(tn)
                    return (
                      <label key={tn} className="flex items-center gap-1">
                        <Checkbox
                          aria-label={tn}
                          checked={checked}
                          onCheckedChange={() => {
                            const next = checked ? selected.filter((s) => s !== tn) : [...selected, tn]
                            update(i, "ticketTypeNames", JSON.stringify(next))
                          }}
                        />
                        {tn}
                      </label>
                    )
                  })}
                  {dangling.length > 0 && (
                    <span role="alert" className="text-xs text-destructive">
                      ⚠ Scoping lost — renamed/removed ticket type &ldquo;{dangling.join(", ")}&rdquo;, please re-select
                    </span>
                  )}
                  <input type="hidden" name={`customQuestion.${i}.ticketTypeNames`} value={JSON.stringify(selected)} />
                </div>
              )
            })()}
          </div>
        ))}
      </div>
      <Button type="button" variant="link" size="sm" onClick={add} className="mt-2 px-0">
        + Add question
      </Button>
    </div>
  )
}
