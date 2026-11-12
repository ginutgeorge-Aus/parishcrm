---
title: "Service Attendance"
description: "Record how many adults and children attended each service, then see weekly, monthly and year-over-year trends and a headcount tile on the dashboard."
---

Attendance is a **headcount** per service: one number for adults and one for children, recorded
for a service date and a service type. It is not a per-person check-in. Counts are typed in after
the service from the paper count.

ADMIN, PASTOR and OFFICE_ADMIN enter, edit and delete headcounts and see **Community → Attendance**
(`/attendance`). VIEWER sees the trends only (**Community → Attendance trends**). AUDITOR and
EVENT_ORGANISER do not see attendance at all.

## Entering a headcount

1. Pick the **service date** (today by default; back-dating is fine, future dates are refused)
   and the **service**.
2. Set **adults** and **children** with the − / + buttons, or tap the number and type it. The
   **total** updates as you go. The form is a single column on a phone, with a Save button that
   stays at the bottom of the screen.
3. Add optional **notes** and press **Save headcount**.

There is one headcount per date and service. If one already exists, choosing that date and service
loads its counts and the form says you are editing it; saving replaces it. Saving from two devices
at once is safe — the second save just edits the first.

**Recent headcounts** lists the latest entries with **Edit** and **Delete**. Deleting removes the
entry and that week becomes a gap in the charts. Every save and delete is recorded in the audit log.

Service types are the same ones used by Petty cash (**Petty cash → Service types**, ADMIN). A
deactivated service type no longer appears in the entry form, but its past headcounts stay in the
charts. With no active service types the page says so instead of showing a form.

## Trends

**Attendance trends** (`/attendance/trends`) has three views. The view, the service filter and the
year comparison are kept in the page address, so you can share a link to exactly what you see.

- **Weekly** — the last 26 weeks, adults and children stacked. Weeks run Monday to Sunday
  (Sydney time).
- **Monthly** — the last 12 months.
- **Year** — this year against last year, by month or by ISO week number.

Use the **Service** filter to look at one service; the default is all services combined (a week
with two services shows the sum of both).

### Gaps are not zeros

A week or month with **no headcount recorded** is left blank in the chart. It is never drawn as
zero, so a week the church was closed does not look like attendance collapsed. An entry you
deliberately record as 0 adults and 0 children *is* a real zero and is plotted as 0. In the year
view, a period with no matching one last year (for example week 53) is simply blank on that line.

## Dashboard tile

The dashboard shows the **latest headcount** (by service date, not entry time): service, date,
adults, children and total, with the change against the same service exactly one week earlier
(for example *+12 vs last week*). If that service had no headcount a week earlier, the change is
not shown. Everyone who can see attendance gets the tile; editors also get an *Enter a headcount*
link when nothing has been recorded.

## Who can do what

| | ADMIN / PASTOR / OFFICE_ADMIN | VIEWER | AUDITOR / EVENT_ORGANISER |
|---|---|---|---|
| Enter, edit, delete headcounts | yes | no | no |
| Trends and dashboard tile | yes | yes | no |

There is no CSV export, and the numbers are totals only — no names are stored.
