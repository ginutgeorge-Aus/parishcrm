import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { chromium, type Page } from "@playwright/test"

// perf baseline — drive the running app with a real browser and capture
// navigation timing + Largest Contentful Paint per key route. No new deps
// (Playwright already installed); replaces the Lighthouse idea in the ticket.
//
// Prereq: build + run the app against the volume-seeded LOCAL DB with query
// logging on, e.g.:
//   npm run build
//   PERF_QUERY_LOG=1 PERF_QUERY_LOG_FILE=$PWD/scratchpad/perf/queries.jsonl \
//     DISABLE_OTP=true npm run start
// then in another shell:
//   npx tsx scripts/perf/measure.ts
//
// DISABLE_OTP=true is required so the admin login completes without the OTP step.

const BASE_URL = process.env.PERF_BASE_URL ?? "http://localhost:3000"
const OUT = process.env.PERF_ROUTES_OUT ?? "scratchpad/perf/routes.json"

const ROUTES = [
  { name: "dashboard", path: "/", auth: true },
  { name: "transactions", path: "/accounting/transactions", auth: true },
  { name: "public-register", path: "/e/perf-event", auth: false },
  { name: "membership", path: "/membership", auth: false },
] as const

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/email/i).fill("admin@example.com")
  await page.getByLabel(/password/i).fill("admin123")
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15_000 })
}

// Collected in the page: nav timing (DCL, load, TTFB) + buffered LCP.
async function measure(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load" })
  return page.evaluate(async () => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
    const lcp = await new Promise<number>((resolve) => {
      let last = 0
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) last = e.startTime
      })
      obs.observe({ type: "largest-contentful-paint", buffered: true })
      // LCP finalises on interaction/idle; sample after a short settle.
      setTimeout(() => {
        obs.disconnect()
        resolve(Math.round(last))
      }, 1_000)
    })
    return {
      ttfbMs: Math.round(nav.responseStart),
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd),
      lcpMs: lcp,
    }
  })
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await login(page)

  const results = []
  for (const route of ROUTES) {
    const metrics = await measure(page, `${BASE_URL}${route.path}`)
    console.log(`${route.name.padEnd(18)} ${JSON.stringify(metrics)}`)
    results.push({ route: route.name, path: route.path, ...metrics })
  }

  await browser.close()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
  console.log(`\nWrote ${results.length} route metrics → ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
