# Organisers Edit Own Events (OSS-41) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `EVENT_ORGANISER` can edit the public details of events they manage at `/my-events/[id]/edit`, with no access to money, publish, slug, registration settings or managers.

**Architecture:** Pure parsing helpers (`ManagedEventSchema`, `parseManagedEventForm`, `managedEventData`) live in `src/lib/actions/eventForm.ts`. A new dedicated Server Action `updateManagedEvent` in `src/lib/actions/eventManaged.ts` guards with `canManageEvent`, writes only an allowlist inside a transaction, audits, syncs the website. A details-only client form + page under the existing `(organiser)` route group. `updateEvent` is untouched.

**Tech Stack:** Next.js 16 App Router, Server Actions, Prisma 7, Zod 4, Jest 30.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-30-organiser-edit-events-design.md`. Field scope is **details only**.
- Editable fields (exact): `title`, `description`, `category`, `date`, `endDate`, `recurs`, `recursLabel`, `startTime`, `location`, public `organizers`, banner + poster images. `kind` is read from the DB and never from the form.
- Never writable by this action: `slug`, `isPublished`, `registrationClosed`, `registrationDeadline`, `reminderDaysBefore`, capacity, ticket types, pricing tiers, waiver, `bankBsb`, `bankAccount`, Stripe flags, `imageUrl`, managers, `volunteerToken`.
- `src/lib/actions/event.ts` and `updateEvent` stay unchanged.
- Files with `"use server"` may only export async functions. Pure helpers go in `eventForm.ts`.
- JSDoc on every new or changed function (exported or not) — `docs/conventions.md`.
- Public repo: synthetic test data only (`jo@example.com` style).
- Tests: put new suites in `src/**/__tests__/`; run single suites with `npm test -- --testPathPatterns="<basename>"`.
- Before push: `npx tsc --noEmit` and `npm run lint`.
- Branch: `feat/oss-41-organiser-edit` (already created, spec committed).

---

### Task 1: Managed-event parsing helpers

**Files:**
- Modify: `src/lib/actions/eventForm.ts` (split `EventSchema`, add managed helpers)
- Test: `src/lib/actions/__tests__/eventFormManaged.test.ts`

**Interfaces:**
- Produces:
  - `ManagedEventSchema` (Zod object, keys: title, description, kind, category, date, endDate, recurs, recursLabel, startTime, location)
  - `type ManagedEventKind = "one_off" | "recurring"`
  - `type ParsedManagedEventForm = { parsed: z.infer<typeof ManagedEventSchema>; organizers: Organizer[] }`
  - `parseManagedEventForm(formData: FormData, kind: ManagedEventKind): { error: string } | ParsedManagedEventForm`
  - `managedEventData(d: z.infer<typeof ManagedEventSchema>)` → Prisma `Event` column payload (exactly the 9 scalar detail columns)

- [ ] **Step 1: Write the failing test**

Create `src/lib/actions/__tests__/eventFormManaged.test.ts`:

```ts
/** @jest-environment node */
import { parseManagedEventForm, managedEventData } from "@/lib/actions/eventForm"

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const oneOff = { title: "Camp", category: "youth", date: "2026-08-01T10:00", location: "Hall" }

describe("parseManagedEventForm", () => {
  it("parses the allowlisted detail fields", () => {
    const r = parseManagedEventForm(form({ ...oneOff, description: "Fun" }), "one_off")
    expect("error" in r).toBe(false)
    if ("error" in r) return
    expect(r.parsed).toMatchObject({ title: "Camp", category: "youth", kind: "one_off", location: "Hall" })
  })

  it("strips forged non-detail keys", () => {
    const r = parseManagedEventForm(
      form({ ...oneOff, slug: "hijack", bankBsb: "123-456", registrationDeadline: "2026-07-01T10:00", onlinePaymentEnabled: "on", kind: "recurring" }),
      "one_off",
    )
    if ("error" in r) throw new Error(r.error)
    for (const k of ["slug", "bankBsb", "registrationDeadline", "onlinePaymentEnabled"]) {
      expect(r.parsed).not.toHaveProperty(k)
    }
    // kind comes from the caller (DB), never the form
    expect(r.parsed.kind).toBe("one_off")
  })

  it("requires a date for one-off events", () => {
    const r = parseManagedEventForm(form({ title: "Camp" }), "one_off")
    expect(r).toEqual({ error: "Date required for one-off events" })
  })

  it("requires a recurrence pattern for recurring events", () => {
    const r = parseManagedEventForm(form({ title: "Mass" }), "recurring")
    expect(r).toEqual({ error: "Recurrence pattern required for recurring events" })
  })

  it("rejects an end before the start", () => {
    const r = parseManagedEventForm(form({ ...oneOff, endDate: "2026-07-31T10:00" }), "one_off")
    expect(r).toEqual({ error: "End date must not be before the start date" })
  })

  it("parses organiser contacts", () => {
    const r = parseManagedEventForm(form({ ...oneOff, "organizer.0.name": "Jo", "organizer.0.phone": "0400 000 000" }), "one_off")
    if ("error" in r) throw new Error(r.error)
    expect(r.organizers).toEqual([{ name: "Jo", phone: "0400 000 000" }])
  })
})

