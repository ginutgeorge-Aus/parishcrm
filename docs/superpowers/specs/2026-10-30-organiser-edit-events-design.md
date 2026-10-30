# Organisers edit their own events (OSS-41)

## Goal
An `EVENT_ORGANISER` can edit the public details of events they manage, from
`/my-events/[id]/edit`, without gaining access to money, publishing or admin settings.

## Decisions
- **Field scope (PO, 2026-10-30): details only.** Editable: title, description, category,
  date, end date, location, start time, recurrence label, public organiser contacts,
  banner and poster images. Staff-only (unchanged): slug, publish state, registration
  settings (capacity, deadline, close, custom questions, reminder), ticket types, pricing
  tiers, family waiver, bank details, Stripe toggles, managers, volunteer token, delete.
- **Approach: dedicated action** `updateManagedEvent`, not a role branch inside
  `updateEvent`. `updateEvent` is a Serializable transaction over ticket types; keeping
  organisers out of it removes any path to money fields. Rejected: role branch in
  `updateEvent` (one missed branch leaks money fields).

## Design
### Page
`src/app/(organiser)/my-events/[id]/edit/page.tsx`. Inside the existing organiser layout,
so `isOrganiserAllowedPath` needs no change. Loads the event, calls `canManageEvent`;
non-manager or unknown id returns `notFound()`. Renders a details-only form
(`ManagedEventForm`) reusing `OrganizersEditor` and the image inputs from `EventForm`.
"Edit details" link added to the organiser event page.

### Action
`updateManagedEvent(id, prev, formData)` in `src/lib/actions/event.ts` (or a sibling file
if size warrants):
1. `auth()`; `featureGuard("events")`; `isValidPgId(id)`.
2. `canManageEvent(userId, id, role)` else `{ error: "Unauthorized" }` (page and action
   both guard). Staff pass this check too, but the UI only exposes the form to organisers.
3. Parse with a Zod `EventSchema.pick(...)` over the allowlisted keys plus
   `parseOrganizers` and `parseImageUpload`. Any other form key is never read.
4. Update with `updateMany({ where: { id, updatedAt: seenAt } })` (optimistic
   concurrency, same as `updateEvent`); 0 rows returns the reload message.
5. `applyImageOp` for banner/poster, `logAudit(..., "EVENT_UPDATED", "Event", id,
   { fields: [changed keys], by: "organiser" })`, `syncEventToWebsite(id)`,
   `revalidatePath("/events")`, `revalidatePath("/my-events")`.
   Edits to a published event reach the public website, same as a staff edit.

### Tests
- non-manager organiser, other-event id, stale-role (downgraded) user: `Unauthorized`
- manager organiser: allowlisted fields saved
- forged keys (`slug`, `isPublished`, `capacity`, `bankBsb`, ticket fields) ignored
- stale `updatedAt` rejected; audit row written; page 404s for non-manager
- middleware: `/my-events/[id]/edit` allowed, `/events/[id]/edit` still redirects

### Docs
`website/src/content/docs/docs/roles-and-permissions.md` (organiser row),
`event-organisers.md`, and any stale README claim, in the same PR.

## Out of scope
Registration settings, pricing, publish toggle, slug, manager assignment.
