# Event webhook (optional website sync)

The CRM can push event changes (drafts included, flagged by `isPublished`) to
an external website so it can list upcoming events without its own admin.
**Off by default** — enabled only when both env vars are set (see `docs/environment.md`):

| Var | Meaning |
|-----|---------|
| `WEBSITE_SYNC_URL` | Receiver endpoint. Must be a public `https://` URL — loopback, private, link-local, CGNAT/benchmark IPv4, non-canonical IPv4 encodings and all IPv6 literals are refused (canonical public IPv4 is allowed). Literal-host check only — a DNS name that resolves to a private address is **not** blocked. |
| `WEBSITE_SYNC_SECRET` | Shared HMAC key (e.g. `openssl rand -base64 32`). |

URL without secret fails startup env validation (the server won't boot).
Secret without URL boots, sends nothing, and logs a misconfiguration warning on
each sync attempt.
When configured, ADMINs also get a **Resync website** button on `/events` that
re-sends an `upsert` for every existing event (lowest id first, capped at 500;
the button reports when the cap was hit). It recovers missed creates/updates
only — it never sends `delete`, so an event deleted in the CRM while the
receiver missed the webhook (or restored from an older backup) stays on the
website until removed there by hand.

Sender: `src/lib/websiteSync.ts`. Delivery is synchronous best-effort: the
event action awaits the POST, so a slow or unreachable receiver can delay a
save by up to the 8 s timeout, but errors are swallowed and never fail the
action. Failures are logged, not retried.

## Request

`POST <WEBSITE_SYNC_URL>`, 8 s timeout, redirects are **not** followed.

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Sync-Timestamp` | Unix seconds, as a string |
| `X-Sync-Signature` | hex `HMAC-SHA256(secret, "<timestamp>.<raw body>")` |

Body is one of:

```jsonc
// Create / update / publish / unpublish
{ "action": "upsert", "event": { /* payload below */ }, "nonce": "<uuid>" }

// Event deleted in the CRM
{ "action": "delete", "crmId": 42, "nonce": "<uuid>" }
```

`event` payload (`WebsiteEventPayload`):

| Field | Type | Notes |
|-------|------|-------|
| `crmId` | number | Stable key — upsert/delete by this |
| `title` | string | |
| `description` | string \| null | |
| `category` | string | |
| `kind` | string | `one_off` or `recurring` |
| `date`, `endDate` | ISO 8601 \| null | `date` set for one-off events only |
| `recurs`, `recursLabel` | string \| null | Recurring events only |
| `startTime` | string \| null | |
| `location` | string \| null | |
| `isPublished` | boolean | Receiver must hide `false` events itself (drafts are sent too) |
| `registerUrl` | string \| null | CRM public page `/e/<slug>`; only when the event has ticket types and `AUTH_URL`/`NEXTAUTH_URL` is set |
| `imageUrl` | string \| null | Pasted image URL, else the CRM's uploaded-banner URL (needs `AUTH_URL`/`NEXTAUTH_URL`) |
| `revision` | ISO 8601 string | Event's last-updated time, millisecond precision — see ordering below |

## Receiver MUST

1. Recompute the signature over `<X-Sync-Timestamp>.<raw body bytes>` and compare in constant time.
2. Reject when `abs(now - X-Sync-Timestamp) > 300` seconds (replay window).
3. Drop any `nonce` already processed. Retain seen nonces for at least 600 s
   (twice the skew window — a request stamped 300 s ahead stays timestamp-valid
   for ~600 s after first receipt).
4. Return 2xx on success — any other status is logged as a failed sync.

Nonce dedup is essential, not optional: replaying an older upsert after a
newer update or delete would overwrite the newer state or resurrect a deleted
event.

Delivery order is **not** guaranteed: two near-simultaneous saves (or a save
racing a resync) can arrive out of order. To drop a stale snapshot, store each
event's `revision` and skip an upsert whose `revision` is **strictly older**
than the stored one (ISO 8601 UTC strings of equal format compare correctly as
plain strings). Apply when equal — every synced change (including banner and
ticket-type edits, written in the same transaction as the event row) advances
`revision`, so an equal revision is the same snapshot, and re-applying it lets
**Resync website** repair a receiver whose copy drifted. Two saves landing in
the same millisecond could share a revision; that is an accepted residual risk
(staff edits, and the event editor already rejects a save made over a newer
version). Treat a missing stored
revision (or a payload without one, from an older CRM) as "apply". Deletes carry
no revision; running **Resync website** restores the current state.
