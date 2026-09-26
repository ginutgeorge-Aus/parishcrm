"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { submitMembershipApplication } from "@/lib/actions/membership"
import { focusFirstInvalidField } from "@/lib/formFocus"
import { SignaturePad } from "@/components/public-membership/SignaturePad"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TURNSTILE_LOAD_TIMEOUT_MS, turnstileLoadFailedMessage } from "@/components/public/TurnstileWidget"

import { TURNSTILE_SITE_KEY } from "@/lib/appConfig"

type TurnstileApi = { render: (el: HTMLElement, opts: Record<string, unknown>) => void }
// Read window.turnstile without a `declare global` — the global Window.turnstile
// augmentation already lives in the event RegistrationForm; re-declaring it here
// collides. A local cast keeps this component self-contained.
const getTurnstile = (): TurnstileApi | undefined =>
  (globalThis as unknown as { turnstile?: TurnstileApi }).turnstile

const label = "block text-sm font-medium text-foreground mb-1"
const rowLabel = "block text-xs font-medium text-muted-foreground mb-0.5"
const band = "bg-primary text-primary-foreground text-sm font-semibold px-3 py-1.5 rounded-md mt-8 mb-4"

// DOM-id-safe slug for building unique <label htmlFor>/<input id> pairs from a
// section title (e.g. "C. Name of Children" → "c-name-of-children") — the three
// RowSection instances share column keys ("name", "sex", ...), so the title
// must be part of the id or they'd collide across sections.
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

type Child = { name: string; sex: string; dateOfBirth: string; occupation: string; phoneEmail: string }
type Dependent = { name: string; sex: string; dateOfBirth: string; relationship: string; phoneEmail: string }
type Relative = { name: string; place: string; relationship: string; phoneEmail: string }

const emptyChild: Child = { name: "", sex: "", dateOfBirth: "", occupation: "", phoneEmail: "" }
const emptyDependent: Dependent = { name: "", sex: "", dateOfBirth: "", relationship: "", phoneEmail: "" }
const emptyRelative: Relative = { name: "", place: "", relationship: "", phoneEmail: "" }

