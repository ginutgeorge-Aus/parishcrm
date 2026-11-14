---
title: "Sacramental Register"
description: "Keep the parish register of baptisms, confirmations, marriages and first communions, with permanent register numbers, a Sacraments card on each person, and a printable certificate PDF."
---

The sacramental register lives under **Community → Sacraments** (`/sacraments`). It records each baptism, confirmation, marriage and first holy communion for people in your CRM, gives every entry a permanent register number, and prints a certificate on request. There is nothing to switch on: the register is part of the core app.

## Who can do what

| Role | View the register and certificates | Add, edit, delete |
|---|:---:|:---:|
| ADMIN | Yes | Yes |
| PASTOR | Yes | Yes |
| OFFICE_ADMIN | Yes | No |
| Every other role | No | No |

OFFICE_ADMIN can look up an entry and print a certificate but cannot change the register. Other roles do not see the **Sacraments** link or the Sacraments card on a person, and the pages send them away.

## Register numbers

Each entry is numbered by rite and by the calendar year of the rite date, for example `BAP-2026-014` is the fourteenth baptism of 2026.

| Rite | Prefix |
|---|---|
| Baptism | `BAP` |
| Confirmation | `CON` |
| Marriage | `MAR` |
| First Holy Communion | `FHC` |

Numbers are assigned when you save and are never reused. If you delete an entry, its number stays retired and the next entry takes the next number. A year past 999 entries keeps every digit (`BAP-2026-1000`).

## Browse the register

Open **Sacraments** in the sidebar. The list shows register number, rite, person, date and place, newest first. Use the **Sacrament** and **Year** filters to narrow it. The page shows the latest 500 entries and says so when there are more; filter to see the rest. Select a register number for the entry's detail page.

## Add an entry (ADMIN, PASTOR)

1. Choose **Add entry**, then search for the person by first or last name. From a person's page you can instead use **Add** on their **Sacraments** card, which skips the search.
2. Choose the sacrament, enter the date and place, and optionally the minister, godparents (or sponsors and witnesses) and notes.
3. For a marriage, enter the spouse's name. A marriage needs exactly one spouse.
4. Select **Add to register**. The new entry opens with its number.

Rules the form enforces:

- The date cannot be in the future (church local time) or before 1800, so old paper registers can be transcribed.
- Spouse details are for marriages only.
- A person can have more than one entry of a rite, for example two marriages.

The search lists current (not archived) people. A register entry is permanent: it stays linked to the person even after their family is archived.

## Edit or delete (ADMIN, PASTOR)

**Edit** changes the date, place, minister, spouse, godparents and notes. The rite, the person and the register number are fixed. The date can change only within the year the entry was numbered. If two people edit at once, the second save is refused with a message to refresh.

To correct a wrong rite or person, delete the entry and enter it again. Deleting asks for confirmation and retires the number.

A person who has register entries cannot be deleted from People. The delete is refused with a message pointing to archiving the family instead.

## Sacraments card on a person

A person's page shows a **Sacraments** card listing their entries oldest first, each linking to the entry. A marriage also appears on the spouse's page when the spouse is a CRM member. Roles allowed to see the register (ADMIN, PASTOR, OFFICE_ADMIN) see the card; **Add** appears for ADMIN and PASTOR only.

## Print a certificate

On an entry's detail page, choose **Certificate (PDF)**. The PDF opens in a new tab for printing or saving. It is A4 landscape with your church letterhead (the image from **App Settings → Branding**, or the church name and address when none is uploaded), the person's name, the rite, the date and place, the minister and godparents when recorded, and the register number. A marriage certificate names both spouses. Notes are never printed.

Each certificate download is recorded in the audit log.

## Privacy and audit

Spouse name, godparents and notes are encrypted in the database, like other personal details. Every add, edit and delete is audited as `SACRAMENT_RECORD_CREATED`, `SACRAMENT_RECORD_UPDATED` or `SACRAMENT_RECORD_DELETED`, and every certificate as `SACRAMENT_CERTIFICATE_PRINTED`. Audit entries carry the register number, rite and ids only, never the encrypted text. See [Privacy and Audit Log](/parishcrm/docs/privacy-and-audit-log/).
