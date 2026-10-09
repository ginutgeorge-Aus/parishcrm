/** @jest-environment node */
import assert from "node:assert/strict"
import {
  isReviewed,
  nudgeInFlight,
  parseRateLimitReset,
  pendingReset,
  pickNext,
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
  assert.equal(isReviewed([{ user: BOT, commitId: "abc" }], [], "abc"), true)
  assert.equal(isReviewed([{ user: BOT, commitId: "old" }], [], "abc"), false)
  assert.equal(isReviewed([{ user: "human", commitId: "abc" }], [], "abc"), false)
  assert.equal(isReviewed([], [], "abc"), false)
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
