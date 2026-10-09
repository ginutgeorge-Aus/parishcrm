// Hourly CodeRabbit nudge for this repo's open PRs (run by .github/workflows/coderabbit-nudge.yml).
//
// CodeRabbit's free OSS plan reviews ~1 PR/hour. Pushes past that get a
// "Review rate limited" reply while the `CodeRabbit` check still passes, so PRs
// sit unreviewed until someone re-asks after the reset. This script spends the
// hourly quota on ONE open PR whose head commit CodeRabbit has not reviewed, by
// posting `@coderabbitai review`.
//
// Runs on plain Node 24 (type stripping) with no dependencies — erasable TS only.
// GH_TOKEN must be a user PAT: CodeRabbit ignores commands posted by bots.
//
// Usage: GH_TOKEN=... NUDGE_REPO=owner/repo node scripts/coderabbit-nudge.ts [--dry-run]
// (in Actions, GITHUB_REPOSITORY supplies the repo)

const REPO = process.env.NUDGE_REPO || process.env.GITHUB_REPOSITORY || ""
const BOT = "coderabbitai[bot]"
const COMMAND = "@coderabbitai review"
/** Assumed wait when a rate-limit reply has no parseable reset time. */
const DEFAULT_WAIT_MS = 60 * 60 * 1000
/** A nudge this recent with no reply yet means a review may be in flight. */
const IN_FLIGHT_MS = 30 * 60 * 1000
/** An untimed notice this close to a timed one is the same rate-limit event. */
const PAIR_MS = 5 * 60 * 1000
// Seen as "available in 4 minutes" and "available in: 21 minutes".
const TIMED = /available in:?(?:\*\*)?\s+([^.*\n]+)/i

export type Pr = {
  number: number
  draft: boolean
  author: string
  authorIsBot: boolean
  labels: string[]
  headSha: string
  updatedAt: string
}

export type Review = { user: string; commitId: string }

export type Comment = { user: string; body: string; createdAt: string; updatedAt: string }

/**
 * True when CodeRabbit has reviewed the PR's current head commit. A review with
 * no actionable comments creates no PR review object — CodeRabbit only edits its
 * summary comment — so its hidden `coveredCommitId` marker counts too. The
 * visible "between <base> and <head>" line is NOT used: it also appears in
 * rate-limited summaries for a review that never ran.
 * @param reviews - all reviews on the PR
 * @param comments - issue comments on the PR
 * @param headSha - the PR's head commit SHA
 */
export function isReviewed(reviews: Review[], comments: Comment[], headSha: string): boolean {
  if (reviews.some((r) => r.user === BOT && r.commitId === headSha)) return true
  return comments.some((c) => c.user === BOT && c.body.includes(`"coveredCommitId":"${headSha}"`))
}

/**
 * Parses a CodeRabbit rate-limit reply into the time the limit resets.
 * Returns null when the comment is not a rate-limit notice.
 * @param comment - an issue comment on a PR
 */
export function parseRateLimitReset(comment: Comment): Date | null {
  if (comment.user !== BOT) return null
  if (!/rate limited|review limit reached|used all free oss reviews/i.test(comment.body)) return null
  const base = Date.parse(comment.updatedAt)
  const m = comment.body.match(TIMED)
  if (!m) return new Date(base + DEFAULT_WAIT_MS)
  const unit = (re: RegExp) => Number(m[1].match(re)?.[1] ?? 0)
  const ms =
    (unit(/(\d+)\s*hours?/i) * 3600 + unit(/(\d+)\s*minutes?/i) * 60 + unit(/(\d+)\s*seconds?/i)) * 1000
  return new Date(base + (ms || DEFAULT_WAIT_MS))
}

/**
 * Latest reset time across all rate-limit notices, or null if none is pending.
 * @param comments - issue comments from every candidate PR
 * @param now - current time
 */
export function pendingReset(comments: Comment[], now: Date): Date | null {
  // CodeRabbit posts an untimed "Review rate limited" reply next to an edit of
  // its summary comment that carries the real "available in N minutes". Trust
  // the timed one; fall back to the default wait only for a lone untimed notice.
  const timed = comments.filter((c) => parseRateLimitReset(c) && TIMED.test(c.body))
  let latest: Date | null = null
  for (const c of comments) {
    const reset = parseRateLimitReset(c)
    if (!reset) continue
    if (!TIMED.test(c.body) && timed.some((t) => Math.abs(Date.parse(t.updatedAt) - Date.parse(c.updatedAt)) < PAIR_MS)) continue
    if (reset > now && (!latest || reset > latest)) latest = reset
  }
  return latest
}

/**
 * True when someone posted the review command recently and CodeRabbit has not
 * replied since — a review is probably running, so another nudge would waste it.
 * @param comments - issue comments on one PR, any order
 * @param now - current time
 */
