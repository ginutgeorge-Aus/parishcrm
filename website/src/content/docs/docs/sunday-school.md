---
title: "Sunday School"
description: "Set up Sunday School classes for each school year, assign teachers, enrol children from People, and roll the whole school over to next year in one step."
---

Sunday School lives under **Members → Sunday School** (`/sunday-school`). Classes belong to a
school year (the calendar year). ADMIN, PASTOR and OFFICE_ADMIN can set classes up; VIEWER can
look but not change anything.

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
- **Archive** — removing a class archives it; enrolments and (later) attendance history are kept.
- **Roll over to next year** — on the class list, once per year: copies every active class and its
  still-tagged teachers into next year and moves each child up one level at the same location. Children in the
  top class, or where two next-level classes exist at the same location, are left for you to place.

## How it works

Classes, teacher links and enrolments are three tables keyed to People; nothing here is
encrypted because it holds only names you already see in People, class names and levels.
One-class-per-child-per-year is enforced by the database. Every change made through Sunday School is written to the audit log.
