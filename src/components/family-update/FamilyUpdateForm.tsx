"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
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
import { FormFeedback } from "@/components/ui/FormFeedback"
import { submitFamilyUpdate } from "@/lib/actions/familyUpdate"

type Member = {
  personId?: number
  title: string
  firstName: string
  middleName: string
  lastName: string
  suffix: string
  gender: string
  dateOfBirth: string
  email: string
  mobile: string
  workPhone: string
  homePhone: string
}

type FamilyFields = {
  address: string
  suburb: string
  state: string
  postcode: string
  homePhone: string
  marriageDate: string
}

type Initial = { family: FamilyFields; members: Member[] }

// `_key` is a stable client-only React key. Index-derived keys collide when a
// new member is removed and later rows shift down, recycling stale input state
// onto the wrong member. Stripped before submit. Same fix as.
type MemberRow = Member & { _key: number }

const emptyMember = (key: number): MemberRow => ({
  _key: key,
  title: "",
  firstName: "",
  middleName: "",
  lastName: "",
  suffix: "",
  gender: "",
  dateOfBirth: "",
  email: "",
  mobile: "",
  workPhone: "",
  homePhone: "",
})

export function FamilyUpdateForm({
  token,
  formToken,
  initial,
  churchWebsite,
}: {
  token: string
  formToken: string
  initial: Initial
  churchWebsite: string
}) {
  const router = useRouter()
  // Seed initial rows with index keys; the counter starts past them so every
  // added member gets a fresh, non-colliding key.
  const keySeq = useRef(initial.members.length || 1)
  const [family, setFamily] = useState<FamilyFields>(initial.family)
  const [members, setMembers] = useState<MemberRow[]>(() =>
    (initial.members.length ? initial.members : [emptyMember(0)]).map((m, i) => ({
      ...m,
      _key: i,
    })),
  )
  const [website, setWebsite] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const addBtnRef = useRef<HTMLButtonElement>(null)

  function setMember(i: number, key: keyof Member, value: string) {
    setMembers((ms) => ms.map((m, idx) => (idx === i ? { ...m, [key]: value } : m)))
  }

  function removeMember(i: number) {
    setMembers((ms) => ms.filter((_, idx) => idx !== i))
    // Removed row's controls are gone; park focus on a stable target instead of
    // letting it fall to <body>.
    requestAnimationFrame(() => addBtnRef.current?.focus())
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const res = await submitFamilyUpdate({
        token,
        // Real IP is read server-side from x-forwarded-for; empty here falls
        // through to "unknown" rather than a misleading shared "client" bucket.
        ip: "",
        website,
        formToken,
        payload: {
          family,
          members: members.map(({ _key, ...m }) => ({ ...m, gender: m.gender || undefined })),
        },
      })
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
          <FormFeedback state={{ error }} />
        </div>
      )}
      <p className="text-sm text-muted-foreground">Fields marked * are required.</p>

      <section className="space-y-4">
        <h2 className="font-medium border-b pb-1">Family contact</h2>
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            value={family.address}
            onChange={(e) => setFamily({ ...family, address: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="suburb">Suburb</Label>
            <Input
              id="suburb"
              value={family.suburb}
              onChange={(e) => setFamily({ ...family, suburb: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              value={family.state}
              onChange={(e) => setFamily({ ...family, state: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="postcode">Postcode</Label>
            <Input
              id="postcode"
              value={family.postcode}
              onChange={(e) => setFamily({ ...family, postcode: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="famHome">Home phone</Label>
          <Input
            id="famHome"
            value={family.homePhone}
            onChange={(e) => setFamily({ ...family, homePhone: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="marriageDate">Marriage date</Label>
          <Input
            id="marriageDate"
            type="date"
            value={family.marriageDate}
            onChange={(e) => setFamily({ ...family, marriageDate: e.target.value })}
          />
        </div>
      </section>

      {members.map((m, i) => (
        <section key={m._key} className="space-y-4">
          <div className="flex items-center justify-between border-b pb-1">
            <h2 className="font-medium">
              {m.personId ? `${m.firstName || "Member"} ${m.lastName}` : "New member"}
            </h2>
            {!m.personId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${[m.firstName, m.lastName].filter(Boolean).join(" ") || "new member"} (member ${i + 1})`}
                className="text-destructive hover:text-destructive"
                onClick={() => removeMember(i)}
              >
                Remove
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`member-${i}-firstName`}>First name *</Label>
              <Input
                id={`member-${i}-firstName`}
                value={m.firstName}
                required
                onChange={(e) => setMember(i, "firstName", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`member-${i}-lastName`}>Last name *</Label>
              <Input
                id={`member-${i}-lastName`}
                value={m.lastName}
                required
                onChange={(e) => setMember(i, "lastName", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`member-${i}-email`}>Email</Label>
              <Input
                id={`member-${i}-email`}
                type="email"
                value={m.email}
                onChange={(e) => setMember(i, "email", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`member-${i}-mobile`}>Mobile</Label>
              <Input
                id={`member-${i}-mobile`}
                value={m.mobile}
                onChange={(e) => setMember(i, "mobile", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`dob-${i}`}>Date of birth</Label>
              <Input
                id={`dob-${i}`}
                type="date"
                value={m.dateOfBirth}
                onChange={(e) => setMember(i, "dateOfBirth", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`member-${i}-gender`}>Gender</Label>
              <Select value={m.gender} onValueChange={(v: string) => setMember(i, "gender", v)}>
                <SelectTrigger id={`member-${i}-gender`} className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>
      ))}

      <Button ref={addBtnRef} type="button" variant="outline" onClick={() => setMembers((ms) => [...ms, emptyMember(keySeq.current++)])}>
        + Add member
      </Button>

      {/* Honeypot — hidden from real users, catches bots. display:none (not just
          off-screen) keeps it out of password-manager autofill scope, so a real
          user's PM can't fill it and get the submission bot-rejected. */}
      <div aria-hidden className="absolute left-[-9999px]" style={{ display: "none" }}>
        <label htmlFor="fu-website">Website</label>
        <input
          id="fu-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div className="pt-4 border-t flex items-center gap-4">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Submitting…" : "Submit for review"}
        </Button>
        {churchWebsite && (
          <a href={churchWebsite} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Not now
          </a>
        )}
      </div>
    </form>
  )
}
