import "server-only"
// Server-only. Files GitHub issues via the REST API with a fine-grained PAT.
// Imported only by server actions — never reaches the client bundle.

type CreateIssueArgs = {
  title: string
  body: string
  labels?: string[]
}

export async function createIssue(args: CreateIssueArgs): Promise<{ number: number }> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  if (!token) throw new Error("GITHUB_TOKEN is not set")
  if (!repo) throw new Error("GITHUB_REPO is not set")

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      labels: args.labels ?? ["bug"],
    }),
    // Node fetch has no default timeout — cap so a hung GitHub API can't hang
    // the calling action indefinitely. A timeout AbortError propagates
    // as a throw, which every caller of this module already catches.
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    // Caller must NOT surface this text to the user — it can include API detail.
    throw new Error(`GitHub issue creation failed: ${res.status}`)
  }

  const json = (await res.json()) as { number: number }
  return { number: json.number }
}

// Reads an issue's open/closed state and close reason, used to sync the in-app
// Report mirror. Caller must NOT surface a thrown message to the user.
export async function getIssue(
  number: number
): Promise<{ state: "open" | "closed"; stateReason: string | null }> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  if (!token) throw new Error("GITHUB_TOKEN is not set")
  if (!repo) throw new Error("GITHUB_REPO is not set")

  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // Bounded like createIssue — timeout throws, callers catch.
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    throw new Error(`GitHub issue fetch failed: ${res.status}`)
  }

  const json = (await res.json()) as { state: "open" | "closed"; state_reason: string | null }
  return { state: json.state, stateReason: json.state_reason ?? null }
}

// Parses the `next` page URL out of a GitHub `Link` header, or null when the
// current page is the last. Header form: `<url>; rel="next", <url>; rel="last"`.
function nextPageUrl(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

// Lists OPEN issues carrying `label`, returning number + body so the caller can
// dedupe by a fingerprint marker embedded in the body. Follows `Link: rel="next"`
// so more than 100 open issues are all returned — otherwise a fingerprint whose
// issue sits past page 1 reads as "not filed" and the digest files a dup.
export async function listOpenIssuesByLabel(
  label: string
): Promise<{ number: number; body: string }[]> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  if (!token) throw new Error("GITHUB_TOKEN is not set")
  if (!repo) throw new Error("GITHUB_REPO is not set")

  const out: { number: number; body: string }[] = []
  let url: string | null = `https://api.github.com/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`
  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // Bounded per page like the others — timeout throws, callers catch.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`GitHub issue list failed: ${res.status}`)
    const json = (await res.json()) as { number: number; body: string | null }[]
    for (const i of json) out.push({ number: i.number, body: i.body ?? "" })
    url = nextPageUrl(res.headers.get("link"))
  }
  return out
}
