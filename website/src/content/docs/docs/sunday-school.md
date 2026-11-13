---
title: "Sunday School"
description: "Set up Sunday School classes for each school year, assign teachers, enrol children from People, take the class roll on a phone, record exam marks, download attendance and marks reports, and roll the whole school over to next year in one step."
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

### Reports

Press **Reports** on the class list (`/sunday-school/reports`). Pick a **year**, one **class** or
*All classes*, and the **columns** you want, then press **Show report** to preview it on screen.
The child's name is always included; the optional columns are:

- **Family** — the child's family name.
- **Attendance** — how many rolls the child was marked Present, Late and Absent on in that class,
  and **Attendance %** = (present + late) ÷ rolls marked. Rolls where the child wasn't marked don't count.
- **Exam marks** — for one class, a column per exam with the child's score (blank = not marked);
  for all classes, how many exams the child has a score in. **Marks %** = total score ÷ total marks
  of the exams the child was marked in, so an unmarked exam doesn't pull the percentage down.

**Download Excel** saves a `.xlsx` workbook (numbers stay numbers, ready to sort or chart) and
**Download PDF** a landscape A4 table for printing. Archived classes and archived exams are left out.
Reports are read-only, so everyone who can browse Sunday School (ADMIN, PASTOR, OFFICE_ADMIN,
Headmaster, VIEWER) can run them; Teacher logins cannot. Each download is written to the audit log
(year, format and columns, never the children's names).

### Who sees what

| Role | Sunday School access |
|---|---|
| ADMIN, PASTOR, OFFICE_ADMIN | Everything: classes, teachers, enrolment, rolls, exams, reports, rollover |
| **Headmaster** | All classes: setup, enrolment, rolls, exams, reports, rollover. Nothing outside Sunday School: no People, accounting or pastoral notes. Can reach their own account page and help |
| **Teacher** | Only classes they are assigned to (`/my-classes`): see the children, take the roll, enter exam marks. Cannot change class setup. Sees child names and class only, no family contact details |
| VIEWER | Read-only, including reports |

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
