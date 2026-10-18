/** @jest-environment node */
import assert from "node:assert/strict"
import {
  isReviewed,
  firstStatusAt,
  needsNudge,
  nudgeInFlight,
  parseRateLimitReset,
  pendingReset,
  pausedBefore,
  pickNext,
  statusSaysReviewed,
  waitForReset,
  type Comment,
  type Pr,
} from "../../scripts/coderabbit-nudge"

const BOT = "coderabbitai[bot]"
const RATE_LIMIT_BODY = `<!-- This is an auto-generated reply by CodeRabbit -->
<details>
<summary>⚠️ Action not completed</summary>

Review rate limited.

> You've used all free OSS reviews for now. Wait for the free limit to reset to keep reviewing this public repository.
>
> **Next included review available in 17 minutes.**
</details>`

/** Builds a comment with defaults for the fields a test does not care about. */
function comment(over: Partial<Comment>): Comment {
  return { user: "someone", body: "", createdAt: "2026-10-07T02:00:00Z", updatedAt: "2026-10-07T02:00:00Z", ...over }
}

/** Builds a PR with defaults for the fields a test does not care about. */
function pr(over: Partial<Pr>): Pr {
  return {
    number: 1,
    draft: false,
    author: "dev",
    authorIsBot: false,
    labels: [],
    headSha: "abc",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  }
}

test("isReviewed: only a CodeRabbit review on the head commit counts", () => {
  const body = "**Actionable comments posted: 1**"
  assert.equal(isReviewed([{ user: BOT, commitId: "abc", body }], [], "abc"), true)
  assert.equal(isReviewed([{ user: BOT, commitId: "old", body }], [], "abc"), false)
  assert.equal(isReviewed([{ user: "human", commitId: "abc", body }], [], "abc"), false)
  assert.equal(isReviewed([], [], "abc"), false)
})

test("isReviewed: an empty-body review (a CodeRabbit thread reply) is not a review", () => {
  assert.equal(isReviewed([{ user: BOT, commitId: "abc", body: "" }], [], "abc"), false)
})

test("isReviewed: clean review recorded only in the summary comment counts", () => {
  const head = "8ef0c7e6672b972e9d6dc5a4ff15a68d9e265983"
  const marker = comment({ user: BOT, body: `<!-- {"sourceCommitId":"${head}","coveredCommitId":"${head}"} -->` })
  assert.equal(isReviewed([], [marker], head), true)
})

test("isReviewed: rate-limited summary naming head in 'between' line, or a non-bot quote, does not count", () => {
  const head = "6ef9c6f082c866ab02ff0effe76b9a0f04b12959"
  const old = "10042b7fe7840f00e08dad2ec8835a4b3fa45780"
  const stale = comment({
    user: BOT,
    body: `## Review limit reached\n{"coveredCommitId":"${old}"}\nReviewing files ... between ${old} and ${head}.`,
  })
  const human = comment({ user: "human", body: `{"coveredCommitId":"${head}"}` })
  assert.equal(isReviewed([], [stale, human], head), false)
})

test("parseRateLimitReset: reads 'available in N minutes' from updated_at", () => {
  const reset = parseRateLimitReset(comment({ user: BOT, body: RATE_LIMIT_BODY, updatedAt: "2026-10-07T02:39:21Z" }))
  assert.equal(reset?.toISOString(), "2026-10-07T02:56:21.000Z")
})

test("parseRateLimitReset: accepts the colon form 'available in: N minutes'", () => {
  const body = "Review rate limited. **Next review available in: 21 minutes**"
  const reset = parseRateLimitReset(comment({ user: BOT, body, updatedAt: "2026-10-07T00:00:00Z" }))
  assert.equal(reset?.toISOString(), "2026-10-07T00:21:00.000Z")
})

