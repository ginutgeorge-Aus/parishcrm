// Captures landing-page screenshots from a LOCAL app seeded with demo data only.
// usage: APP_URL=http://localhost:3000 FAMILY_ID=2 EVENT_ID=1 node scripts/screenshots.mjs
// Optional: CHROMIUM_PATH=<chromium binary> to use an already-installed browser.
import { chromium } from 'playwright'
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:3000'
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP)) {
  throw new Error(`Refusing non-local APP_URL ${APP} — screenshots must come from demo data`)
}
const OUT = new URL('../public/screenshots/', import.meta.url).pathname
const shots = {
  dashboard: '/',
  accounting: '/accounting/transactions',
  events: `/events/${process.env.EVENT_ID ?? '1'}/registrations`, // no /events/[id] page
  families: `/families/${process.env.FAMILY_ID ?? '2'}`,
}
// Hide the Next.js dev-tools indicator (rendered inside <nextjs-portal>).
const HIDE_DEV_UI = 'nextjs-portal { display: none !important; }'

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--lang=en-AU'] })
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
  })
  const page = await ctx.newPage()
  await page.goto(`${APP}/login`)
  await page.fill('#email', 'admin@example.com')
  await page.fill('#password', 'admin123')
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
  for (const [name, path] of Object.entries(shots)) {
    await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: HIDE_DEV_UI })
    await page.waitForTimeout(300)
    const png = await page.screenshot()
    await sharp(png).resize(1440).webp({ quality: 82 }).toFile(`${OUT}${name}.webp`)
    console.log(`✓ ${name}`)
  }
  await ctx.close()
}
await browser.close()
