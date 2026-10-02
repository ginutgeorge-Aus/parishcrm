// Pure, deterministic live-demo data. No DB, no crypto, no Date.now() — the
// caller passes `today`, so the same (today, seed) always yields identical
// output and the dashboard always looks current after the nightly reset.
// Everything here is synthetic: @example.com emails, ACMA fictional mobiles
// (0491 570 006–159), invented suburbs. Public AGPL repo — keep it that way.
import { DEMO_LOGINS, type UserRoleName } from "../../src/lib/demoMode"

export type DemoPerson = {
  firstName: string; lastName: string
  role: "HEAD" | "SPOUSE" | "CHILD"; gender: "MALE" | "FEMALE"
  dateOfBirth: string            // YYYY-MM-DD plaintext
  email: string | null; mobile: string | null
  pastoralNotes: string | null
  membershipDate: Date
}
export type DemoFamily = {
  name: string; address: string; suburb: string; state: "NSW"; postcode: string
  status: "ACTIVE" | "VISITOR"; joinedDate: Date; marriageDate: Date | null
  people: DemoPerson[]
}
export type DemoTxn = {
  date: Date; cents: number; type: "INCOME" | "EXPENSE"; accountCode: string
  description: string; familyIndex: number | null; reconciled: boolean
}
export type DemoEvent = {
  title: string; slug: string; category: string; date: Date; location: string
  tickets: { name: string; cents: number }[]
  registrations: {
    firstName: string; lastName: string; email: string; phone: string | null; paid: boolean
    items: { ticketIndex: number; attendees: { name: string; checkedIn: boolean }[] }[]
  }[]
  managedByOrganiser: boolean
}
export type DemoPettyCash = {
  title: string; date: Date; openingCents: number; closed: boolean
  receipts: { accountCode: string; cents: number; notes: string }[]
  expenses: { accountCode: string; cents: number; payee: string; description: string; receiptRef: string }[]
}
export type DemoData = {
  users: { name: string; email: string; role: UserRoleName }[]
  families: DemoFamily[]; transactions: DemoTxn[]; events: DemoEvent[]; pettyCash: DemoPettyCash[]
}

