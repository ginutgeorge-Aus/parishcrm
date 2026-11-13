---
title: "Groups & Ministries"
description: "Keep a member list for each ministry, committee or fellowship group, mark leaders and titles, print or export the list, and let a group leader manage their own members from a phone."
---

Groups live under **Community → Groups** (`/groups`). A group is a ministry (choir, youth),
a committee (parish council), a fellowship (prayer group) or anything else. ADMIN, PASTOR and
OFFICE_ADMIN can create and change groups; VIEWER can look but not change anything.

## Using it

- **Groups list** — every active group with its category and member count. Use the category
  chips (*Ministry*, *Committee*, *Fellowship*, *Other*) to filter. *Show archived groups* lists
  archived ones.
- **New group** — a name (unique), a category and an optional description.
- **Members** — on a group, search people by name and press *Add*. Each member has a **role**
  (*Leader* or *Member*) and an optional free-text **title** ("Secretary", "Treasurer"); change
  them and press *Save*. *Remove* takes the person out of the group. Leaders are listed first.
- **Print / Export CSV** — a printable member list and a CSV with name, family, role, title,
  joined date, email and mobile. Both are recorded in the audit log.
- **Archive** — *Edit → Archive group* hides the group from the list and from leaders' *My groups*.
  Members are kept; an archived group can be restored from its page.
- **Person page** — each person's profile has a *Groups* card listing the groups they belong to.

## Emailing a group

On a group's page press **Email group** (or, for a linked leader login, the same button on the
group's page in `/my-groups`). Write a subject and a plain-text message. Before sending, the page
shows how many members will receive it and lists anyone who will not: members who opted out of
email, have no email address, or whose address cannot be read.

- Each person gets their own email, greeted by first name, signed with the group and church name.
  Addresses are never shown to other recipients and never stored with the message.
- **Sent messages** shows the latest 20 messages (use *Older messages* for earlier ones), each
  with a count per status: *Queued*, *Sent*, *Failed* or *Unconfirmed*. Opening a message lists
  the people who have not been sent it yet; people who received it are counted, not listed.
- A send that fails cleanly (for example the mail server was unreachable) is retried
  automatically, up to 3 tries, for 7 days after the message was written. A person who is no
  longer eligible when the email goes out (left the group, archived, opted out, or no address) is
  marked *Failed* and is not retried. Anyone still *Queued* after 7 days is marked *Failed*.
- When a send fails, the owner notification address gets one alert for that send, not one
  per person.
- *Unconfirmed* means the app could not confirm whether the email was delivered: the mail server
  did not give a clear answer, or the app could not record the result afterwards. It may have been
  delivered, so it is never resent automatically. Check with the person before sending again.
- A group can be emailed once every 5 minutes. Each send is recorded in the audit log.

## Leader logins

The *Leader* role is a label: a leader may have no login at all. To let a volunteer manage a
group's members themselves, create an **Event organiser** login for them under Users, then link
it on the group's page under **Leader logins**.

A linked login sees **Groups** in the organiser portal (`/my-groups`) and can search people by
name, add and remove members, change roles and titles and email the group — for the groups linked to them only.
They see names, families, roles and titles, never contact details, and cannot print or export
the list. Opening any other group's page shows "not found". Unlinking the login, archiving the
group or changing the login's role away from Event organiser removes the access.

## Who can do what

| | ADMIN / PASTOR / OFFICE_ADMIN | VIEWER | EVENT_ORGANISER | AUDITOR |
|---|---|---|---|---|
| See groups and members | Yes | Yes | Linked groups only (`/my-groups`) | No |
| Create, edit, archive, restore groups | Yes | No | No | No |
| Add / remove members, set role and title | Yes | No | Linked groups only | No |
| Link leader logins | Yes | No | No | No |
| Email a group, see sent messages | Yes | No | Linked groups only | No |
| Print / export CSV | Yes | Yes | No | No |

Every change (group created, edited, archived, restored; member added, updated, removed; leader
login linked or unlinked) writes an audit-log row in the same database transaction as the change.

## Not in this version

Custom role lists, SMS, attachments, rich-text email, group attendance
and volunteer rosters are out of scope for now.
