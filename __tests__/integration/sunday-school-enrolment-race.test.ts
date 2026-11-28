/** @jest-environment node */
// Real-Postgres race test for first Sunday school enrolments (StMarkCRM#3331 PR 4 follow-up,
// fix #960/#961). A child's FIRST enrolment in a year has no row to lock, so enrolChildren
// takes a per-(person, year) advisory lock. The mocked suite only asserts the SQL is issued;
// this fires parallel enrolments of the same child through the real action and checks
// Postgres leaves exactly one enrolment row and no caller sees a raw error. Opt-in: runs
// only with INTEGRATION_DB=1 against a migrated, disposable database (see
// docs/integration-tests.md); skipped in the normal `npm test` run.

// Module scope: keeps this file's top-level names out of the shared global script scope.
export {}

jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ featureGuard: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))

const RUN = process.env.INTEGRATION_DB === "1"
const ROUNDS = 6
jest.setTimeout(60_000)

;(RUN ? describe : describe.skip)("sunday school first-enrolment races (real Postgres)", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let enrolChildren: typeof import("@/lib/actions/sundaySchool").enrolChildren
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  // Far-future year: cannot collide with real classes in a reused local database.
  const YEAR = 2090 + Math.floor(Math.random() * 9)
  let familyId: number
  let seq = 0
  const personIds: number[] = []
  const classIds: number[] = []

  /**
   * Creates a live class in the test year.
   * @param label - suffix keeping the (year, name, location) unique
   */
  async function newClass(label: string): Promise<number> {
    const cls = await prisma.sundaySchoolClass.create({ data: { year: YEAR, name: `Race ${tag}-${seq++}-${label}`, level: 1 } })
    classIds.push(cls.id)
    return cls.id
  }

  /** Creates a child with no enrolment. */
  async function newChild(): Promise<number> {
    const person = await prisma.person.create({ data: { familyId, firstName: "Race", lastName: `Child${seq++}` } })
    personIds.push(person.id)
    return person.id
  }

  /**
   * Asserts every raced call resolved (none threw) with a success, so the P2002
   * "try again" path counts as a failure: the advisory lock must make it unreachable.
   * @param results - settled outcomes of the raced actions
   */
  function expectAllSucceeded(results: PromiseSettledResult<unknown>[]) {
    for (const r of results) {
      expect(r.status === "rejected" ? String(r.reason) : r.status).toBe("fulfilled")
      expect(r.status === "fulfilled" && r.value).toEqual({ success: expect.stringMatching(/^Enrolled 1/) })
    }
  }

  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/prisma"))
    ;({ enrolChildren } = await import("@/lib/actions/sundaySchool"))
    const user = await prisma.user.create({
      data: { name: "Race test admin", email: `race-ss-${tag}@example.com`, passwordHash: "x", role: "ADMIN" },
    })
    const { auth } = jest.requireMock("@/auth") as { auth: jest.Mock }
    auth.mockResolvedValue({ user: { id: String(user.id), role: "ADMIN" } })
    familyId = (await prisma.family.create({ data: { name: `Race family ${tag}` } })).id
  })

  afterAll(async () => {
    if (!prisma) return
    // Best-effort cleanup. The admin user stays: audit rows reference it.
    await prisma.sundaySchoolEnrolment.deleteMany({ where: { year: YEAR, personId: { in: personIds } } })
    await prisma.sundaySchoolClass.deleteMany({ where: { id: { in: classIds } } })
    await prisma.person.deleteMany({ where: { id: { in: personIds } } })
    if (familyId) await prisma.family.deleteMany({ where: { id: familyId } })
    await prisma.$disconnect()
  })

  it("the same new child enrolled into 4 different classes at once ends with exactly one enrolment", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const child = await newChild()
      const classes = await Promise.all(["a", "b", "c", "d"].map(newClass))
      const results = await Promise.allSettled(classes.map((id) => enrolChildren(id, [child])))
      expectAllSucceeded(results)
      const rows = await prisma.sundaySchoolEnrolment.findMany({ where: { personId: child, year: YEAR } })
      expect(rows).toHaveLength(1)
      expect(classes).toContain(rows[0].classId)
    }
  })

  it("the same new child enrolled into one class by 6 callers at once creates one row", async () => {
    const child = await newChild()
    const cls = await newClass("same")
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => enrolChildren(cls, [child])))
    expectAllSucceeded(results)
    expect(await prisma.sundaySchoolEnrolment.count({ where: { personId: child, year: YEAR } })).toBe(1)
  })

  it("overlapping batches in opposite id order do not deadlock and enrol both children once", async () => {
    const [a, b] = [await newChild(), await newChild()]
    const [c1, c2] = [await newClass("x"), await newClass("y")]
    const results = await Promise.allSettled([enrolChildren(c1, [a, b]), enrolChildren(c2, [b, a])])
    for (const r of results) {
      expect(r.status === "rejected" ? String(r.reason) : r.status).toBe("fulfilled")
      expect(r.status === "fulfilled" && r.value).toEqual({ success: expect.stringMatching(/^Enrolled 2/) })
    }
    for (const child of [a, b]) {
      expect(await prisma.sundaySchoolEnrolment.count({ where: { personId: child, year: YEAR } })).toBe(1)
    }
  })
})