test("parseRateLimitReset: hours + minutes + seconds", () => {
  const body = "Review rate limited. **Next included review available in 1 hour, 2 minutes and 3 seconds.**"
  const reset = parseRateLimitReset(comment({ user: BOT, body, updatedAt: "2026-10-07T00:00:00Z" }))
  assert.equal(reset?.toISOString(), "2026-10-07T01:02:03.000Z")
})

test("parseRateLimitReset: no time → assume 60 minutes", () => {
  const reset = parseRateLimitReset(comment({ user: BOT, body: "Review limit reached", updatedAt: "2026-10-07T00:00:00Z" }))
  assert.equal(reset?.toISOString(), "2026-10-07T01:00:00.000Z")
})

test("parseRateLimitReset: ignores non-bot and non-limit comments", () => {
  assert.equal(parseRateLimitReset(comment({ user: "human", body: RATE_LIMIT_BODY })), null)
  assert.equal(parseRateLimitReset(comment({ user: BOT, body: "Walkthrough ..." })), null)
})

test("pendingReset: latest future reset wins, past ones ignored", () => {
  const now = new Date("2026-10-07T02:45:00Z")
  const past = comment({ user: BOT, body: RATE_LIMIT_BODY, updatedAt: "2026-10-07T01:00:00Z" })
  const future = comment({ user: BOT, body: RATE_LIMIT_BODY, updatedAt: "2026-10-07T02:39:21Z" })
  assert.equal(pendingReset([past, future], now)?.toISOString(), "2026-10-07T02:56:21.000Z")
  assert.equal(pendingReset([past], now), null)
})

test("pendingReset: untimed reply paired with timed summary uses the timed reset", () => {
  const now = new Date("2026-10-07T02:45:00Z")
  const summary = comment({ user: BOT, body: RATE_LIMIT_BODY, updatedAt: "2026-10-07T02:39:18Z" })
  const reply = comment({ user: BOT, body: "Review rate limited.", updatedAt: "2026-10-07T02:39:21Z" })
  assert.equal(pendingReset([summary, reply], now)?.toISOString(), "2026-10-07T02:56:18.000Z")
  assert.equal(pendingReset([reply], now)?.toISOString(), "2026-10-07T03:39:21.000Z")
})

test("nudgeInFlight: recent unanswered command blocks; answered or stale does not", () => {
  const now = new Date("2026-10-07T03:00:00Z")
  const nudge = comment({ body: "@coderabbitai review", createdAt: "2026-10-07T02:50:00Z" })
  const reply = comment({ user: BOT, body: "ok", createdAt: "2026-10-07T02:51:00Z" })
  assert.equal(nudgeInFlight([nudge], now), true)
  assert.equal(nudgeInFlight([reply, nudge], now), false)
  assert.equal(nudgeInFlight([{ ...nudge, createdAt: "2026-10-07T02:00:00Z" }], now), false)
  assert.equal(nudgeInFlight([comment({ body: "@codex review", createdAt: "2026-10-07T02:55:00Z" })], now), false)
})

