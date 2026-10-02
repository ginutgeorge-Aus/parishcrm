import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugFor, rewriteLinks, extractTitle, extractDescription, convertPage } from './migrate-wiki.mjs'

const B = '/parishcrm/docs'

test('slugFor lowercases, hyphenates, maps Home to index', () => {
  assert.equal(slugFor('Petty-Cash'), 'petty-cash')
  assert.equal(slugFor('Bank Statement Import'), 'bank-statement-import')
  assert.equal(slugFor('Card-Payments-Stripe'), 'card-payments-stripe')
  assert.equal(slugFor('Home'), 'index')
})

test('rewriteLinks: markdown page links incl. anchors', () => {
  assert.equal(rewriteLinks('see [Receipts](Receipts).', B), `see [Receipts](${B}/receipts/).`)
  assert.equal(
    rewriteLinks('[m](Operations-Scripts#maintenance-mode)', B),
    `[m](${B}/operations-scripts/#maintenance-mode)`,
  )
  assert.equal(rewriteLinks('[Home](Home)', B), `[Home](${B}/)`)
})

test('rewriteLinks: wiki [[Page]] and [[text|Page]]', () => {
  assert.equal(rewriteLinks('[[Transactions]]', B), `[Transactions](${B}/transactions/)`)
  assert.equal(rewriteLinks('[[Bank Statement Import]]', B), `[Bank Statement Import](${B}/bank-statement-import/)`)
  assert.equal(rewriteLinks('a [[fund|Accounting-Overview]]', B), `a [fund](${B}/accounting-overview/)`)
})

test('rewriteLinks leaves external, absolute, anchor-only and mailto links alone', () => {
  const md = '[a](https://github.com/x/blob/main/LICENSE) [b](#local) [c](/abs) [d](mailto:x@example.com)'
  assert.equal(rewriteLinks(md, B), md)
})

test('rewriteLinks ignores links inside fenced and inline code', () => {
  const md = '```\n[x](Receipts)\n```\n`[[Receipts]]`'
  assert.equal(rewriteLinks(md, B), md)
})

test('extractTitle pulls first H1 and strips it', () => {
  assert.deepEqual(extractTitle('# Petty Cash\n\nBody text.\n'), { title: 'Petty Cash', body: 'Body text.\n' })
})

test('extractTitle falls back when no H1', () => {
  assert.deepEqual(extractTitle('Body only.\n'), { title: '', body: 'Body only.\n' })
})

test('extractDescription strips markdown and truncates on a word boundary', () => {
  const body = '## Heading\n\nPetty cash tracks **physical** cash in the [[Transactions]] ledger and `code`.\n\nSecond para.'
  assert.equal(extractDescription(body), 'Petty cash tracks physical cash in the Transactions ledger and code.')
  const long = 'word '.repeat(60)
  const d = extractDescription(long)
  assert.ok(d.length <= 160, `len ${d.length}`)
  assert.ok(d.endsWith('…'))
})

test('convertPage emits YAML frontmatter + rewritten body', () => {
  const { slug, content } = convertPage('Petty-Cash', '# Petty Cash\n\nSee [[Receipts]].\n', B)
  assert.equal(slug, 'petty-cash')
  assert.equal(
    content,
    `---\ntitle: "Petty Cash"\ndescription: "See Receipts."\n---\n\nSee [Receipts](${B}/receipts/).\n`,
  )
})

test('convertPage uses page name as title when no H1', () => {
  const { content } = convertPage('Check-In', 'Text.\n', B)
  assert.match(content, /^---\ntitle: "Check In"\n/)
})

test('extractDescription keeps underscores and asterisks inside identifiers and code', () => {
  assert.equal(
    extractDescription('A `EVENT_ORGANISER` role runs `scripts/*.ts` with *care* and __bold\ntext__.'),
    'A EVENT_ORGANISER role runs scripts/*.ts with care and bold text.',
  )
})
