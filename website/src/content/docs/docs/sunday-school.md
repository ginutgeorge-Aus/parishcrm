---
title: "Sunday School"
description: "Set up Sunday School classes for each school year, assign teachers, enrol children from People, take the class roll on a phone, record exam marks, see attendance and exam progress per grade, class and child, and roll the whole school over to next year in one step."
---

Sunday School lives under **Community → Sunday School** (`/sunday-school`). Classes belong to a
school year (the calendar year). ADMIN, PASTOR, OFFICE_ADMIN and **Headmaster** can set classes up;
VIEWER can look but not change anything. **Teacher** logins only see the classes they are assigned to
(see [Who sees what](#who-sees-what)).

## Using it

- **Classes** — *New class* asks for a name ("Years 1–2"), a **level** (0 = Kindy/Prep, 1 = Year 1 …)
  and an optional **location** (campus, room or group). Level orders the list and decides where
  children move at rollover. Use the year arrows to look at other years.
- **Teachers** — on a class, *Add teacher* lists people tagged **Sunday school teacher** on their
  profile ([People and Families](/parishcrm/docs/people-and-families/)). Each teacher shows their WWCC status, so gaps are visible
  where the class is managed.
- **Children** — *Add children* lists people not in this class; *Children only* (on by default)
  shows people whose family role is Child. A child can be in one class per year: enrolling a child
  who is already in another class moves them. The child's class also shows on their profile.
- **Archive** — removing a class archives it; enrolments and attendance history are kept.
- **Roll over to next year** — on the class list, once per year: copies every active class and its
  still-tagged teachers into next year and moves each child up one level at the same location. Children in the
  top class, or where two next-level classes exist at the same location, are left for you to place.
  Rolling over **locks the year you rolled from**: its classes, teachers, enrolments, roll markers and
  rolls become read-only (a *Locked* badge shows, and edit controls are hidden), so history can't drift
  after children have moved on. An **admin** can reopen a locked year with **Unlock year** on the class list, and can lock an open past year that has classes with **Lock year**; both ask to confirm. Roll over into a locked year is refused. Locking blocks edits to that year's classes, enrolments and rolls until an admin unlocks it, and a person with Sunday School history in a locked year can't be permanently deleted (archive their family instead). Years rolled over before this feature arrived aren't locked automatically — use **Lock year** to close them.

### Taking the roll

Open a class and press **Take roll** (`/sunday-school/[id]/roll`). The date defaults to today (a
past year's class opens on 31 December instead); change it to enter an earlier week. Each child has **Present**, **Late** and **Absent** buttons:
one tap marks, tapping the same button again clears it. **Mark unmarked present** fills in
everyone you haven't marked, so for a full class you tap only the absentees. Counts at the top
update as you go. Late counts as attended. The class page lists the last ten rolls with their
counts.

Volunteer teachers don't need dashboard access: create a login with the **Teacher** role
(Users → New user), then add it under **Roll markers** on the class. On their phone they sign in,
land on **Classes** (`/my-classes`) and see only the classes they're assigned to. A teacher can be
assigned to any number of classes, and a class can have several. VIEWER accounts can see rolls but not
change them. (Older Event organiser logins that were assigned to classes keep working; the upgrade
converted the ones used only for rolls to Teacher.) Rolls for archived classes, and for a year that has been rolled over, are read-only. Future dates, and dates outside the class's
year, are refused.

### Exams

Open a class and press **Exams** (`/sunday-school/[id]/exams`). *Add an exam* takes a name ("Term 2
Bible"), a date and **total marks**. A class can have any number of exams in its year; use a
separate exam for each subject. Press **Edit** beside an exam to change its name, date or total
marks, or **Archive** to remove it from the list (its scores are kept). Headmasters, editors
(ADMIN, PASTOR, OFFICE_ADMIN) and teachers assigned to the class see Edit and Archive; read-only
roles such as VIEWER do not.

An exam cannot repeat another's name and date, and the total cannot go below a score already
entered.

Open an exam to enter a **score** for each enrolled child, from 0 up to the total marks. A child
with no score is simply "not marked". There is no pass or fail and no ranking.

Scores stay with the class and year the exam belongs to, so moving a child later does not change
past results. Exams in a locked year are read-only, and every change is in the audit log.

### Progress

Progress pages show attendance and exam marks together, read-only:

- **By grade and class** — press the year's progress link (for example **2026 progress**) on the Sunday School page
  (`/sunday-school/progress`). Each level (grade) and each class shows its attendance rate and
  exam average for that school year. Archived classes are included, marked **Archived**, so each
  grade's figure matches its classes. Use the year arrows to look back.
- **One class** — press **Progress** on a class (`/sunday-school/[id]/progress`). The class
  totals, then one row per enrolled child, in name order.
- **One child** — press a child's name there. Every roll (present, late, absent or not marked)
  and every exam with their score out of the total. Rolls and exams from before the child was
  enrolled are left out unless the child has a mark or score on them. A child moved from another
  class counts as enrolled from the day of the move, so the new class's earlier rolls and exams
  are left out the same way.

**Attendance** is present or late, out of the rolls where the child was marked; a roll where they
were not marked counts neither way. **Exams** is the average of each score as a percent of that
exam's total, every result counting the same, rounded once to a whole percent. Only children
still enrolled (and not archived) and live exams count, so the class figure is always the total
of the rows shown. A dash means there is nothing marked yet. A rate shows 100% only when nobody was absent, and 0% only when nobody
attended. An exam result with a broken score or a zero total isn't averaged; the page says how
many results were not counted. Children are listed by name, never ranked.

ADMIN, PASTOR, OFFICE_ADMIN, Headmaster and VIEWER can open progress pages. Teacher logins
cannot yet.

### Emailing parents

Anyone who can take a class's roll can email that class's parents. Press **Email parents** on the
class (`/sunday-school/[id]/message`, or **Email parents** next to the class on `/my-classes` for a
Teacher login), tick the children, and write a subject (up to 200 characters) and a plain-text
message (up to 10,000 characters). On a roll that has absentees, **Email parents of absent
students** opens the same page with only the children marked absent that day ticked.

Emails are only ever sent by hand. Nothing goes out automatically when a child is marked absent.

- **Who gets it**: the HEAD and SPOUSE of each ticked child's family who have a readable email
  address and have not opted out of email. A parent of two ticked siblings gets one email.
- **Skipped children**: a child whose family has no HEAD/SPOUSE, or none that can be emailed, is
  listed by name with the reason. Addresses are never shown.
- Each email greets the parent by first name and ends with the class and church name. One send
  per class every 5 minutes. A class in a locked (rolled-over) year cannot be emailed.
- Sent emails are listed on the class page and the email page with how many were sent, failed or
  are still queued. Failed sends retry automatically for a week. Each send is in the audit log
  (counts only, no addresses).

### Who sees what

| Role | Sunday School access |
|---|---|
| ADMIN, PASTOR, OFFICE_ADMIN | Everything: classes, teachers, enrolment, rolls, exams, rollover |
| **Headmaster** | All classes: setup, enrolment, rolls, exams, rollover. Nothing outside Sunday School: no People, accounting or pastoral notes. Can reach their own account page and help |
| **Teacher** | Only classes they are assigned to (`/my-classes`): see the children, take the roll, enter exam marks, email the class's parents. Cannot change class setup. Sees child names and class only, no family contact details |
| VIEWER | Read-only |

There can be several Headmasters. OFFICE_ADMIN and ADMIN can create Headmaster and Teacher logins
under Users; only ADMIN can assign ADMIN or PASTOR.

## How it works

Classes, teacher links and enrolments are three tables keyed to People; nothing here is
encrypted because it holds only names you already see in People, class names and levels.
One-class-per-child-per-year is enforced by the database. Every change made through Sunday School is written to the audit log.

A roll (one per class and date) is created on the first mark; a child with no mark has no row.
Each mark records who marked it and when. A child moved to another class keeps their earlier
marks, and still shows on those past rolls tagged "not enrolled"; while the year is unlocked such a
mark can be changed but not cleared, so it is never lost by a stray tap. Every mark, bulk action and
roll-marker change is in the audit log.