export function MembershipForm({
  churchName,
  churchWebsite,
  churchEmail,
  parishFields,
  minDues,
  homeAddressLabel: initialHomeAddressLabel,
  arrivalDateLabel: initialArrivalDateLabel,
}: {
  churchName: string
  churchWebsite: string
  churchEmail?: string
  parishFields: boolean
  minDues: number | null
  // Blank = field hidden (generic install).
  homeAddressLabel: string
  arrivalDateLabel: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Labels live in state so a stale-label rejection can swap in the
  // admin's new labels without a reload that would discard typed answers.
  const [labels, setLabels] = useState({ homeAddress: initialHomeAddressLabel, arrivalDate: initialArrivalDateLabel })
  const { homeAddress: homeAddressLabel, arrivalDate: arrivalDateLabel } = labels
  const errorRef = useRef<HTMLDivElement>(null)

  // Move keyboard/SR focus to the announced error so it isn't missed on submit.
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  // Section A — personal
  const [name, setName] = useState("")
  const [gender, setGender] = useState("")
  const [dob, setDob] = useState("")
  const [email, setEmail] = useState("")
  const [mobile, setMobile] = useState("")
  const [address, setAddress] = useState("")
  const [suburb, setSuburb] = useState("")
  const [state, setState] = useState("")
  const [postcode, setPostcode] = useState("")
  const [profession, setProfession] = useState("")
  const [motherParish, setMotherParish] = useState("")
  const [addressInIndia, setAddressInIndia] = useState("")
  const [arrivalNsw, setArrivalNsw] = useState("")
  const [maritalStatus, setMaritalStatus] = useState("")
  const [transferCert, setTransferCert] = useState("")

  // Section B — spouse
  const [spouseName, setSpouseName] = useState("")
  const [spouseDob, setSpouseDob] = useState("")
  const [marriageDate, setMarriageDate] = useState("")
  const [spouseParish, setSpouseParish] = useState("")
  const [spouseWorking, setSpouseWorking] = useState("")
  const [spouseEmail, setSpouseEmail] = useState("")

  // Sections C/D/E
  const [children, setChildren] = useState<Child[]>([{ ...emptyChild }])
  const [dependents, setDependents] = useState<Dependent[]>([{ ...emptyDependent }])
  const [relatives, setRelatives] = useState<Relative[]>([{ ...emptyRelative }])

  // Section F
  const [subscription, setSubscription] = useState("")
  const [place, setPlace] = useState("")
  const [declDate, setDeclDate] = useState("")
  const [signature, setSignature] = useState("")

  // Anti-bot
  const [website, setWebsite] = useState("")
  const [turnstileToken, setTurnstileToken] = useState("")
  // true once the load timeout elapses with no widget ever mounted
  // (ad-blocker/firewall/tracking protection) — distinct from "not solved yet".
  const [turnstileLoadFailed, setTurnstileLoadFailed] = useState(false)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const turnstileMounted = useRef(false)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    const mount = () => {
      const ts = getTurnstile()
      if (!ts || !turnstileRef.current || turnstileRef.current.childElementCount > 0) return
      ts.render(turnstileRef.current, {
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
    if (getTurnstile()) {
      mount()
      return () => window.clearTimeout(timer)
    }
    const existingScript = document.getElementById("cf-turnstile-script")
    if (existingScript) {
      existingScript.addEventListener("load", mount)
      return () => {
        window.clearTimeout(timer)
        existingScript.removeEventListener("load", mount)
      }
    }
    const s = document.createElement("script")
    s.id = "cf-turnstile-script"
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    s.async = true
    s.onload = mount
    document.head.appendChild(s)
    return () => window.clearTimeout(timer)
  }, [])

  const turnstileSolved = !TURNSTILE_SITE_KEY || turnstileToken.length > 0

  function setChild(i: number, patch: Partial<Child>) {
    setChildren((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }
  function setDependent(i: number, patch: Partial<Dependent>) {
    setDependents((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  }
  function setRelative(i: number, patch: Partial<Relative>) {
    setRelatives((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const amount = Number.parseFloat(subscription)
    if (!name || !email || !address || !suburb || !state || !postcode) {
      setError("Please complete your name, email, and full residential address.")
      focusFirstInvalidField(e.currentTarget)
      return
    }
    if (!(amount >= (minDues ?? 0))) {
      setError(minDues != null ? `Monthly subscription must be at least $${minDues}.` : "Please enter your monthly subscription.")
      return
    }
    if (!signature) {
      setError("Please sign in the signature box.")
      return
    }
    if (!turnstileSolved) {
      setError("Please complete the verification.")
      return
    }

    const trimOrNull = (v: string) => (v.trim() ? v.trim() : null)
    const genderOrNull = (v: string) => (v === "MALE" || v === "FEMALE" || v === "OTHER" ? v : null)

    const payload = {
      personal: {
        name: name.trim(),
        gender: genderOrNull(gender),
        dateOfBirth: trimOrNull(dob),
        email: email.trim(),
        mobile: trimOrNull(mobile),
        address: address.trim(),
        suburb: suburb.trim(),
        state: state.trim(),
        postcode: postcode.trim(),
        qualificationProfession: trimOrNull(profession),
        motherParish: trimOrNull(motherParish),
        addressInIndia: trimOrNull(addressInIndia),
        dateOfArrivalNsw: trimOrNull(arrivalNsw),
        maritalStatus: maritalStatus === "MARRIED" || maritalStatus === "UNMARRIED" ? maritalStatus : null,
        transferCertFurnished: transferCert === "" ? null : transferCert === "YES",
      },
      spouse: spouseName.trim()
        ? {
            name: spouseName.trim(),
            dateOfBirth: trimOrNull(spouseDob),
            dateOfMarriage: trimOrNull(marriageDate),
            parish: trimOrNull(spouseParish),
            working: spouseWorking === "" ? null : spouseWorking === "YES",
            email: trimOrNull(spouseEmail),
          }
        : null,
      children: children
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name.trim(), sex: trimOrNull(c.sex), dateOfBirth: trimOrNull(c.dateOfBirth), occupation: trimOrNull(c.occupation), phoneEmail: trimOrNull(c.phoneEmail) })),
      dependents: dependents
        .filter((d) => d.name.trim())
        .map((d) => ({ name: d.name.trim(), sex: trimOrNull(d.sex), dateOfBirth: trimOrNull(d.dateOfBirth), relationship: trimOrNull(d.relationship), phoneEmail: trimOrNull(d.phoneEmail) })),
      relativesInAustralia: relatives
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), place: trimOrNull(r.place), relationship: trimOrNull(r.relationship), phoneEmail: trimOrNull(r.phoneEmail) })),
      subscription: { monthlyAmount: amount },
      declaration: { place: trimOrNull(place), date: trimOrNull(declDate) },
    }

    startTransition(async () => {
      const res = await submitMembershipApplication({ payload, signature, turnstileToken, website, renderedLabels: labels })
      if (res && "error" in res) {
        if ("updatedLabels" in res) setLabels(res.updatedLabels)
        setError(res.error)
        return
      }
      router.push("/membershipform/success")
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl px-4 py-8">
      <header className="border-b-2 border-primary pb-4 mb-6">
        {/* Official church letterhead (crest + name + address + ABN). eslint-disable:
            plain <img> — a static public asset, no next/image optimisation needed. */}
        {/* Intrinsic width/height (natural 3000×514) reserve the aspect-ratio box
            before the PNG loads — without them the header collapses to a thin bar
            on slow mobile connections, reading as "letterhead missing". */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/api/branding/letterhead"
          alt={churchName}
          width={3000}
          height={514}
          className="mx-auto w-full max-w-xl h-auto"
        />
      </header>
      <h1 className="text-xl font-bold text-center text-foreground">Membership Registration Form</h1>
      <p className="text-center text-sm text-muted-foreground mt-1">Please complete all applicable sections and sign below.</p>

      <p className="mt-4 rounded-md bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        Welcome to {churchName}! Please take a few moments to fill out
        this form with your personal details. Your information will be kept confidential and
        used solely for the purpose of enhancing our church&rsquo;s activities and communication.
      </p>

      {/* Honeypot */}
      <Input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        className="absolute left-[-9999px]"
        aria-hidden="true"
      />

      <h2 className={band}>A. Personal Particulars</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className={label}>Name *</label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="gender" className={label}>Sex</label>
          <Select value={gender || undefined} onValueChange={setGender}>
            <SelectTrigger id="gender" className="w-full">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MALE">Male</SelectItem>
              <SelectItem value="FEMALE">Female</SelectItem>
              <SelectItem value="OTHER">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="dob" className={label}>Date of Birth</label>
          <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>
        <div>
          <label htmlFor="email" className={label}>E-mail ID *</label>
          <Input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="mobile" className={label}>Mobile No.</label>
          <Input id="mobile" type="tel" inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="address" className={label}>Residential Address *</label>
          <Input id="address" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" required />
        </div>
        <div>
          <label htmlFor="suburb" className={label}>Suburb *</label>
          <Input id="suburb" autoComplete="address-level2" value={suburb} onChange={(e) => setSuburb(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="state" className={label}>State *</label>
          <Input id="state" autoComplete="address-level1" value={state} onChange={(e) => setState(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="postcode" className={label}>Postcode *</label>
          <Input id="postcode" inputMode="numeric" autoComplete="postal-code" value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="profession" className={label}>Qualification &amp; Profession</label>
          <Input id="profession" value={profession} onChange={(e) => setProfession(e.target.value)} />
        </div>
        {parishFields && (
          <div>
            <label htmlFor="motherParish" className={label}>Previous church</label>
            <Input id="motherParish" value={motherParish} onChange={(e) => setMotherParish(e.target.value)} />
          </div>
        )}
        {arrivalDateLabel && (
          <div>
            <label htmlFor="arrivalNsw" className={label}>{arrivalDateLabel}</label>
            <Input id="arrivalNsw" type="date" value={arrivalNsw} onChange={(e) => setArrivalNsw(e.target.value)} />
          </div>
        )}
        {homeAddressLabel && (
          <div className="sm:col-span-2">
            <label htmlFor="addressInIndia" className={label}>{homeAddressLabel}</label>
            <Input id="addressInIndia" value={addressInIndia} onChange={(e) => setAddressInIndia(e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="maritalStatus" className={label}>Marital Status</label>
          <Select value={maritalStatus || undefined} onValueChange={setMaritalStatus}>
            <SelectTrigger id="maritalStatus" className="w-full">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MARRIED">Married</SelectItem>
              <SelectItem value="UNMARRIED">Unmarried</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {parishFields && (
          <div>
            <label htmlFor="transferCert" className={label}>Transfer letter from previous church provided?</label>
            <Select value={transferCert || undefined} onValueChange={setTransferCert}>
              <SelectTrigger id="transferCert" className="w-full">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <h2 className={band}>B. Details of Family (Spouse)</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="spouseName" className={label}>Name of Spouse</label>
          <Input id="spouseName" autoComplete="off" value={spouseName} onChange={(e) => setSpouseName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="spouseDob" className={label}>Date of Birth</label>
          <Input id="spouseDob" type="date" autoComplete="off" value={spouseDob} onChange={(e) => setSpouseDob(e.target.value)} />
        </div>
        <div>
          <label htmlFor="marriageDate" className={label}>Date of Marriage</label>
          <Input id="marriageDate" type="date" autoComplete="off" value={marriageDate} onChange={(e) => setMarriageDate(e.target.value)} />
        </div>
        {parishFields && (
          <div>
            <label htmlFor="spouseParish" className={label}>Spouse&apos;s church</label>
            <Input id="spouseParish" autoComplete="off" value={spouseParish} onChange={(e) => setSpouseParish(e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="spouseWorking" className={label}>Spouse working?</label>
          <Select value={spouseWorking || undefined} onValueChange={setSpouseWorking}>
            <SelectTrigger id="spouseWorking" className="w-full">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="YES">Yes</SelectItem>
              <SelectItem value="NO">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="spouseEmail" className={label}>Spouse E-mail ID</label>
          <Input id="spouseEmail" type="email" autoComplete="off" value={spouseEmail} onChange={(e) => setSpouseEmail(e.target.value)} />
        </div>
      </div>

      <RowSection<Child>
        title="C. Name of Children"
        rows={children}
        empty={emptyChild}
        max={4}
        setRows={setChildren}
        columns={[
          { key: "name", label: "Name" },
          { key: "sex", label: "Sex (M/F)" },
          { key: "dateOfBirth", label: "Date of Birth", type: "date" },
          { key: "occupation", label: "Occupation" },
          { key: "phoneEmail", label: "Phone / Email" },
        ]}
        onChange={setChild}
      />

      <RowSection<Dependent>
        title="D. Other Dependents (to be included in the Register)"
        rows={dependents}
        empty={emptyDependent}
        max={4}
        setRows={setDependents}
        columns={[
          { key: "name", label: "Name" },
          { key: "sex", label: "Sex (M/F)" },
          { key: "dateOfBirth", label: "Date of Birth", type: "date" },
          { key: "relationship", label: "Relationship" },
          { key: "phoneEmail", label: "Phone / Email" },
        ]}
        onChange={setDependent}
      />

      <RowSection<Relative>
        title="E. Any Other Relatives in Australia"
        rows={relatives}
        empty={emptyRelative}
        max={3}
        setRows={setRelatives}
        columns={[
          { key: "name", label: "Name" },
          { key: "place", label: "Place" },
          { key: "relationship", label: "Relationship" },
          { key: "phoneEmail", label: "Phone / Email" },
        ]}
        onChange={setRelative}
      />

      <h2 className={band}>F. Subscription &amp; Declaration</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="subscription" className={label}>My Monthly Subscription ($) *{minDues != null ? ` (minimum $${minDues})` : ""}</label>
          <Input id="subscription" type="number" min={minDues ?? 0} step="0.01" value={subscription} onChange={(e) => setSubscription(e.target.value)} required />
        </div>
      </div>
      <p className="mt-4 text-sm italic text-muted-foreground">
        I declare that the above information is true and correct to the best of my knowledge.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="place" className={label}>Place</label>
          <Input id="place" value={place} onChange={(e) => setPlace(e.target.value)} />
        </div>
        <div>
          <label htmlFor="declDate" className={label}>Date</label>
          <Input id="declDate" type="date" value={declDate} onChange={(e) => setDeclDate(e.target.value)} />
        </div>
      </div>
      <div className="mt-4">
        {/* Not a <label htmlFor> — SignaturePad has no single labellable control
            (canvas + radios + text input). Expose the "Signature *" requirement
            to AT by folding this id into the pad's aria-describedby. */}
        <span id="signature-label" className={label}>Signature *</span>
        <SignaturePad onChange={setSignature} describedById="signature-label" />
      </div>

      {TURNSTILE_SITE_KEY && (
        <>
          <div ref={turnstileRef} className="cf-turnstile mt-6" />
          <FormFeedback state={{ error: turnstileLoadFailed ? turnstileLoadFailedMessage(churchEmail) : null }} className="mt-2" />
        </>
      )}

      {error && (
        <div ref={errorRef} tabIndex={-1} className="mt-6 rounded-md bg-destructive/10 px-3 py-2 outline-hidden">
          <FormFeedback state={{ error }} />
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit membership form"}
      </button>
      {churchWebsite && (
        <div className="mt-3 text-center">
          <a href={churchWebsite} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Not now
          </a>
        </div>
      )}
    </form>
  )
}

type Column<T> = { key: keyof T; label: string; type?: string }

function RowSection<T extends { name: string }>(props: {
  title: string
  rows: T[]
  empty: T
  max: number
  setRows: React.Dispatch<React.SetStateAction<T[]>>
  columns: Column<T>[]
  onChange: (i: number, patch: Partial<T>) => void
}) {
  const { title, rows, empty, max, setRows, columns, onChange } = props
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const shouldFocusAddButton = useRef(false)

  // Removing the last row can drop focus (it was inside the removed row) with
  // nowhere for it to land — move it to "Add row" instead. A plain ref (not
  // state) flags the request so this effect — which runs after every render —
  // can wait for the post-removal re-render before focusing (removing always
  // decreases rows.length, so "Add row" is shown by then even if it was
  // hidden at max before the removal).
  useEffect(() => {
    if (shouldFocusAddButton.current) {
      addButtonRef.current?.focus()
      shouldFocusAddButton.current = false
    }
  })

  return (
    <>
      <h2 className="bg-primary text-primary-foreground text-sm font-semibold px-3 py-1.5 rounded-md mt-8 mb-4">{title}</h2>
      <div className="space-y-3">
        {rows.map((row, i) => {
          const rowHeadingId = `${slug(title)}-row-${i}-heading`
          return (
          <div key={i} className="space-y-1">
            {/* sr-only row heading: sighted users see the visible per-column
                labels below; SR users get "<title>, row N" prepended to each
                column's accessible name so repeated columns stay distinct. */}
            <span id={rowHeadingId} className="sr-only">{title}, row {i + 1}</span>
            <div className="grid gap-2 sm:grid-cols-5">
              {columns.map((col) => {
                const inputId = `${slug(title)}-${String(col.key)}-${i}`
                const labelId = `${inputId}-label`
                return (
                  <div key={String(col.key)}>
                    <label id={labelId} htmlFor={inputId} className={rowLabel}>{col.label}</label>
                    <Input
                      id={inputId}
                      type={col.type ?? "text"}
                      placeholder={col.label}
                      aria-labelledby={`${rowHeadingId} ${labelId}`}
                      value={String(row[col.key] ?? "")}
                      onChange={(e) => onChange(i, { [col.key]: e.target.value } as Partial<T>)}
                    />
                  </div>
                )
              })}
            </div>
            {rows.length > 1 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  aria-label={`Remove ${title} row ${i + 1}`}
                  className="inline-flex min-h-11 items-center px-1 py-2.5 text-xs underline text-muted-foreground"
                  onClick={() => {
                    setRows((r) => r.filter((_, idx) => idx !== i))
                    shouldFocusAddButton.current = true
                  }}
                >
                  − Remove
                </button>
              </div>
            )}
          </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-4 text-sm">
        {rows.length < max && (
          <button ref={addButtonRef} type="button" className="inline-flex min-h-11 items-center px-1 py-2.5 underline text-primary" onClick={() => setRows((r) => [...r, { ...empty }])}>
            + Add row
          </button>
        )}
      </div>
    </>
  )
}
