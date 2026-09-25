"use client"

import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import type { ActionResult } from "@/lib/actions/types"

type Person = {
  firstName?: string
  lastName?: string
  middleName?: string | null
  title?: string | null
  suffix?: string | null
  gender?: string | null
  dateOfBirth?: Date | string | null
  role?: string
  classification?: string
  email?: string | null
  mobile?: string | null
  workPhone?: string | null
  homePhone?: string | null
  membershipDate?: Date | null
  baptismDate?: Date | null
  notes?: string | null
  pastoralNotes?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  emailConsent?: boolean | null
  bankingName?: string | null
  // Last-seen version for optimistic concurrency. Serialized across the
  // RSC boundary as a Date or ISO string depending on Next's transport.
  updatedAt?: Date | string
}

function dateStr(d?: Date | string | null) {
  if (!d) return ""
  if (typeof d === "string") return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export function PersonForm({
  action,
  person,
  canSeePastoralNotes,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>
  person?: Person
  canSeePastoralNotes: boolean
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)

  return (
    <form action={formAction} className="space-y-8 max-w-2xl">
      <FormFeedback state={state} />

      {/* Optimistic-concurrency token — the row's last-seen version, so
          the server can reject a save that would clobber a concurrent edit. */}
      {person?.updatedAt && (
        <input
          type="hidden"
          name="updatedAt"
          value={typeof person.updatedAt === "string" ? person.updatedAt : person.updatedAt.toISOString()}
        />
      )}

      {/* Section 1: Basic */}
      <section className="space-y-4">
        <h3 className="font-medium text-foreground border-b pb-1">Basic information</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={person?.title ?? ""} placeholder="Mr / Mrs" />
          </div>
          <div className="space-y-2 col-span-2">
            <Label htmlFor="firstName">First name *</Label>
            <Input id="firstName" name="firstName" defaultValue={person?.firstName ?? ""} required />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="middleName">Middle name</Label>
            <Input id="middleName" name="middleName" defaultValue={person?.middleName ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name *</Label>
            <Input id="lastName" name="lastName" defaultValue={person?.lastName ?? ""} required />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select name="gender" defaultValue={person?.gender ?? ""}>
              <SelectTrigger id="gender"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">Date of birth</Label>
            <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={dateStr(person?.dateOfBirth)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="suffix">Suffix</Label>
            <Input id="suffix" name="suffix" defaultValue={person?.suffix ?? ""} placeholder="Jr / Sr" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="role">Family role</Label>
            <Select name="role" defaultValue={person?.role ?? "OTHER"}>
              <SelectTrigger id="role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HEAD">Head</SelectItem>
                <SelectItem value="SPOUSE">Spouse</SelectItem>
                <SelectItem value="CHILD">Child</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="classification">Classification</Label>
            <Select name="classification" defaultValue={person?.classification ?? "MEMBER"}>
              <SelectTrigger id="classification"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="VISITOR">Visitor</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="STUDENT">Student</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Section 2: Contact */}
      <section className="space-y-4">
        <h3 className="font-medium text-foreground border-b pb-1">Contact</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={person?.email ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile</Label>
            <Input id="mobile" name="mobile" defaultValue={person?.mobile ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workPhone">Work phone</Label>
            <Input id="workPhone" name="workPhone" defaultValue={person?.workPhone ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="homePhone">Home phone</Label>
            <Input id="homePhone" name="homePhone" defaultValue={person?.homePhone ?? ""} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox
            id="emailConsent"
            name="emailConsent"
            defaultChecked={person?.emailConsent ?? true}
          />
          <Label htmlFor="emailConsent">
            Consents to receive email communications from the church
          </Label>
        </div>
      </section>

      {/* Section 3: Church */}
      <section className="space-y-4">
        <h3 className="font-medium text-foreground border-b pb-1">Church</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="membershipDate">Membership date</Label>
            <Input id="membershipDate" name="membershipDate" type="date" defaultValue={dateStr(person?.membershipDate)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="baptismDate">Baptism date</Label>
            <Input id="baptismDate" name="baptismDate" type="date" defaultValue={dateStr(person?.baptismDate)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" defaultValue={person?.notes ?? ""} rows={3} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bankingName">Banking name</Label>
          <Input
            id="bankingName"
            name="bankingName"
            defaultValue={person?.bankingName ?? ""}
            placeholder="e.g. JON SMITH — used for bank import matching"
            maxLength={100}
          />
        </div>
      </section>

      {/* Section 4: Pastoral (gated) */}
      {canSeePastoralNotes && (
        <section className="space-y-4">
          <h3 className="font-medium text-foreground border-b pb-1">Pastoral</h3>
          <div className="space-y-2">
            <Label htmlFor="pastoralNotes">Pastoral notes</Label>
            <Textarea id="pastoralNotes" name="pastoralNotes" defaultValue={person?.pastoralNotes ?? ""} rows={4} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="emergencyContactName">Emergency contact</Label>
              <Input id="emergencyContactName" name="emergencyContactName" defaultValue={person?.emergencyContactName ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emergencyContactPhone">Emergency phone</Label>
              <Input id="emergencyContactPhone" name="emergencyContactPhone" defaultValue={person?.emergencyContactPhone ?? ""} />
            </div>
          </div>
        </section>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
