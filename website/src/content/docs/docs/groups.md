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

## Leader logins

The *Leader* role is a label: a leader may have no login at all. To let a volunteer manage a
group's members themselves, create an **Event organiser** login for them under Users, then link
it on the group's page under **Leader logins**.

A linked login sees **Groups** in the organiser portal (`/my-groups`) and can search people by
name, add and remove members and change roles and titles — for the groups linked to them only.
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
| Print / export CSV | Yes | Yes | No | No |

Every change (group created, edited, archived, restored; member added, updated, removed; leader
login linked or unlinked) writes an audit-log row in the same database transaction as the change.

## Not in this version

Group email is planned as a follow-up. Custom role lists, SMS, attachments, group attendance
and volunteer rosters are out of scope for now.
