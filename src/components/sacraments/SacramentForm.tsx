"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
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
  /** CRM spouse (kept as-is on edit: it is linked, not typed). */
  spouse: { id: number; firstName: string; lastName: string } | null
  spouseName: string | null
  godparents: string | null
  notes: string | null
  updatedAt: string
}

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
 * marriage only (the action rejects them for other rites). On edit the rite is
 * read-only and an `updatedAt` hidden field guards against overwriting a newer
 * save. A created entry opens on its detail page.
 */
export function SacramentForm({ personId, defaultType, record, action }: Props) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    action as (prev: unknown, formData: FormData) => Promise<SacramentCreateResult | ActionResultWithSuccess>,
    undefined,
  )
  const [type, setType] = useState<SacramentType>(record?.type ?? defaultType ?? SacramentType.BAPTISM)
  const isMarriage = type === SacramentType.MARRIAGE
  const createdId = state && "id" in state ? state.id : null

  useEffect(() => {
    if (createdId !== null) router.push(`/sacraments/${createdId}`)
  }, [createdId, router])

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <FormFeedback state={state && "id" in state ? null : state} />
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
          <Input id="date" name="date" type="date" defaultValue={record?.date} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="place">Place</Label>
          <Input id="place" name="place" defaultValue={record?.place} maxLength={200} required />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ministerName">Minister (optional)</Label>
        <Input id="ministerName" name="ministerName" defaultValue={record?.ministerName ?? ""} maxLength={200} />
      </div>

      {isMarriage &&
        (record?.spouse ? (
          <div className="space-y-1">
            <input type="hidden" name="spouseId" value={record.spouse.id} />
            <p className="text-sm">
              Spouse: {record.spouse.firstName} {record.spouse.lastName}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="spouseName">Spouse name</Label>
            <Input id="spouseName" name="spouseName" defaultValue={record?.spouseName ?? ""} maxLength={200} required />
          </div>
        ))}

      <div className="space-y-1">
        <Label htmlFor="godparents">{type === SacramentType.BAPTISM ? "Godparents" : "Sponsors / witnesses"} (optional)</Label>
        <Input id="godparents" name="godparents" defaultValue={record?.godparents ?? ""} maxLength={500} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Notes (optional, not printed)</Label>
        <Textarea id="notes" name="notes" defaultValue={record?.notes ?? ""} maxLength={2000} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : record ? "Save changes" : "Add to register"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