const DAY = 86_400_000
const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function centsToDecimal(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`
}
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
const title = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${MONTH_ABBR[d.getUTCMonth()]}-${d.getUTCFullYear()}`

const SURNAMES = [
  "Abraham", "Baker", "Chandra", "Daniel", "Edwards", "Fernandes", "George", "Harris", "Iyer", "Jacob",
  "Kumar", "Lawson", "Mathew", "Nguyen", "Oliver", "Paul", "Quinn", "Reddy", "Samuel", "Thomas",
  "Usman", "Varghese", "Walker", "Xavier", "Young", "Zachariah", "Bennett", "Coleman", "Dsouza", "Ellis",
  "Fraser", "Gomez", "Hughes", "Isaac", "Joseph", "Kelly", "Lee", "Martin", "Nair", "Owens",
]
const MALE = ["James", "John", "David", "Daniel", "Samuel", "Joseph", "Thomas", "Matthew", "Andrew", "Peter", "Mark", "Paul", "Philip", "Simon", "Stephen"]
const FEMALE = ["Mary", "Sarah", "Anna", "Grace", "Ruth", "Elizabeth", "Rachel", "Hannah", "Leah", "Rebecca", "Susan", "Esther", "Lydia", "Martha", "Naomi"]
const KIDS_M = ["Aaron", "Caleb", "Ethan", "Isaac", "Jonah", "Levi", "Noah", "Reuben"]
const KIDS_F = ["Abigail", "Chloe", "Eden", "Isla", "Mia", "Olivia", "Sophie", "Zoe"]
const SUBURBS: Array<[string, string]> = [
  ["Riverside", "2150"], ["Hillview", "2153"], ["Lakeside", "2155"], ["Northgate", "2160"], ["Westbrook", "2165"], ["Elmfield", "2170"],
]
const STREETS = ["Church St", "Station Rd", "Park Ave", "Hill St", "River Rd", "Oak Ave", "Victoria St", "George St"]
const PASTORAL = [
  "Hospital visit — recovering well after knee surgery.",
  "Recently bereaved; follow up monthly.",
  "Preparing for marriage; pre-marriage counselling booked.",
  "Interested in joining the choir.",
  "New to the area; welcome visit done.",
]

export function buildDemoData(today: Date, seed = 20261002): DemoData {
  const rnd = mulberry32(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
  const t0 = utc(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  let mobileSeq = 6 // ACMA fictional range 0491 570 006–159
  const nextMobile = () => `0491570${String(mobileSeq++).padStart(3, "0")}`

  const users = DEMO_LOGINS.map((l) => ({ name: `Demo ${l.label}`, email: l.email, role: l.role }))

  // ---- families + people -------------------------------------------------
  // Birthdays/anniversaries in the next 7 days are forced on fixed indices so
  // the dashboard celebration widgets are never empty.
  const families: DemoFamily[] = SURNAMES.map((surname, fi) => {
    const [suburb, postcode] = SUBURBS[fi % SUBURBS.length]
    const joinedDate = addDays(t0, -int(60, 15 * 365))
    // fi 3 carries the forced this-week anniversary, so it must be married.
    const married = fi === 3 || rnd() < 0.85
    const headMale = rnd() < 0.8
    const headAge = int(30, 70)
    const dob = (age: number, forceWithinDays?: number) => {
      if (forceWithinDays !== undefined) {
        const d = addDays(t0, forceWithinDays)
        return ymd(utc(d.getUTCFullYear() - age, d.getUTCMonth(), d.getUTCDate()))
      }
      return ymd(addDays(t0, -(age * 365 + int(0, 364))))
    }
    const contact = (first: string) => ({
      email: `${first}.${surname}`.toLowerCase() + "@example.com",
      mobile: nextMobile(),
    })
    const headFirst = headMale ? pick(MALE) : pick(FEMALE)
    const people: DemoPerson[] = [{
      firstName: headFirst, lastName: surname, role: "HEAD", gender: headMale ? "MALE" : "FEMALE",
      dateOfBirth: dob(headAge, fi < 3 ? fi * 2 : undefined),
      ...contact(headFirst),
      pastoralNotes: fi < PASTORAL.length ? PASTORAL[fi] : null,
      membershipDate: joinedDate,
    }]
    if (married) {
      const first = headMale ? pick(FEMALE) : pick(MALE)
      people.push({
        firstName: first, lastName: surname, role: "SPOUSE", gender: headMale ? "FEMALE" : "MALE",
        dateOfBirth: dob(headAge - int(0, 4)), ...contact(first), pastoralNotes: null, membershipDate: joinedDate,
      })
    }
    const kids = married ? int(0, 3) : 0
    const used = new Set(people.map((p) => p.firstName))
    for (let k = 0; k < kids; k++) {
      const boy = rnd() < 0.5
      let first = boy ? pick(KIDS_M) : pick(KIDS_F)
      while (used.has(first)) first = boy ? pick(KIDS_M) : pick(KIDS_F)
      used.add(first)
      people.push({
        firstName: first, lastName: surname, role: "CHILD", gender: boy ? "MALE" : "FEMALE",
        dateOfBirth: dob(int(2, 17)), email: null, mobile: null, pastoralNotes: null, membershipDate: joinedDate,
      })
    }
    const marriageDate = married
      ? fi === 3
        ? utc(t0.getUTCFullYear() - int(5, 30), addDays(t0, 3).getUTCMonth(), addDays(t0, 3).getUTCDate())
        : addDays(t0, -int(3, 40) * 365 - int(0, 364))
      : null
    return {
      name: `${surname} Family`,
      address: `${int(1, 199)} ${pick(STREETS)}`, suburb, state: "NSW", postcode,
      status: fi % 13 === 12 ? "VISITOR" : "ACTIVE",
      joinedDate, marriageDate, people,
    }
  })

  // ---- transactions ------------------------------------------------------
  const transactions: DemoTxn[] = []
  const push = (date: Date, cents: number, type: "INCOME" | "EXPENSE", accountCode: string, description: string, familyIndex: number | null = null) => {
    if (date > t0) return
    transactions.push({ date, cents, type, accountCode, description, familyIndex, reconciled: date < addDays(t0, -30) })
  }
  // Weekly Sunday offertory for 52 weeks.
  const lastSunday = addDays(t0, -t0.getUTCDay())
  for (let w = 0; w < 52; w++) push(addDays(lastSunday, -7 * w), int(60_000, 120_000), "INCOME", "4002", "Sunday offertory")
  // Monthly: subscriptions, tithes, running costs.
  const subscribers = families.map((_, i) => i).filter(() => rnd() < 0.7)
  const tithers = families.map((_, i) => i).filter(() => rnd() < 0.2)
  for (let m = 0; m < 12; m++) {
    const first = utc(t0.getUTCFullYear(), t0.getUTCMonth() - m, 1)
    for (const fi of subscribers) push(addDays(first, int(0, 9)), int(3_000, 8_000), "INCOME", "4001", "Monthly subscription", fi)
    for (const fi of tithers) push(addDays(first, int(0, 9)), int(15_000, 60_000), "INCOME", "4006", "Tithe", fi)
    push(addDays(first, 2), 120_000, "EXPENSE", "5011", "Hall rent")
    push(addDays(first, 5), 4_500, "EXPENSE", "5014", "Website hosting and software")
    push(addDays(first, 10), int(10_000, 40_000), "EXPENSE", "5015", "Office supplies and utilities")
    push(addDays(first, 12), 30_000, "EXPENSE", "5010", "Clergy travel allowance")
    push(addDays(first, 15), 50_000, "EXPENSE", "5020", "Diocesan contribution")
    if (m % 3 === 0) push(addDays(first, 20), 65_000, "EXPENSE", "5016", "Public liability insurance (quarter)")
  }
  // Seasonal spikes.
  const monthsAgo = (n: number, day: number) => utc(t0.getUTCFullYear(), t0.getUTCMonth() - n, day)
  for (let k = 0; k < 3; k++) push(monthsAgo(4, 10 + k), int(80_000, 200_000), "INCOME", "4007", "Annual festival collection")
  push(monthsAgo(4, 8), int(50_000, 150_000), "EXPENSE", "5001", "Annual festival catering")
  for (let k = 0; k < 20; k++) push(monthsAgo(3, 5), 2_500, "INCOME", "4018", "VBS registration", k % families.length)
  push(monthsAgo(3, 4), 90_000, "EXPENSE", "5023", "VBS materials")
  push(monthsAgo(6, 14), 300_000, "INCOME", "4009", "Harvest festival auction")
  push(monthsAgo(6, 12), 60_000, "EXPENSE", "5003", "Harvest festival setup")
  transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

  // ---- events ------------------------------------------------------------
  const EVENT_DEFS: Array<[string, string, number, boolean]> = [
    ["Harvest Festival Lunch", "parish", -60, false],
    ["Family Picnic", "fellowship", -30, false],
    ["Youth Camp", "youth", -10, false],
    ["Annual Festival Dinner", "special", 14, true],
    ["Carol Service", "worship", 35, false],
  ]
  const events: DemoEvent[] = EVENT_DEFS.map(([eventTitle, category, offset, organiser]) => {
    const date = addDays(t0, offset)
    const past = offset < 0
    const regCount = int(10, 14)
    const registrations = Array.from({ length: regCount }, (_, r) => {
      const fam = families[(r * 3 + offset + 60) % families.length]
      const head = fam.people[0]
      const adults = fam.people.filter((p) => p.role !== "CHILD")
      const children = fam.people.filter((p) => p.role === "CHILD")
      const items = [{ ticketIndex: 0, attendees: adults.map((p) => ({ name: `${p.firstName} ${p.lastName}`, checkedIn: past && rnd() < 0.85 })) }]
      if (children.length) items.push({ ticketIndex: 1, attendees: children.map((p) => ({ name: `${p.firstName} ${p.lastName}`, checkedIn: past && rnd() < 0.85 })) })
      return {
        firstName: head.firstName, lastName: head.lastName, email: head.email!, phone: head.mobile,
        paid: past || rnd() < 0.7, items,
      }
    })
    return {
      title: eventTitle,
      slug: eventTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      category, date, location: "Parish Hall", managedByOrganiser: organiser,
      tickets: [{ name: "Adult", cents: 2_000 }, { name: "Child", cents: 1_000 }],
      registrations,
    }
  })

  // ---- petty cash: 3 most recent Sundays before today, newest open --------
  const pettyCash: DemoPettyCash[] = [3, 2, 1].map((weeksAgo) => {
    const date = addDays(lastSunday, -7 * (weeksAgo - 1))
    return {
      title: title(date), date, openingCents: 20_000, closed: weeksAgo > 1,
      receipts: Array.from({ length: int(2, 4) }, () => ({
        accountCode: pick(["4003", "4004", "4005"]), cents: int(2_000, 10_000), notes: "Envelope received after service",
      })),
      expenses: Array.from({ length: int(1, 3) }, (_, i) => ({
        accountCode: "5015", cents: int(1_500, 6_000), payee: pick(["Local Grocer", "Corner Hardware", "Post Office"]),
        description: pick(["Tea and coffee supplies", "Cleaning supplies", "Postage"]), receiptRef: `R-${weeksAgo}${i + 1}`,
      })),
    }
  })

  return { users, families, transactions, events, pettyCash }
}