describe("managedEventData", () => {
  it("returns exactly the detail columns for a one-off event", () => {
    const r = parseManagedEventForm(form({ ...oneOff, "recursLabel": "ignored", startTime: "ignored" }), "one_off")
    if ("error" in r) throw new Error(r.error)
    const data = managedEventData(r.parsed)
    expect(Object.keys(data).sort()).toEqual(
      ["category", "date", "description", "endDate", "location", "recurs", "recursLabel", "startTime", "title"],
    )
    expect(data.date).toBeInstanceOf(Date)
    expect(data.recursLabel).toBeNull()
    expect(data.startTime).toBeNull()
  })

  it("nulls the date for a recurring event", () => {
    const r = parseManagedEventForm(form({ title: "Mass", recurs: "every-sunday", recursLabel: "Sun", startTime: "9:30 AM" }), "recurring")
    if ("error" in r) throw new Error(r.error)
    const data = managedEventData(r.parsed)
    expect(data.date).toBeNull()
    expect(data.recurs).toBe("every-sunday")
    expect(data.startTime).toBe("9:30 AM")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="eventFormManaged"`
Expected: FAIL — `parseManagedEventForm` is not exported.

- [ ] **Step 3: Split `EventSchema` into base + refined**

In `src/lib/actions/eventForm.ts` change the schema head and tail:

```ts
// before
export const EventSchema = z.object({
// after
const EventBase = z.object({
```

and replace the line `}).superRefine((data, ctx) => {` (only one in the file) with:

```ts
})

export const EventSchema = EventBase.superRefine((data, ctx) => {
```

Nothing else in `EventSchema` changes; `EVENT_FIELDS`, `eventData`, `ParsedEventForm` keep working.

- [ ] **Step 4: Add the managed helpers**

Append after `parseEventForm` at the end of `src/lib/actions/eventForm.ts`:

```ts
/** Event kinds an organiser may edit; read from the DB row, never the form. */
export type ManagedEventKind = "one_off" | "recurring"

// Detail fields an EVENT_ORGANISER may edit on their own events (OSS-41,
// "details only"). Anything not listed — slug, publish, registration settings,
// money, managers — is never read from the form.
const MANAGED_FIELDS = ["title", "description", "category", "date", "endDate", "recurs", "recursLabel", "startTime", "location"] as const

/**
 * Zod schema for the organiser details form. Reuses the field validators of
 * `EventSchema`; the schedule rules are repeated here (not shared) because
 * `EventSchema`'s superRefine also covers fields this form never carries.
 */
export const ManagedEventSchema = EventBase.pick({
  title: true,
  description: true,
  kind: true,
  category: true,
  date: true,
  endDate: true,
  recurs: true,
  recursLabel: true,
  startTime: true,
  location: true,
}).superRefine((data, ctx) => {
  if (data.kind === "one_off" && !data.date) {
    ctx.addIssue({ code: "custom", message: "Date required for one-off events", path: ["date"] })
  }
  if (data.kind === "recurring" && !data.recurs) {
    ctx.addIssue({ code: "custom", message: "Recurrence pattern required for recurring events", path: ["recurs"] })
  }
  const toTime = (v: string | undefined) => (v ? new Date(v + ":00.000Z").getTime() : undefined)
  const start = toTime(data.date)
  const end = toTime(data.endDate)
  if (start !== undefined && end !== undefined && end < start) {
    ctx.addIssue({ code: "custom", message: "End date must not be before the start date", path: ["endDate"] })
  }
})

export type ParsedManagedEventForm = {
  parsed: z.infer<typeof ManagedEventSchema>
  organizers: ReturnType<typeof parseOrganizers>
}

/**
 * Validate the organiser details form. Only `MANAGED_FIELDS` plus the
 * `organizer.<i>.*` rows are read; `kind` is injected from the stored event so
 * a form can't flip an event between one-off and recurring.
 *
 * @param formData - Submitted form.
 * @param kind - The event's stored kind.
 * @returns `{ error }` for the first validation failure, else the parsed data.
 */
export function parseManagedEventForm(
  formData: FormData,
  kind: ManagedEventKind,
): { error: string } | ParsedManagedEventForm {
  const parsed = ManagedEventSchema.safeParse({
    ...Object.fromEntries(MANAGED_FIELDS.map((k) => [k, formData.get(k) || undefined])),
    kind,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  return { parsed: parsed.data, organizers: parseOrganizers(formData) }
}

/**
 * Build the Event column payload for an organiser edit — the detail columns
 * only. Mirrors `eventData`'s one-off/recurring column rules.
 *
 * @param d - Validated managed form data.
 * @returns Prisma update payload with exactly the nine detail columns.
 */
export function managedEventData(d: z.infer<typeof ManagedEventSchema>) {
  const recurring = d.kind === "recurring"
  return {
    title: d.title,
    description: d.description || null,
    category: d.category,
    date: !recurring && d.date ? sydneyDatetimeLocalToUTC(d.date) : null,
    endDate: d.endDate ? sydneyDatetimeLocalToUTC(d.endDate) : null,
    recurs: recurring ? (d.recurs || null) : null,
    recursLabel: recurring ? (d.recursLabel || null) : null,
    startTime: recurring ? (d.startTime || null) : null,
    location: d.location || null,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass, including the existing event suites**

Run: `npm test -- --testPathPatterns="eventFormManaged|event.test|eventForm"`
Expected: PASS (new suite green, existing `EventSchema` behaviour unchanged).

- [ ] **Step 6: Commit**

```bash
git branch --show-current && git status -s
git add src/lib/actions/eventForm.ts src/lib/actions/__tests__/eventFormManaged.test.ts
git commit -m "feat(events): managed-event form parser for organiser edits (OSS-41)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `updateManagedEvent` Server Action

**Files:**
- Create: `src/lib/actions/eventManaged.ts`
- Test: `src/lib/actions/__tests__/eventManaged.test.ts`

**Interfaces:**
- Consumes (Task 1): `parseManagedEventForm(formData, kind)`, `managedEventData(parsed)`; existing `parseImageUpload`, `applyImageOp`, `STALE_EVENT` from `@/lib/actions/eventForm`; `canManageEvent(userId, eventId, role)` from `@/lib/eventManager`.
- Produces: `updateManagedEvent(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult>` — bind with `.bind(null, id)` for `useActionState`. On success it `redirect()`s to `/my-events/${id}/edit?saved=1`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/actions/__tests__/eventManaged.test.ts`:

```ts
/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { updateManagedEvent } from "@/lib/actions/eventManaged"
import { auth } from "@/auth"
import { canManageEvent } from "@/lib/eventManager"
import { logAudit } from "@/lib/audit"
import { syncEventToWebsite } from "@/lib/websiteSync"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn() }))
jest.mock("@/lib/websiteSync", () => ({ syncEventToWebsite: jest.fn(async () => {}) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
}))

const findUnique = jest.fn()
const updateMany = jest.fn()
const prismaMock = {
  event: {
    findUnique: (...a: unknown[]) => findUnique(...a),
    updateMany: (...a: unknown[]) => updateMany(...a),
  },
  eventImage: { upsert: jest.fn(), deleteMany: jest.fn() },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}
jest.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const stored = {
  id: 7, slug: "camp", kind: "one_off", title: "Old", description: null, category: "worship",
  date: new Date("2026-08-01T00:00:00Z"), endDate: null, recurs: null, recursLabel: null,
  startTime: null, location: null, organizers: null, registrationDeadline: null,
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const base = { title: "New title", category: "youth", date: "2026-08-02T10:00" }

async function run(fd: FormData, id = 7) {
  try {
    return await updateManagedEvent(id, undefined, fd)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT")) return e.message
    throw e
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
  ;(canManageEvent as jest.Mock).mockResolvedValue(true)
  findUnique.mockResolvedValue(stored)
  updateMany.mockResolvedValue({ count: 1 })
})

describe("updateManagedEvent authorisation", () => {
  it("rejects an unauthenticated caller", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect(await run(form(base))).toEqual({ error: "Unauthorized" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects a non-manager before touching the event (IDOR)", async () => {
    ;(canManageEvent as jest.Mock).mockResolvedValue(false)
    expect(await run(form(base), 99)).toEqual({ error: "Unauthorized" })
    expect(canManageEvent).toHaveBeenCalledWith(5, 99, "EVENT_ORGANISER")
    expect(findUnique).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects an invalid id", async () => {
    expect(await run(form(base), -1)).toEqual({ error: "Invalid event" })
  })
})

describe("updateManagedEvent write", () => {
  it("writes only the detail columns, scoped to the event id", async () => {
    const out = await run(form({
      ...base,
      slug: "hijack", isPublished: "on", capacity: "1", bankBsb: "123-456", registrationDeadline: "2026-07-01T10:00",
    }))
    expect(out).toBe("NEXT_REDIRECT /my-events/7/edit?saved=1")
    const arg = updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
    expect(arg.where).toEqual({ id: 7 })
    expect(Object.keys(arg.data).sort()).toEqual(
      ["category", "date", "description", "endDate", "location", "organizers", "recurs", "recursLabel", "startTime", "title"],
    )
    expect(arg.data.title).toBe("New title")
  })

  it("guards the write on the last-seen updatedAt", async () => {
    await run(form({ ...base, updatedAt: "2026-08-01T00:00:00.000Z" }))
    const arg = updateMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(arg.where).toEqual({ id: 7, updatedAt: new Date("2026-08-01T00:00:00.000Z") })
  })

  it("reports a stale edit", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const out = await run(form({ ...base, updatedAt: "2026-08-01T00:00:00.000Z" }))
    expect(out).toEqual({ error: expect.stringContaining("changed by someone else") })
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("refuses a date that would end before the stored registration deadline", async () => {
    findUnique.mockResolvedValue({ ...stored, registrationDeadline: new Date("2026-09-01T00:00:00Z") })
    const out = await run(form(base))
    expect(out).toEqual({ error: expect.stringContaining("registration deadline") })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("returns validation errors without writing", async () => {
    expect(await run(form({ title: "" }))).toEqual({ error: expect.any(String) })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("returns not-found for a missing event the caller may manage", async () => {
    findUnique.mockResolvedValue(null)
    expect(await run(form(base))).toEqual({ error: "Event not found" })
  })

  it("audits changed fields + role, syncs the website", async () => {
    await run(form(base))
    expect(logAudit).toHaveBeenCalledWith(
      5, "EVENT_UPDATED", "Event", 7,
      expect.objectContaining({ role: "EVENT_ORGANISER", fields: expect.arrayContaining(["title", "category", "date"]) }),
    )
    expect(syncEventToWebsite).toHaveBeenCalledWith(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="eventManaged.test"`
Expected: FAIL — cannot find module `@/lib/actions/eventManaged`.

- [ ] **Step 3: Export `STALE_EVENT` use + write the action**

`STALE_EVENT`, `parseImageUpload`, `applyImageOp`, `parseManagedEventForm`, `managedEventData` are already exported from `eventForm.ts` (Task 1 added the last two). Create `src/lib/actions/eventManaged.ts`:

```ts
"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canManageEvent } from "@/lib/eventManager"
import { featureGuard } from "@/lib/featureFlags"
import { syncEventToWebsite } from "@/lib/websiteSync"
import { isValidPgId, parseOptimisticUpdatedAt } from "@/lib/validation"
import { EventImageKind } from "@/lib/generated/prisma/enums"
import {
  STALE_EVENT,
  applyImageOp,
  managedEventData,
  parseImageUpload,
  parseManagedEventForm,
} from "./eventForm"
import type { ActionResult } from "./types"

/**
 * Equality for audit diffing: dates by instant, everything else by value with
 * `undefined` treated as `null`.
 *
 * @param a - Stored value.
 * @param b - New value.
 * @returns True when the two represent the same value.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return (a ?? null) === (b ?? null)
}

/**
 * Update the public details of one event. Allowed for editors and for an
 * EVENT_ORGANISER assigned to this event (`canManageEvent`). Writes only the
 * detail allowlist (`managedEventData` + organiser contacts + banner/poster);
 * money, publish, slug, registration settings and managers are never touched.
 *
 * @param id - Event id (bound from the route).
 * @param _prev - Previous action state (unused).
 * @param formData - Submitted details form.
 * @returns `{ error }` on failure; on success redirects to the edit page.
 */
export async function updateManagedEvent(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid event" }

  // IDOR gate first: an unassigned event is indistinguishable from a missing one.
  const userId = Number.parseInt(session.user.id, 10)
  if (!(await canManageEvent(userId, id, session.user.role))) return { error: "Unauthorized" }

  const existing = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true, slug: true, kind: true, title: true, description: true, category: true, date: true,
      endDate: true, recurs: true, recursLabel: true, startTime: true, location: true,
      organizers: true, registrationDeadline: true,
    },
  })
  if (!existing) return { error: "Event not found" }

  const result = parseManagedEventForm(formData, existing.kind === "recurring" ? "recurring" : "one_off")
  if ("error" in result) return { error: result.error }
  const { parsed, organizers } = result

  const banner = await parseImageUpload(formData, "banner")
  if ("error" in banner) return { error: banner.error }
  const poster = await parseImageUpload(formData, "poster")
  if ("error" in poster) return { error: poster.error }

  const data = managedEventData(parsed)

  // The registration deadline is staff-only, so an organiser moving the date
  // earlier could leave it after the event ends (EventSchema forbids that).
  const closesBy = data.endDate ?? data.date
  if (existing.registrationDeadline && closesBy && existing.registrationDeadline > closesBy) {
    return { error: "The event would end before its registration deadline. Ask an editor to change the deadline first." }
  }

  const seenAt = parseOptimisticUpdatedAt(formData)
  try {
    await prisma.$transaction(async (tx) => {
      const res = await tx.event.updateMany({
        where: seenAt ? { id, updatedAt: seenAt } : { id },
        // Empty array (not undefined) so removing every organiser persists —
        // same rationale as updateEvent.
        data: { ...data, organizers: organizers.length > 0 ? organizers : [] },
      })
      if (res.count === 0) throw new Error(STALE_EVENT)
      await applyImageOp(tx, id, EventImageKind.BANNER, banner)
      await applyImageOp(tx, id, EventImageKind.POSTER, poster)
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.message === STALE_EVENT) {
      return { error: "This event was changed by someone else since you opened it. Reload the page and reapply your edit." }
    }
    throw e
  }

  const fields = (Object.keys(data) as (keyof typeof data)[]).filter((k) => !sameValue(existing[k], data[k]))
  if (JSON.stringify(existing.organizers ?? []) !== JSON.stringify(organizers)) fields.push("organizers" as never)
  if (banner.op !== "skip") fields.push("banner" as never)
  if (poster.op !== "skip") fields.push("poster" as never)
  await logAudit(actorId(session), "EVENT_UPDATED", "Event", id, {
    slug: existing.slug,
    role: session.user.role,
    fields,
  })
  await syncEventToWebsite(id)
  revalidatePath(`/my-events/${id}/edit`)
  revalidatePath("/my-events")
  revalidatePath("/events")
  redirect(`/my-events/${id}/edit?saved=1`)
}
```

If `tsc` rejects the `as never` pushes, type `fields` as `string[]` instead: `const fields: string[] = (Object.keys(data) as (keyof typeof data)[]).filter(...)` and drop the casts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="eventManaged.test|eventFormManaged"`
Expected: PASS, all cases green.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git branch --show-current && git status -s
git add src/lib/actions/eventManaged.ts src/lib/actions/__tests__/eventManaged.test.ts
git commit -m "feat(events): updateManagedEvent action for organiser edits (OSS-41)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Organiser edit page, form, entry point, middleware test

**Files:**
- Create: `src/components/events/ManagedEventForm.tsx`
- Create: `src/app/(organiser)/my-events/[id]/edit/page.tsx`
- Modify: `src/app/(organiser)/my-events/page.tsx` (add "Edit details" link per event)
- Modify: `src/lib/__tests__/organiserAccess.test.ts` (new allow/block cases)
- Test: `src/app/(organiser)/my-events/__tests__/editPage.test.tsx`

**Interfaces:**
- Consumes (Task 2): `updateManagedEvent(id, prev, formData)`. Existing: `canManageEvent`, `parseRouteId`, `toSydneyDatetimeLocal`, `OrganizersEditor`, `EventSavedBanner`, `FormFeedback`.
- Produces: `ManagedEventForm` props:
  `{ action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>; kind: "one_off" | "recurring"; defaultValues: { slug: string; title: string; description: string; category: string; date: string; endDate: string; recurs: string; recursLabel: string; startTime: string; location: string; hasBanner: boolean; hasPoster: boolean; organizers: Organizer[]; updatedAt: Date | string } }`.

- [ ] **Step 1: Write the failing tests**

Add the cases to `src/lib/__tests__/organiserAccess.test.ts`: in the allow list add `"/my-events/42/edit"`; in the block list `"/events/42/edit"` is already covered by `/events` cases, add it explicitly after `"/events"`:

```ts
    "/events/42/edit",
```

Create `src/app/(organiser)/my-events/__tests__/editPage.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/my-events/7/edit",
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn() }))
jest.mock("@/lib/actions/eventManaged", () => ({ updateManagedEvent: jest.fn() }))

import EditManagedEventPage from "@/app/(organiser)/my-events/[id]/edit/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"

const event = {
  id: 7, slug: "camp", kind: "one_off", title: "Youth Camp", description: "Fun", category: "youth",
  date: new Date("2026-08-01T00:00:00Z"), endDate: null, recurs: null, recursLabel: null, startTime: null,
  location: "Hall", organizers: [{ name: "Jo" }], updatedAt: new Date("2026-07-01T00:00:00Z"),
  images: [{ kind: "BANNER" }],
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
  ;(canManageEvent as jest.Mock).mockResolvedValue(true)
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(event)
})

const props = (id = "7") => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })

it("redirects to login without a session", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  await expect(EditManagedEventPage(props())).rejects.toThrow("NEXT_REDIRECT /login")
})

it("404s for a non-manager without loading the event", async () => {
  ;(canManageEvent as jest.Mock).mockResolvedValue(false)
  await expect(EditManagedEventPage(props())).rejects.toThrow("NEXT_NOT_FOUND")
  expect(prisma.event.findUnique).not.toHaveBeenCalled()
})

it("404s for a non-numeric id", async () => {
  await expect(EditManagedEventPage(props("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
})

it("renders the details form for a manager, with no money/publish fields", async () => {
  const html = renderToStaticMarkup(await EditManagedEventPage(props()))
  expect(html).toContain("Youth Camp")
  expect(html).toContain('name="title"')
  expect(html).toContain('name="location"')
  expect(html).toContain('name="updatedAt"')
  for (const forbidden of ['name="slug"', 'name="bankBsb"', 'name="registrationDeadline"', "ticketType.", 'name="onlinePaymentEnabled"']) {
    expect(html).not.toContain(forbidden)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="editPage|organiserAccess"`
Expected: `editPage` FAIL (module not found); `organiserAccess` PASS already (allow-list prefix covers `/my-events/42/edit`) — it is a regression guard, keep it.

- [ ] **Step 3: Create the form component**

Create `src/components/events/ManagedEventForm.tsx`:

```tsx
"use client"

import { useActionState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { OrganizersEditor } from "./OrganizersEditor"
import type { Organizer } from "@/lib/eventOrganizers"
import type { ActionResult } from "@/lib/actions/types"
import { CATEGORIES, RECURS_OPTIONS } from "@/lib/eventConstants"

type Props = {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  /** Stored event kind — decides which schedule fields show; never submitted. */
  kind: "one_off" | "recurring"
  defaultValues: {
    slug: string
    title: string
    description: string
    category: string
    date: string
    endDate: string
    recurs: string
    recursLabel: string
    startTime: string
    location: string
    hasBanner: boolean
    hasPoster: boolean
    organizers: Organizer[]
    // Last-seen version for optimistic concurrency.
    updatedAt: Date | string
  }
}

/**
 * Details-only event form for organisers (OSS-41). Carries the same fields as
 * the public-details section of `EventForm` and nothing else — no slug, money,
 * publish, registration or ticket inputs — matching `updateManagedEvent`'s
 * server-side allowlist.
 *
 * @param props - Bound server action, stored event kind and current values.
 * @returns The form element.
 */
export function ManagedEventForm({ action, kind, defaultValues }: Readonly<Props>) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  const recurring = kind === "recurring"
  const updatedAtIso =
    typeof defaultValues.updatedAt === "string" ? defaultValues.updatedAt : defaultValues.updatedAt.toISOString()
  // Force the preview <img> to reload after a replace (same trick as EventForm).
  const cacheBust = `?v=${Date.parse(updatedAtIso)}`

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-8">
      <FormFeedback state={state} />
      <input type="hidden" name="updatedAt" value={updatedAtIso} />

      <section>
        <h2 className="mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">Event details</h2>
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" defaultValue={defaultValues.title} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={defaultValues.description} rows={4} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="category">Category</Label>
            <Select name="category" defaultValue={defaultValues.category || "worship"}>
              <SelectTrigger id="category" className="w-full capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {recurring ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="recurs">Repeats *</Label>
                <Select name="recurs" defaultValue={defaultValues.recurs || "every-sunday"}>
                  <SelectTrigger id="recurs" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECURS_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="recursLabel">Short label</Label>
                <Input id="recursLabel" name="recursLabel" defaultValue={defaultValues.recursLabel} placeholder="2nd Sun" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="startTime">Time</Label>
                <Input id="startTime" name="startTime" defaultValue={defaultValues.startTime} placeholder="9:30 AM" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="date">Date &amp; time *</Label>
                <Input id="date" name="date" type="datetime-local" defaultValue={defaultValues.date} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="endDate">End date &amp; time</Label>
                <Input id="endDate" name="endDate" type="datetime-local" defaultValue={defaultValues.endDate} />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" defaultValue={defaultValues.location} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bannerFile">
              Banner image <span className="text-xs font-normal text-muted-foreground">(optional upload — wide ~1200×400, JPEG/PNG/WebP, max 2 MB)</span>
            </Label>
            {defaultValues.hasBanner && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/${defaultValues.slug}/image/banner${cacheBust}`}
                  alt="Current banner"
                  className="h-16 w-28 rounded border border-border object-cover"
                />
                <label htmlFor="banner.remove" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Checkbox id="banner.remove" name="banner.remove" value="true" />
                  Remove
                </label>
              </div>
            )}
            <Input id="bannerFile" name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="posterFile">
              Poster image <span className="text-xs font-normal text-muted-foreground">(optional upload — portrait ~1080×1350, JPEG/PNG/WebP, max 2 MB)</span>
            </Label>
            {defaultValues.hasPoster && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/${defaultValues.slug}/image/poster${cacheBust}`}
                  alt="Current poster"
                  className="h-24 w-16 rounded border border-border object-cover"
                />
                <label htmlFor="poster.remove" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Checkbox id="poster.remove" name="poster.remove" value="true" />
                  Remove
                </label>
              </div>
            )}
            <Input id="posterFile" name="posterFile" type="file" accept="image/png,image/jpeg,image/webp" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">
          Organisers <span className="text-xs font-normal text-muted-foreground">(optional — shown on the public event page)</span>
        </h2>
        <OrganizersEditor initial={defaultValues.organizers} />
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? "Saving…" : "Save details"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/my-events">Cancel</Link>
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Create the page**

Create `src/app/(organiser)/my-events/[id]/edit/page.tsx`:

```tsx
import Link from "next/link"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"
import { updateManagedEvent } from "@/lib/actions/eventManaged"
import { ManagedEventForm } from "@/components/events/ManagedEventForm"
import { EventSavedBanner } from "@/components/events/EventSavedBanner"
import { toSydneyDatetimeLocal } from "@/lib/dates"
import { parseRouteId } from "@/lib/validation"
import type { Organizer } from "@/lib/eventOrganizers"

type Props = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ saved?: string }>
}

/**
 * Organiser-facing details editor for one managed event (OSS-41). Guarded at
 * the page (404 for anyone who can't manage the event, as for the sibling
 * registrations page) and again in `updateManagedEvent`.
 *
 * @param props - Route params and search params.
 * @returns The edit page.
 */
export default async function EditManagedEventPage(props: Readonly<Props>) {
  const { id } = await props.params
  const { saved } = (await props.searchParams) ?? {}
  const session = await auth()
  if (!session) redirect("/login")

  const eventId = parseRouteId(id)
  if (eventId === null) notFound()

  // IDOR gate: an unassigned event is indistinguishable from a missing one.
  const userId = Number.parseInt(session.user.id, 10)
  if (!(await canManageEvent(userId, eventId, session.user.role))) notFound()

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, slug: true, kind: true, title: true, description: true, category: true, date: true,
      endDate: true, recurs: true, recursLabel: true, startTime: true, location: true,
      organizers: true, updatedAt: true, images: { select: { kind: true } },
    },
  })
  if (!event) notFound()

  const action = updateManagedEvent.bind(null, event.id)
  const organizers = (Array.isArray(event.organizers) ? event.organizers : []) as unknown as Organizer[]

  return (
    <div>
      <Link href="/my-events" className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">
        ← My Events
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-foreground">{event.title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Edit the public details. Pricing, publishing and registration settings are managed by an editor.
      </p>
      {saved && <EventSavedBanner />}
      <ManagedEventForm
        action={action}
        kind={event.kind === "recurring" ? "recurring" : "one_off"}
        defaultValues={{
          slug: event.slug,
          title: event.title,
          description: event.description ?? "",
          category: event.category,
          date: event.date ? toSydneyDatetimeLocal(event.date) : "",
          endDate: event.endDate ? toSydneyDatetimeLocal(event.endDate) : "",
          recurs: event.recurs ?? "",
          recursLabel: event.recursLabel ?? "",
          startTime: event.startTime ?? "",
          location: event.location ?? "",
          hasBanner: event.images.some((i) => i.kind === "BANNER"),
          hasPoster: event.images.some((i) => i.kind === "POSTER"),
          organizers,
          updatedAt: event.updatedAt,
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Add the entry point on the list page**

In `src/app/(organiser)/my-events/page.tsx` replace the `<li>` body so the card link and a sibling edit link are not nested (nested `<a>` is invalid HTML):

```tsx
            <li key={e.id} className="flex items-stretch gap-2">
              <Link
                href={`/my-events/${e.id}/registrations`}
                className="flex flex-1 items-center justify-between rounded-lg border bg-card p-4 transition-colors duration-200 hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{e.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.date ? formatSydneyDate(e.date) : e.recursLabel || "Recurring"}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">{e._count.registrations} registrations</span>
              </Link>
              <Link
                href={`/my-events/${e.id}/edit`}
                className="flex items-center rounded-lg border bg-card px-4 text-sm text-muted-foreground transition-colors duration-200 hover:bg-accent"
              >
                Edit details
              </Link>
            </li>
```

- [ ] **Step 6: Run tests**

Run: `npm test -- --testPathPatterns="editPage|my-events|organiserAccess"`
Expected: PASS (new page suite, existing `my-events` page + layout suites, middleware allow-list).

- [ ] **Step 7: Type check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git branch --show-current && git status -s
git add src/components/events/ManagedEventForm.tsx "src/app/(organiser)/my-events" src/lib/__tests__/organiserAccess.test.ts
git commit -m "feat(events): organiser details edit page under /my-events (OSS-41)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, spec alignment, final checks, PR

**Files:**
- Modify: `website/src/content/docs/docs/roles-and-permissions.md` (organiser cells at lines ~38, ~73)
- Modify: `website/src/content/docs/docs/event-organisers.md` (line ~37 "cannot create or edit events" + new section)
- Modify: `docs/superpowers/specs/2026-10-30-organiser-edit-events-design.md` (two small corrections)
- Check: `README.md` for stale organiser claims

- [ ] **Step 1: Align the spec with what was built**

In the spec, (a) in the editable-fields list add `recurrence pattern` next to `recurrence label`; (b) change the audit metadata text `{ fields: [changed keys], by: "organiser" }` to `{ slug, role, fields: [changed keys] }`.

- [ ] **Step 2: Update the website docs**

`roles-and-permissions.md` — in the `EVENT_ORGANISER` role row append: `They can edit the public details of events they manage at /my-events/[id]/edit.` In the capability table row `Edit people & families / events` change the organiser cell from `Own assigned events only` to `Own assigned events: details only (not pricing, publishing or registration settings)`.

`event-organisers.md` — change `cannot create or edit events` to `cannot create events or change pricing, publishing or registration settings`, and add this section after the check-in bullets:

```md
## Editing event details

Open **My Events** and choose **Edit details** next to an event you manage
(`/my-events/[id]/edit`). You can change the title, description, category, date and time,
location, recurrence settings, organiser contacts, and the banner and poster images.

You cannot change the public link (slug), ticket types and prices, bank details, card
payments, registration deadline, capacity, reminders, publishing, or who manages the event.
Ask an editor for those. Saving a published event updates the public event page and the
website straight away. If an editor changed the event after you opened the form, you are
asked to reload and re-apply your edit.
```

- [ ] **Step 3: Check README for stale claims**

Run: `grep -n -i "organiser" README.md | head`
Expected: if a line claims organisers cannot edit events, fix it to match; otherwise no change.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test -- --testPathPatterns="eventManaged|eventFormManaged|editPage|organiserAccess|my-events|event.test"`
Expected: all clean/green. Quote the pass counts in the PR body.

- [ ] **Step 5: Commit and push**

```bash
git branch --show-current && git status -s
git add website/src/content/docs/docs docs/superpowers README.md
git commit -m "docs(events): organiser details editing (OSS-41)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feat/oss-41-organiser-edit
```

- [ ] **Step 6: Open the PR, add to board, review**

PR title: `feat(events): let organisers edit their own event details (OSS-41)`. Body: summary, field allowlist, test evidence, docs updated, ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Add the PR to the board (`/board`, REST add, Status=Review). Logic is ~250 lines and touches authorization, so run `/code-review high` with `model: opus`, fix findings, then bots, then the merge gate in `parishcrm/CLAUDE.md` (risky class: wait for a real CodeRabbit review of head).
