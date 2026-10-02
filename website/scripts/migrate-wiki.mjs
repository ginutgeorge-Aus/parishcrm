// Converts GitHub wiki pages into Starlight docs pages.
// usage: node scripts/migrate-wiki.mjs <wikiDir> <outDir>
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export function slugFor(pageName) {
  const s = pageName.trim().replace(/\s+/g, '-').toLowerCase()
  return s === 'home' ? 'index' : s
}

function pageHref(target, base) {
  const [page, anchor] = target.split('#')
  const slug = slugFor(page)
  const path = slug === 'index' ? `${base}/` : `${base}/${slug}/`
  return anchor ? `${path}#${anchor}` : path
}

const isWikiTarget = (t) => !/^([a-z]+:|#|\/|\.)/i.test(t)

// Rewrite only outside code: split on fenced blocks and inline code spans.
function mapProse(md, fn) {
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join('')
}

export function rewriteLinks(md, base) {
  return mapProse(md, (s) =>
    s
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, text, page) => `[${text}](${pageHref(page, base)})`)
      .replace(/\[\[([^\]]+)\]\]/g, (_, page) => `[${page}](${pageHref(page, base)})`)
      .replace(/\]\(([^)\s]+)\)/g, (m, t) => (isWikiTarget(t) ? `](${pageHref(t, base)})` : m)),
  )
}

export function extractTitle(md) {
  const m = md.match(/^# (.+)\n+/)
  return m ? { title: m[1].trim(), body: md.slice(m[0].length) } : { title: '', body: md }
}

export function extractDescription(body) {
  const para = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|```|\||>|[-*] |\d+\. )/.test(p))
  if (!para) return ''
  const plain = para
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    // Emphasis markers only — keep `_`/`*` inside identifiers and globs (EVENT_ORGANISER, scripts/*.ts).
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[\s(])([*_])(?=\S)(.+?)(?<=\S)\2(?=[\s.,;:!?)]|$)/g, '$1$3')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= 160) return plain
  const cut = plain.slice(0, 159)
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`
}

export function convertPage(pageName, md, base) {
  const { title, body } = extractTitle(md)
  const t = title || pageName.replace(/-/g, ' ')
  const description = extractDescription(body)
  const content =
    `---\ntitle: ${JSON.stringify(t)}\ndescription: ${JSON.stringify(description)}\n---\n\n` +
    rewriteLinks(body, base)
  return { slug: slugFor(pageName), content }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [wikiDir, outDir] = process.argv.slice(2)
  if (!wikiDir || !outDir) {
    console.error('usage: migrate-wiki.mjs <wikiDir> <outDir>')
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  const files = readdirSync(wikiDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  for (const f of files) {
    const { slug, content } = convertPage(basename(f, '.md'), readFileSync(join(wikiDir, f), 'utf8'), '/parishcrm/docs')
    writeFileSync(join(outDir, `${slug}.md`), content)
  }
  console.log(`converted ${files.length} pages → ${outDir}`)
}