test("nudgeInFlight: CodeRabbit's 'Review triggered' ack is not an answer; a later summary edit is", () => {
  const now = new Date("2026-10-07T03:00:00Z")
  const nudge = comment({ body: "@coderabbitai review", createdAt: "2026-10-07T02:50:00Z" })
  const ack = comment({
    user: BOT,
    body: "<!-- This is an auto-generated reply by CodeRabbit -->\n<details>\n<summary>✅ Actions performed</summary>\n\nReview triggered.\n\n</details>",
    createdAt: "2026-10-07T02:50:10Z",
    updatedAt: "2026-10-07T02:50:10Z",
  })
  assert.equal(nudgeInFlight([nudge, ack], now), true)
  const summaryEdited = comment({ user: BOT, body: "walkthrough", createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-07T02:58:00Z" })
  assert.equal(nudgeInFlight([summaryEdited, nudge, ack], now), false)
})

test("nudgeInFlight: a summary edited to 'review in progress' is not an answer", () => {
  const now = new Date("2026-10-07T03:00:00Z")
  const nudge = comment({ body: "@coderabbitai review", createdAt: "2026-10-07T02:50:00Z" })
  const inProgress = comment({
    user: BOT,
    body: "<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->\n\n> [!NOTE]\n> Currently processing new changes in this PR. This may take a few minutes, please wait...\n\nwalkthrough",
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-07T02:51:00Z",
  })
  assert.equal(nudgeInFlight([inProgress, nudge], now), true)
})

test("pickNext: review-next > human > bot, newest activity first, skips drafts and opt-outs", () => {
  const bot = pr({ number: 1, authorIsBot: true, updatedAt: "2026-10-06T00:00:00Z" })
  const staleHuman = pr({ number: 2, updatedAt: "2026-09-10T00:00:00Z" })
  const activeHuman = pr({ number: 3, updatedAt: "2026-10-05T00:00:00Z" })
  const flagged = pr({ number: 4, labels: ["review-next"], updatedAt: "2026-08-01T00:00:00Z" })
  const draft = pr({ number: 5, draft: true, updatedAt: "2026-10-07T00:00:00Z" })
  const optOut = pr({ number: 6, labels: ["no-coderabbit"], updatedAt: "2026-10-07T00:00:00Z" })

  assert.equal(pickNext([bot, staleHuman, activeHuman, flagged, draft, optOut])?.number, 4)
  assert.equal(pickNext([bot, staleHuman, activeHuman])?.number, 3)
  assert.equal(pickNext([bot, draft, optOut])?.number, 1)
  assert.equal(pickNext([draft, optOut]), null)
})

test("waitForReset: sleeps until just past a reset within the cap", () => {
  const now = new Date("2026-10-09T20:00:00Z")
  assert.equal(waitForReset(new Date("2026-10-09T20:30:00Z"), now, 65 * 60_000), 31 * 60_000)
})

test("waitForReset: no wait when nothing is pending or the reset is past the cap", () => {
  const now = new Date("2026-10-09T20:00:00Z")
  assert.equal(waitForReset(null, now, 65 * 60_000), null)
  assert.equal(waitForReset(new Date("2026-10-09T21:30:00Z"), now, 65 * 60_000), null)
})

test("statusSaysReviewed: latest CodeRabbit status decides; rate limited or other contexts don't count", () => {
  const st = (description: string, createdAt: string, context = "CodeRabbit") => ({ context, description, createdAt })
  // Skipped head (merge from main): completed with no review object.
  assert.equal(statusSaysReviewed([st("Review in progress", "2026-10-12T11:04:09Z"), st("Review completed", "2026-10-12T11:04:45Z")]), true)
  assert.equal(statusSaysReviewed([st("Review in progress", "2026-10-12T05:41:43Z"), st("Review rate limited", "2026-10-12T05:41:47Z")]), false)
  assert.equal(statusSaysReviewed([st("Review completed", "2026-10-12T05:00:00Z"), st("Review rate limited", "2026-10-12T05:41:47Z")]), false)
  assert.equal(statusSaysReviewed([st("Review completed", "2026-10-12T05:00:00Z", "license/cla")]), false)
  assert.equal(statusSaysReviewed([]), false)
})

const PAUSED_BODY = (sha: string) => `<!-- This is an auto-generated comment: review paused by coderabbit.ai -->

> [!NOTE]
> ## Reviews paused
>
> It looks like this branch is under active development.
>
> - Last reviewed commit: ${sha}
>
<!-- end of auto-generated comment: review paused by coderabbit.ai -->`

test("pausedBefore: auto-paused summary whose last reviewed commit is not the head", () => {
  const head = "45d9f15aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  const older = "ebb588116be4d254a3e3bd56c8994b66ab5d5e5f"
  const since = new Date("2026-10-07T01:00:00Z")
  const paused = comment({ user: BOT, body: PAUSED_BODY(older) })
  // Seen on #275: status "Review completed", but the summary says paused at an older commit.
  assert.equal(pausedBefore([paused], head, since), true)
  // Case of the marker doesn't matter.
  assert.equal(pausedBefore([comment({ user: BOT, body: PAUSED_BODY(older).replaceAll("review paused", "Review Paused") })], head, since), true)
  // Paused, but the last reviewed commit is the head: nothing left to review.
  assert.equal(pausedBefore([comment({ user: BOT, body: PAUSED_BODY(head) })], head, since), false)
  // Paused note with no parseable commit: assume unreviewed commits wait.
  assert.equal(pausedBefore([comment({ user: BOT, body: "<!-- This is an auto-generated comment: review paused by coderabbit.ai -->" })], head, since), true)
  // Only CodeRabbit's own comment counts.
  assert.equal(pausedBefore([comment({ user: "someone", body: PAUSED_BODY(older) })], head, since), false)
  assert.equal(pausedBefore([comment({ user: BOT, body: "No actionable comments were generated." })], head, since), false)
  assert.equal(pausedBefore([], head, since), false)
  // Only the most recently updated paused note counts (an older stale one doesn't).
  const pausedAtHead = comment({ user: BOT, body: PAUSED_BODY(head), updatedAt: "2026-10-07T04:00:00Z" })
  assert.equal(pausedBefore([pausedAtHead, { ...paused, updatedAt: "2026-10-07T02:00:00Z" }], head, since), false)
  // This head was already nudged (and answered): don't nudge again while the note stays stale.
  const at = (user: string, body: string, t: string) => comment({ user, body, createdAt: t, updatedAt: t })
  const nudge = at("someone", "@coderabbitai review", "2026-10-07T02:00:00Z")
  assert.equal(pausedBefore([paused, nudge, at(BOT, "✅ Action performed\n\nReview finished.", "2026-10-07T03:00:00Z")], head, since), false)
  assert.equal(pausedBefore([paused, nudge, at(BOT, "Already reviewed the last commit.", "2026-10-07T03:00:00Z")], head, since), false)
  // A reply alone, or a nudge from before this head's first status, doesn't use up this head's nudge.
  assert.equal(pausedBefore([paused, at(BOT, "Review finished.", "2026-10-07T03:00:00Z")], head, since), true)
  const oldNudge = at("someone", "@coderabbitai review", "2026-10-07T00:30:00Z")
  assert.equal(pausedBefore([paused, oldNudge, at(BOT, "Review finished.", "2026-10-07T01:30:00Z")], head, since), true)
  // The nudge for this head is unanswered: still at most one nudge per head.
  assert.equal(pausedBefore([paused, at(BOT, "Review finished.", "2026-10-07T01:30:00Z"), nudge], head, since), false)
  // Real order (#275, #317): CodeRabbit edits the still-stale paused summary while
  // handling the command, seconds before its reply's final edit. This head was
  // already nudged once, so it isn't nudged again.
  const editedMidReview = { ...paused, updatedAt: "2026-10-07T02:59:55Z" }
  assert.equal(pausedBefore([editedMidReview, nudge, at(BOT, "Review finished.", "2026-10-07T03:00:00Z")], head, since), false)
  // A pause note updated after the reply: same head, already nudged once — no repeat.
  const repaused = { ...paused, updatedAt: "2026-10-07T04:00:00Z" }
  assert.equal(pausedBefore([repaused, nudge, at(BOT, "Review finished.", "2026-10-07T03:00:00Z")], head, since), false)
  // Head SHA case doesn't matter.
  assert.equal(pausedBefore([comment({ user: BOT, body: PAUSED_BODY(head) })], head.toUpperCase(), since), false)
})

test("firstStatusAt: oldest CodeRabbit status time, epoch when none", () => {
  const st = (createdAt: string, context = "CodeRabbit") => ({ context, description: "Review completed", createdAt })
  assert.equal(firstStatusAt([st("2026-10-12T06:00:00Z"), st("2026-10-12T05:00:00Z"), st("2026-10-12T04:00:00Z", "ci")]).toISOString(), "2026-10-12T05:00:00.000Z")
  assert.equal(firstStatusAt([]).getTime(), 0)
})

test("pausedBefore + firstStatusAt: a status posted when CodeRabbit answers the nudge doesn't re-arm it", () => {
  const head = "45d9f15aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  const st = (createdAt: string) => ({ context: "CodeRabbit", description: "Review completed", createdAt })
  const statuses = [st("2026-10-07T01:00:00Z"), st("2026-10-07T03:00:00Z")]
  const at = (user: string, body: string, t: string) => comment({ user, body, createdAt: t, updatedAt: t })
  const comments = [
    comment({ user: BOT, body: PAUSED_BODY("ebb588116be4d254a3e3bd56c8994b66ab5d5e5f"), updatedAt: "2026-10-07T01:00:00Z" }),
    at("someone", "@coderabbitai review", "2026-10-07T02:00:00Z"),
    at(BOT, "Review finished.", "2026-10-07T03:00:00Z"),
  ]
  assert.equal(pausedBefore(comments, head, firstStatusAt(statuses)), false)
})

test("needsNudge: PR selection — 'Review completed' status with a stale pause is still nudged", () => {
  const head = "45d9f15aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  const st = (description: string, createdAt = "2026-10-07T01:00:00Z") => ({ context: "CodeRabbit", description, createdAt })
  const stalePause = comment({ user: BOT, body: PAUSED_BODY("ebb588116be4d254a3e3bd56c8994b66ab5d5e5f") })
  // Seen on #275: the status says reviewed, but the paused summary names an older commit.
  assert.equal(needsNudge([], [stalePause], [st("Review completed")], head), true)
  // Same status with no pause note: reviewed, skip.
  assert.equal(needsNudge([], [], [st("Review completed")], head), false)
  // Paused at the head: nothing left to review.
  assert.equal(needsNudge([], [comment({ user: BOT, body: PAUSED_BODY(head) })], [st("Review completed")], head), false)
  // A CodeRabbit review on the head wins over everything.
  assert.equal(needsNudge([{ user: BOT, commitId: head, body: "Actionable comments posted: 0" }], [stalePause], [st("Review completed")], head), false)
  // No review and no completed status: needs a nudge.
  assert.equal(needsNudge([], [], [st("Review rate limited")], head), true)
  assert.equal(needsNudge([], [], [], head), true)
})

test("needsNudge: at most one nudge per head SHA on a paused PR (#275/#317 comment order)", () => {
  const head = "45d9f15aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  const st = (createdAt: string) => ({ context: "CodeRabbit", description: "Review completed", createdAt })
  const at = (user: string, body: string, c: string, u = c) => comment({ user, body, createdAt: c, updatedAt: u })
  const stale = "ebb588116be4d254a3e3bd56c8994b66ab5d5e5f"
  const nudge = at("someone", "@coderabbitai review", "2026-10-15T22:30:33Z")
  const reply = at(BOT, "Review finished.", "2026-10-15T22:30:41Z", "2026-10-15T22:36:48Z")
  // Pause note edited mid-review, still stale; the answer posts a fresh status too.
  const note = at(BOT, PAUSED_BODY(stale), "2026-10-14T11:16:22Z", "2026-10-15T22:36:43Z")
  const statuses = [st("2026-10-15T22:00:00Z"), st("2026-10-15T22:36:50Z")]
  assert.equal(needsNudge([], [note, nudge, reply], statuses, head), false)
  // Before any nudge for this head, the stale pause still gets its one nudge.
  assert.equal(needsNudge([], [note], statuses, head), true)
  // A new head (first status after that nudge) gets its own nudge.
  assert.equal(needsNudge([], [note, nudge, reply], [st("2026-10-16T01:00:00Z")], `99aa${head.slice(4)}`), true)
})
