---
title: "Pastoral Follow-up"
description: "Track follow-up tasks on people and families, keep a private list of prayer requests, and let members send a request from a public page."
---

Pastoral follow-up has two parts: **follow-up tasks** (a to-do against a person or a family, such as
"Visit after surgery") and **prayer requests**. Both hold sensitive text, so both are private by
default and encrypted in the database. There is no feature switch: the pages are always available
to the roles below.

## Who sees what

| | ADMIN / PASTOR | OFFICE_ADMIN | VIEWER / AUDITOR / EVENT_ORGANISER / Sunday School roles |
|---|---|---|---|
| Follow-ups: see every task, add, edit, delete | yes | no | no |
| Follow-ups: see and update tasks assigned to them | yes | yes | no |
| Prayer requests: list, add, answer, archive | yes | no | no |

A follow-up can only be assigned to a login with edit access (ADMIN, PASTOR or OFFICE_ADMIN). An
assignee sees only their own tasks, and can change a task's status but not its text, due date or
assignee. A person or family whose record is archived drops out of every follow-up list.

## Follow-up tasks

**Community → Follow-ups** (`/follow-ups`) lists tasks, soonest due date first (tasks with no due
date come last). Overdue open tasks carry an **Overdue** badge.

- **Status** chips: *Open* (open and in progress, the default), *Closed* (done and cancelled) and *All*.
- **Assignee** chips (ADMIN and PASTOR): *Everyone*, *Mine*, *Unassigned*, or one person.
- Each row has **Start**, **Mark done** or **Reopen**; ADMIN and PASTOR can also **Delete** (with a confirmation).

You add a follow-up from the record it is about. Open a person or a family and use the
**Follow-ups** card: enter a title, an optional assignee, due date and notes, then press **Add
follow-up**. The same card lists that record's tasks. Tasks are in-app only; there are no emails. A task assigned to you that is due today or
earlier adds a count badge to the **Follow-ups** link in the sidebar.

## Prayer requests

**Community → Prayer requests** (`/prayer-requests`, ADMIN and PASTOR) lists requests by status:
*Active* (default), *Answered* and *Archived*. Each row shows the date, a **Public form** badge when
a member sent it themselves, whether it is **Private** or **OK to share**, the request text and any
name and contact the requester gave.

- **Mark answered**, **Archive** and **Restore** move a request between the statuses.
- **Add a prayer request** at the bottom records one you were told in person. Tick **OK to share**
  only when the requester agreed.

**OK to share** is recorded only: no bulletin list ships yet, so ticking it changes nothing you
can see beyond the badge. The choice is kept so a future bulletin list can honour it.

## Public prayer request form

Members do not need a login. They open `/prayer-request` on your site (it is not linked from
anywhere; share the address yourself, for example on your website or in a notice). The form asks for
the request, and optionally a name, email and phone, plus an **OK to share** tick. Without the tick
the request stays private to pastors and admins. The tick is recorded only; nothing is published.

To keep spam out, the form has a hidden field that people never see (anything typed there is
dropped without an error, so a bot cannot tell), refuses a send that follows the page opening by
under 3 seconds, and allows 5 submissions per hour from one internet address. Over the limit, the
form says to try again later. If your server does not pass on a trusted client address (see the
`CLIENT_IP_HEADER` setting), the form refuses every submission rather than sharing one limit
between all visitors. There is no CAPTCHA yet. A
submission appears in **Prayer requests** with the **Public form** badge; there is no email
notification.

## Privacy

- The request, title, notes, and requester contact details are encrypted at rest.
- Audit entries record ids and flags only (never the text or contact), and the public form stores
  no IP address with the request. The rate limit keeps the visitor's address (or its IPv6 prefix)
  for up to an hour.
- Tasks and requests are read through server actions that check your role on every call, so a link
  guessed by someone without access shows nothing.
