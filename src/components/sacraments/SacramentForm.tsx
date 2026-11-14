"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { SpousePicker, type PickedSpouse } from "@/components/sacraments/SpousePicker"
import { SACRAMENT_LABEL } from "@/lib/sacraments"
import { SacramentType } from "@/lib/generated/prisma/enums"
import type { SacramentCreateResult } from "@/lib/actions/sacrament"
import type { ActionResultWithSuccess } from "@/lib/actions/types"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

/** Values of an existing entry, for the edit form. */
export type SacramentFormValues = {
  type: SacramentType
  registerNo: string
  date: string
  place: string
  ministerName: string | null
  /** Linked CRM spouse, if any (can be changed or removed on edit). */
  spouse: { id: number; firstName: string; lastName: string } | null
  spouseName: string | null
  godparents: string | null
  notes: string | null
  updatedAt: string
}

type Result = SacramentCreateResult | ActionResultWithSuccess

/** Action state: the action's result plus the text fields that were submitted. */
type Outcome = { result: Result; values: Record<string, string> }

type Props = Readonly<{
  /** Person the entry is for (create only). */
  personId?: number
  /** Chosen rite pre-selected on create. */
  defaultType?: SacramentType
  /** Present on edit: the rite and person are then fixed. */
  record?: SacramentFormValues
  action:
    | ((prev: SacramentCreateResult | undefined, formData: FormData) => Promise<SacramentCreateResult>)
    | ((prev: ActionResultWithSuccess, formData: FormData) => Promise<ActionResultWithSuccess>)
}>

/**
 * Create/edit form for a sacramental register entry. Spouse fields show for a
 * marriage only (the action rejects them for other rites): pick a CRM member,
 * or type a name for someone outside the CRM. On edit the rite is read-only and
 * an `updatedAt` hidden field guards against overwriting a newer save.
 *
 * React 19 resets the form's uncontrolled fields after every action, so the
 * submitted text is kept in the action state and used as each field's
 * defaultValue: a failed save keeps what the user typed. A created entry opens
 * on its detail page, and the submit button stays disabled from the moment the
 * create succeeds, so a double click cannot number a second entry.
 */
export function SacramentForm({ personId, defaultType, record, action }: Props) {
  const router = useRouter()
  const run = async (_prev: Outcome | undefined, formData: FormData): Promise<Outcome> => {
    const values: Record<string, string> = {}
    for (const [k, v] of formData.entries()) if (typeof v === "string") values[k] = v
    const result = await (action as (prev: undefined, fd: FormData) => Promise<Result>)(undefined, formData)
    return { result, values }
  }
  const [state, formAction, isPending] = useActionState(run, undefined)
  const [type, setType] = useState<SacramentType>(record?.type ?? defaultType ?? SacramentType.BAPTISM)
  const [spouse, setSpouse] = useState<PickedSpouse | null>(
    record?.spouse ? { id: record.spouse.id, name: `${record.spouse.firstName} ${record.spouse.lastName}` } : null,
  )
  const isMarriage = type === SacramentType.MARRIAGE
  const result = state?.result
  const createdId = result && "id" in result ? result.id : null

  /** Field default: what was last submitted, else the entry's stored value. */
  const val = (name: string, stored: string | null | undefined): string => state?.values[name] ?? stored ?? ""

  useEffect(() => {
    if (createdId !== null) router.push(`/sacraments/${createdId}`)
  }, [createdId, router])

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <FormFeedback state={result && "id" in result ? null : result} />
      {personId !== undefined && <input type="hidden" name="personId" value={personId} />}
      {record && <input type="hidden" name="updatedAt" value={record.updatedAt} />}

      {record ? (
        <p className="text-sm text-muted-foreground">
          {SACRAMENT_LABEL[record.type]} · {record.registerNo}. The rite and person cannot change; delete and re-enter the
          entry to correct them.
        </p>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="type">Sacrament</Label>
          <select
            id="type"
            name="type"
            className={SELECT_CLASS}
            value={type}
            onChange={(e) => setType(e.target.value as SacramentType)}
          >
            {Object.values(SacramentType).map((t) => (
              <option key={t} value={t}>{SACRAMENT_LABEL[t]}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" defaultValue={val("date", record?.date)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="place">Place</Label>
          <Input id="place" name="place" defaultValue={val("place", record?.place)} maxLength={200} required />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ministerName">Minister (optional)</Label>
        <Input id="ministerName" name="ministerName" defaultValue={val("ministerName", record?.ministerName)} maxLength={200} />
      </div>

      {isMarriage && (
        <div className="space-y-2">
          <Label>Spouse</Label>
          {spouse ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input type="hidden" name="spouseId" value={spouse.id} />
              <span>{spouse.name}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setSpouse(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <SpousePicker onPick={setSpouse} />
              <div className="space-y-1">
                <Label htmlFor="spouseName">Or, if the spouse is not in the CRM, their name</Label>
                <Input id="spouseName" name="spouseName" defaultValue={val("spouseName", record?.spouseName)} maxLength={200} />
              </div>
            </>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="godparents">{type === SacramentType.BAPTISM ? "Godparents" : "Sponsors / witnesses"} (optional)</Label>
        <Input id="godparents" name="godparents" defaultValue={val("godparents", record?.godparents)} maxLength={500} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Notes (optional, not printed)</Label>
        <Textarea id="notes" name="notes" defaultValue={val("notes", record?.notes)} maxLength={2000} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending || createdId !== null}>
          {isPending ? "Saving…" : record ? "Save changes" : "Add to register"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
