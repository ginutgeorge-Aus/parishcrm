/** @jest-environment node */
import assert from "node:assert/strict"
import {
  isReviewed,
  nudgeInFlight,
  parseRateLimitReset,
  pendingReset,
  pickNext,
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