export function nudgeInFlight(comments: Comment[], now: Date): boolean {
  const sorted = [...comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  let lastNudge = -1
  let lastReply = -1
  for (const c of sorted) {
    const t = Date.parse(c.createdAt)
    if (c.user !== BOT && c.body.trim().toLowerCase().startsWith(COMMAND)) lastNudge = t
    if (c.user === BOT) lastReply = t
  }
  return lastNudge > lastReply && now.getTime() - lastNudge < IN_FLIGHT_MS
}

/**
 * Orders unreviewed PRs: `review-next` label, then humans, then bots; most recently
 * updated first, so active work beats stale PRs.
 * Drafts and `no-coderabbit` PRs are dropped.
 * @param prs - open PRs that CodeRabbit has not reviewed at head
 */
export function pickNext(prs: Pr[]): Pr | null {
  const rank = (p: Pr) => (p.labels.includes("review-next") ? 0 : p.authorIsBot ? 2 : 1)
  const eligible = prs
    .filter((p) => !p.draft && !p.labels.includes("no-coderabbit"))
    .sort((a, b) => rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return eligible[0] ?? null
}

/**
 * Calls the GitHub REST API, following `Link: rel="next"` for GET lists.
 * @param path - API path starting with `/`
 * @param init - optional method and JSON body
 */
async function gh<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  const headers = {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (init) {
    const res = await fetch(`https://api.github.com${path}`, {
      method: init.method,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(init.body),
    })
    if (!res.ok) throw new Error(`${init.method} ${path} → ${res.status} ${await res.text()}`)
    return (await res.json()) as T
  }
  const out: unknown[] = []
  let url: string | null = `https://api.github.com${path}${path.includes("?") ? "&" : "?"}per_page=100`
  while (url) {
    const res: Response = await fetch(url, { headers })
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text()}`)
    out.push(...((await res.json()) as unknown[]))
    url = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null
  }
  return out as T
}

/** Fetches state, decides, and posts at most one review command. */
async function main() {
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN not set")
  if (!REPO) throw new Error("NUDGE_REPO / GITHUB_REPOSITORY not set")
  const dryRun = process.argv.includes("--dry-run")
  const now = new Date()

  type ApiPr = {
    number: number
    draft: boolean
    updated_at: string
    user: { login: string; type: string }
    labels: { name: string }[]
    head: { sha: string }
  }
  const raw = await gh<ApiPr[]>(`/repos/${REPO}/pulls?state=open`)
  const prs: Pr[] = raw.map((p) => ({
    number: p.number,
    draft: p.draft,
    author: p.user.login,
    authorIsBot: p.user.type === "Bot",
    labels: p.labels.map((l) => l.name),
    headSha: p.head.sha,
    updatedAt: p.updated_at,
  }))

  const unreviewed: Pr[] = []
  const allComments: Comment[] = []
  for (const pr of prs) {
    const reviews = await gh<{ user: { login: string } | null; commit_id: string }[]>(
      `/repos/${REPO}/pulls/${pr.number}/reviews`,
    )
    const comments = (
      await gh<{ user: { login: string } | null; body: string; created_at: string; updated_at: string }[]>(
        `/repos/${REPO}/issues/${pr.number}/comments`,
      )
    ).map((c) => ({ user: c.user?.login ?? "", body: c.body ?? "", createdAt: c.created_at, updatedAt: c.updated_at }))
    allComments.push(...comments)
    if (nudgeInFlight(comments, now)) {
      console.log(`#${pr.number}: nudge posted <30 min ago with no reply — review likely running. Skipping run.`)
      return
    }
    if (!isReviewed(reviews.map((r) => ({ user: r.user?.login ?? "", commitId: r.commit_id })), comments, pr.headSha)) {
      unreviewed.push(pr)
    }
  }

  console.log(`Open PRs: ${prs.length}, unreviewed at head: ${unreviewed.map((p) => `#${p.number}`).join(" ") || "none"}`)
  const reset = pendingReset(allComments, now)
  if (reset) {
    console.log(`CodeRabbit rate limited until ${reset.toISOString()}. Skipping run.`)
    return
  }
  const next = pickNext(unreviewed)
  if (!next) {
    console.log("Nothing to nudge.")
    return
  }
  if (dryRun) {
    console.log(`[dry-run] would comment "${COMMAND}" on #${next.number} (${next.author})`)
    return
  }
  await gh(`/repos/${REPO}/issues/${next.number}/comments`, { method: "POST", body: { body: COMMAND } })
  console.log(`Posted "${COMMAND}" on #${next.number} (${next.author}).`)
}

if (process.env.NODE_ENV !== "test") {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
