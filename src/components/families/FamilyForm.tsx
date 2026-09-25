"use client"

import { useActionState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ActionResult } from "@/lib/actions/types"

type Family = {
  id?: number
  name?: string
  memberNo?: string | null
  address?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  homePhone?: string | null
  status?: string
  joinedDate?: Date | null
  marriageDate?: Date | null
  monthlyDues?: number | null
  notes?: string | null
  // Last-seen version for optimistic concurrency. Serialized across the
  // RSC boundary as a Date or ISO string depending on Next's transport.
  updatedAt?: Date | string
}

export function FamilyForm({
  action,
  family,
  defaultDues,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>
  family?: Family
  defaultDues?: number | null
}) {
  const [state, formAction, isPending] = useActionState(action, undefined)

  return (
    <form action={formAction} className="space-y-6 max-w-lg">
      {state?.error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      {/* Optimistic-concurrency token — the row's last-seen version, so
          the server can reject a save that would clobber a concurrent edit. */}
      {family?.updatedAt && (
        <input
          type="hidden"
          name="updatedAt"
          value={typeof family.updatedAt === "string" ? family.updatedAt : family.updatedAt.toISOString()}
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Family name *</Label>
        <Input id="name" name="name" defaultValue={family?.name ?? ""} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="memberNo">Member No</Label>
        <Input id="memberNo" name="memberNo" defaultValue={family?.memberNo ?? ""} placeholder="Blank for non-members" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" defaultValue={family?.address ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="suburb">Suburb</Label>
          <Input id="suburb" name="suburb" defaultValue={family?.suburb ?? ""} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="state">State</Label>
          <Input id="state" name="state" defaultValue={family?.state ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postcode">Postcode</Label>
          <Input id="postcode" name="postcode" defaultValue={family?.postcode ?? ""} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="homePhone">Home phone</Label>
        <Input id="homePhone" name="homePhone" defaultValue={family?.homePhone ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <Select name="status" defaultValue={family?.status ?? "ACTIVE"}>
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="VISITOR">Visitor</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="joinedDate">Joined date</Label>
          <Input
            id="joinedDate"
            name="joinedDate"
            type="date"
            defaultValue={family?.joinedDate ? family.joinedDate.toISOString().slice(0, 10) : ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="marriageDate">Marriage date</Label>
          <Input
            id="marriageDate"
            name="marriageDate"
            type="date"
            defaultValue={family?.marriageDate ? family.marriageDate.toISOString().slice(0, 10) : ""}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="monthlyDues">Monthly subscription dues</Label>
        <Input
          id="monthlyDues"
          name="monthlyDues"
          type="number"
          min="0"
          step="0.01"
          defaultValue={family ? (family.monthlyDues != null ? String(family.monthlyDues) : "") : defaultDues != null ? String(defaultDues) : ""}
          placeholder="Blank for non-members"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={family?.notes ?? ""} rows={3} />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" asChild>
          <Link href={family?.id ? `/families/${family.id}` : "/families"}>Cancel</Link>
        </Button>
      </div>
    </form>
  )
}
