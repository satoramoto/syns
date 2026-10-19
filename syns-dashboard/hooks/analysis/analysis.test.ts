import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted as MountedOf } from 'claude-code/testing'

import { C } from '../../kit/tokens'
import { BLANK } from '../../kit/ui'

// The dashboard's Analysis tab drawn by the engine's test kit on each surface,
// tested to its spec (numbered [1]..[10] in each test's name). The test's own
// hooks sit beneath the dashboard and stand for the engine: HOME is /home/r, so
// focus.json is /home/r/.syns/files/focus/focus.json, read through `fs.stat`
// and `fs.read` from `world.file` (null: no file); `process.spawn` records each
// run and ends as `world.run` says (held open, an exit code, a last stderr line).

const PLUGIN = 'syns-dashboard'
const NOW = Date.UTC(2026, 9, 18, 20)
const HOUR = 3_600_000
const FOCUS = '/.syns/files/focus/focus.json'

/** The dashboard's pane; tall enough that nothing is scrolled out of the drawing. */
const PANE = {
  component: 'Pane',
  requestId: PLUGIN,
  props: { title: 'syn', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

// ---- fixtures, in focus.json's shape ----

const pad = (i: number) => String(i).padStart(2, '0')

type Neighbour = { term: string; npmi: number; jaccard: number; shared: number }
const neighbour = (term: string, npmi: number): Neighbour => ({ term, npmi, jaccard: 0.1, shared: 3 })

/** Term i: stem `stemNN`, surface `Word NN`, count 1000 - i (so term 0 is the most counted). */
const term = (i: number, neighbours: Neighbour[] = []) => ({
  term: `stem${pad(i)}`,
  surface: `Word ${pad(i)}`,
  count: 1000 - i,
  perBucket: [1, 2, 3],
  harnesses: { claude: 1000 - i },
  neighbours,
})

/**
 * Term 0's 9 neighbours, out of npmi order: the top one is `stem40` (the 41st
 * term, on the last page, so on the first page only its neighbour row can show
 * `Word 40`); then nbr2x..nbr8x; nbr9x has the lowest npmi and is the one past 8.
 */
const NINE = [
  neighbour('nbr5x', 0.5),
  neighbour('nbr9x', 0.05),
  neighbour('stem40', 0.9),
  neighbour('nbr2x', 0.8),
  neighbour('nbr8x', 0.2),
  neighbour('nbr3x', 0.7),
  neighbour('nbr7x', 0.3),
  neighbour('nbr4x', 0.6),
  neighbour('nbr6x', 0.4),
]

/** 41 terms, given least counted first so the tab has to sort them; term 1 has one neighbour, `lonex`. */
const TERMS41 = Array.from({ length: 41 }, (_, i) => term(i, i === 0 ? NINE : i === 1 ? [neighbour('lonex', 0.5)] : [])).reverse()

/** The newest week's 9 terms b1x..b9x: tfidf 10 - i (b1x first), count i + 10 (so count order is the reverse). Shuffled. */
const NEWEST_TERMS = [5, 9, 1, 7, 3, 8, 2, 6, 4].map(i => ({ term: `b${i}x`, tfidf: 10 - i, count: i + 10 }))

const topicShares = [{ id: 'topic00', share: 0.4 }]

/** Three weeks, out of order: 09-28 (113 prompts), 10-05 (52), 10-12 (29, newest). 194 prompts in all. */
const BUCKETS3 = [
  { start: '2026-10-05', prompts: 52, sessions: 4, repos: { 'satoramoto/syns': 52 }, terms: [{ term: 'old05x', tfidf: 3, count: 6 }], topics: topicShares },
  { start: '2026-10-12', prompts: 29, sessions: 3, repos: { 'satoramoto/syns': 29 }, terms: NEWEST_TERMS, topics: topicShares },
  { start: '2026-09-28', prompts: 113, sessions: 7, repos: { 'satoramoto/syns': 113 }, terms: [{ term: 'old28x', tfidf: 3, count: 9 }], topics: topicShares },
]

/** Topic i: `Topic NN`, total (21 - i) / 100 (topic 0 the largest, 21%); topic 0 lives 09-30 → 10-14, the rest 09-28 → 10-12. */
const topic = (i: number) => ({
  id: `topic${pad(i)}`,
  name: `Topic ${pad(i)}`,
  terms: [`stem${pad(i)}`],
  first: i === 0 ? '2026-09-30' : '2026-09-28',
  peak: '2026-10-05',
  last: i === 0 ? '2026-10-14' : '2026-10-12',
  total: (21 - i) / 100,
  sessions: 2,
  harnesses: { claude: 2 },
  category: 'work',
})
/** 21 topics, smallest first. */
const TOPICS21 = Array.from({ length: 21 }, (_, i) => topic(i)).reverse()

/** The full file: generated 2 hours ago, weekly, 41 terms, 3 weeks, 21 topics. */
const FULL = {
  generatedAt: new Date(NOW - 2 * HOUR).toISOString(),
  since: '2026-09-01',
  bucket: 'week',
  buckets: BUCKETS3,
  topics: TOPICS21,
  terms: TERMS41,
  edges: [],
  categories: [],
}

/** A small file: daily, one bucket (29 prompts), one term with no neighbours, one topic holding the whole share. */
const SMALL = {
  generatedAt: new Date(NOW - 2 * HOUR).toISOString(),
  since: '2026-10-18',
  bucket: 'day',
  buckets: [{ start: '2026-10-18', prompts: 29, sessions: 3, repos: {}, terms: [{ term: 'solo', tfidf: 2, count: 5 }], topics: [{ id: 'only', share: 1 }] }],
  topics: [{ id: 'only', name: 'Only topic', terms: ['solo'], first: '2026-10-18', peak: '2026-10-18', last: '2026-10-18', total: 1, sessions: 3, harnesses: { claude: 3 }, category: 'work' }],
  terms: [{ term: 'solo', surface: 'Solo Word', count: 5, perBucket: [5], harnesses: { claude: 5 }, neighbours: [] }],
  edges: [],
  categories: [],
}

/** A trimmed copy of the real ~/.syns/files/focus/focus.json (2026-10-19 run): 3 terms, 2 weeks, 2 topics. */
const REAL = {
  generatedAt: '2026-10-19T00:45:56.414Z',
  since: '2026-09-01',
  bucket: 'week',
  termMin: 3,
  buckets: [
    {
      start: '2026-10-05',
      prompts: 1011,
      sessions: 78,
      repos: { 'openflowfm/visuals': 346, 'satoramoto/awesome-claude': 134 },
      terms: [
        { term: '/overview', tfidf: 7.0657, count: 11 },
        { term: 'meridians', tfidf: 6.4035, count: 8 },
        { term: 'milkdrop presets', tfidf: 6.4035, count: 8 },
      ],
      topics: [
        { id: 'orchestrator', share: 0.0335 },
        { id: 'star', share: 0.0148 },
      ],
    },
    {
      start: '2026-10-12',
      prompts: 936,
      sessions: 66,
      repos: { 'codex desktop': 299, 'satoramoto/awesome-claude': 253 },
      terms: [
        { term: 'zen', tfidf: 9.3502, count: 33 },
        { term: 'syns', tfidf: 9.2862, count: 32 },
        { term: 'compression', tfidf: 8.0898, count: 18 },
      ],
      topics: [
        { id: 'status', share: 0.0355 },
        { id: 'elegant', share: 0.034 },
      ],
    },
  ],
  terms: [
    {
      term: 'start',
      surface: 'start',
      count: 226,
      perBucket: [28, 6],
      harnesses: { claude: 184, codex: 42 },
      neighbours: [
        { term: 'dev server fail', npmi: 0.444, jaccard: 0.031, shared: 7 },
        { term: 'follow error', npmi: 0.444, jaccard: 0.031, shared: 7 },
        { term: 'ryan', npmi: 0.4333, jaccard: 0.0265, shared: 6 },
      ],
    },
    {
      term: 'build',
      surface: 'build',
      count: 198,
      perBucket: [28, 5],
      harnesses: { claude: 156, codex: 42 },
      neighbours: [
        { term: 'assembl', npmi: 0.4488, jaccard: 0.0498, shared: 10 },
        { term: 'linux', npmi: 0.4299, jaccard: 0.0302, shared: 6 },
      ],
    },
    {
      term: 'merg',
      surface: 'merge',
      count: 180,
      perBucket: [0, 0],
      harnesses: { claude: 177, codex: 3 },
      neighbours: [
        { term: 'main', npmi: 0.474, jaccard: 0.1956, shared: 53 },
        { term: 'green', npmi: 0.4171, jaccard: 0.0677, shared: 13 },
      ],
    },
  ],
  topics: [
    { id: 'vitruvian', name: 'vitruvian', category: 'vitruvian', terms: ['vitruvian', 'supplied'], first: '2026-09-07', peak: '2026-09-07', last: '2026-09-07', total: 0.2432, sessions: 6, harnesses: { claude: 6 } },
    { id: 'training', name: 'training', category: 'vitruvian', terms: ['training', 'unit'], first: '2026-09-07', peak: '2026-09-07', last: '2026-10-12', total: 0.1351, sessions: 38, harnesses: { claude: 32, codex: 10 } },
  ],
  edges: [{ a: '/epic', b: 'proof plan', npmi: 1, jaccard: 1, shared: 3 }],
  categories: [{ id: 'vitruvian', name: 'vitruvian', seed: null, topics: ['vitruvian', 'training'], total: 0.554 }],
}

// ---- the engine beneath the mod ----

type Run = {
  /** The exit code (null with a signal). */
  code: number | null
  signal?: string | null
  /** What the run writes to stderr before it ends. */
  stderr?: string
  /** Held open until this resolves. */
  hold?: Promise<void>
  /** Called just before it ends (a run that rewrites focus.json). */
  done?: () => void
}

type World = {
  /** focus.json's text; null when there is no file. */
  file: string | null
  mtime: number
  run: Run
  /** The argv of every spawn the tab asked for. */
  spawned: string[][]
  opened: string[]
  /** Every path ending in analysis/focus.ts the tab stat'd, in order. */
  analyzerStats: string[]
  /** Whether the analyzer is at that path (everywhere by default). */
  analyzerAt: (path: string) => boolean
  clock: ReturnType<typeof mock.clock>
}

const isFocus = (path: string) => path.replace(/\\/g, '/').endsWith(FOCUS)
const isAnalyzer = (path: string) => path.replace(/\\/g, '/').endsWith('/analysis/focus.ts')

const engine = (on: On, file: unknown): World => {
  const world: World = {
    file: file === null ? null : typeof file === 'string' ? file : JSON.stringify(file),
    mtime: NOW - HOUR,
    run: { code: 0 },
    spawned: [],
    opened: [],
    analyzerStats: [],
    analyzerAt: () => true,
    clock: mock.clock(on, { now: NOW }),
  }
  on('session.cwd', async () => ({ value: '/repo' }))
  on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? '/home/r' : undefined }))
  on('ui.open', async (_$, e) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', async () => ({ value: [{ id: PLUGIN, title: 'syn', isShown: true, isFocused: false, isPlaced: true }] }) as never)
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.focus', async () => ({}))
  on('command.run', async () => ({ text: '' }))
  on('fs.stat', async (_$, e) => {
    if (isFocus(e.path) && world.file !== null) return { value: { kind: 'file' as const, size: world.file.length, mtimeMs: world.mtime, isLink: false } }
    // The analyzer the run starts is there, wherever the tab looks for its checkout.
    if (isAnalyzer(e.path)) world.analyzerStats.push(e.path)
    if (isAnalyzer(e.path) && world.analyzerAt(e.path)) return { value: { kind: 'file' as const, size: 1, mtimeMs: NOW - HOUR, isLink: false } }
    throw new Error(`ENOENT: no such file or directory, stat '${e.path}'`)
  })
  on('fs.read', async (_$, e) => {
    if (isFocus(e.path) && world.file !== null) return { value: world.file }
    throw new Error(`ENOENT: no such file or directory, open '${e.path}'`)
  })
  on('fs.exists', async (_$, e) => ({ value: (isFocus(e.path) && world.file !== null) || (isAnalyzer(e.path) && world.analyzerAt(e.path)) }))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'not answered in this test', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* (_$, e, next) {
    world.spawned.push([...e.argv])
    const run = world.run
    if (run.hold) {
      // Held until the test lets it go, or until the tab kills it (leaving its loop aborts this dispatch).
      const killed = new Promise<'killed'>(resolve => (next.signal.aborted ? resolve('killed') : next.signal.addEventListener('abort', () => resolve('killed'))))
      if ((await Promise.race([run.hold, killed])) === 'killed') return { value: { code: null, signal: 'SIGTERM' } }
    }
    if (run.stderr) yield { stream: 'stderr' as const, text: run.stderr }
    run.done?.()
    return { value: { code: run.code, signal: run.signal ?? null } }
  })
  return world
}

/** `/syn-analysis` as the person types it. */
const analysis = ($: Engine) =>
  $.command.run({ command: 'syn-analysis', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

/** The engine with focus.json as `file` (null: none), the tab opened by `/syn-analysis` and its read settled. */
const opened = async ($: Engine, on: On, file: unknown) => {
  const world = engine(on, file)
  await analysis($)
  await world.clock.settle()
  return world
}

type Mounted = MountedOf<Surface, 'Pane'>

/** The pane mounted on `surface`, drawn once the tab's work settled. */
const show = async ($: Engine, world: World, surface: Surface, bodyColumns = 60): Promise<Mounted> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props: { ...PANE.props, bodyColumns } })
  await world.clock.settle()
  await ui.redraw()
  return ui
}

// ---- reading what the pane draws ----

type Drawn = { type?: string; key?: string; props?: Record<string, any>; children?: unknown[] }
const kids = (d: Drawn) => ((d.children ?? d.props?.children ?? []) as unknown[]).flat(Infinity)
const clean = (s: string) => s.replaceAll(BLANK, '').trim()
/** An element's text: its strings, a Button's label, each child element apart by a space. */
const shown = (d: Drawn): string => {
  const own = d.type === 'Button' && typeof d.props?.label === 'string' ? [clean(d.props.label)] : []
  const inner = kids(d).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : c && typeof c === 'object' ? ` ${shown(c as Drawn)} ` : ''))
  return [...own, inner.join('')].join(' ').replaceAll(BLANK, '')
}
const isBox = (c: unknown) => !!c && typeof c === 'object' && (c as Drawn).type === 'Box'
/** The drawing as rows: each Box holding no Box is one row of its text run together; anything else beside Boxes is its own row. */
const rowsOf = (d: Drawn): string[] => {
  const children = kids(d)
  if (d.type !== 'Box' && d.type !== undefined && !children.some(isBox)) return [shown(d)]
  if (d.type === 'Box' && !children.some(isBox)) return [shown(d)]
  return children.flatMap(c => (c && typeof c === 'object' ? rowsOf(c as Drawn) : typeof c === 'string' ? [c] : []))
}
const rows = async (ui: Mounted) => rowsOf((await ui.drawn()) as Drawn).map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean)
const all = async (ui: Mounted) => (await rows(ui)).join('\n')
/** The index of the first row matching `re`; -1 when none. */
const at = (list: string[], re: RegExp) => list.findIndex(r => re.test(r))
/** Row `i` and the few after it: a reading's label, gauge, value and fold arrow are rows of their own. */
const near = (list: string[], i: number, span = 4) => list.slice(Math.max(i, 0), Math.max(i, 0) + span).join('\n')
/** A word not glued to a longer one: `Word 4` never matches `Word 40`. */
const word = (w: string) => new RegExp(`(?<![\\w])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\w])`)
/** A figure and its unit, either way round: `194 prompts` or `prompts 194`. */
const figure = (n: number | string, unit: string) => new RegExp(`(?<![\\d.,])${n}\\s*${unit}|${unit}\\W{0,3}${n}(?![\\d])`, 'i')

/** Texts drawn in the error colour. */
const errors = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).filter(t => t.props.color === 'error' || t.props.color === C.bad)

/** The key of the Button (or a desktop quiet button's `-press` label) whose text matches `re`. */
const buttonKey = async (ui: Mounted, re: RegExp): Promise<string | undefined> => {
  for (const b of await ui.findAll({ type: 'Button' })) {
    const label = typeof b.props.label === 'string' ? clean(b.props.label) : ''
    if (b.key && (re.test(clean(b.text)) || re.test(label))) return b.key
  }
  for (const b of await ui.findAll({ type: 'Box' })) if (b.key?.endsWith('-press') && re.test(clean(b.text))) return b.key.slice(0, -'-press'.length)
  return undefined
}

/** The Button that folds or unfolds something named by any of `needles` (in its key or its text). */
const toggleKey = async (ui: Mounted, needles: string[]) => {
  for (const b of await ui.findAll({ type: 'Button' })) {
    const hay = `${b.key ?? ''} ${clean(b.text)} ${typeof b.props.label === 'string' ? clean(b.props.label) : ''}`
    if (b.key && needles.some(n => hay.includes(n))) return b.key
  }
  return undefined
}

const press = async (ui: Mounted, world: World, key: string) => {
  await ui.press({ key })
  await world.clock.settle()
  await ui.redraw()
}

const RUN = /^Run$/i

type Section = 'terms' | 'weeks' | 'topics'

/** Opens a section by its header (`toggle-<id>`) unless `openMark` already shows it open. */
const openSection = async (ui: Mounted, world: World, id: Section, openMark: RegExp) => {
  if (!openMark.test(await all(ui))) await press(ui, world, `toggle-${id}`)
  expect(await all(ui), `${id} open`).toMatch(openMark)
}

/** The section's pages from the one shown, pressing `<id>-next` until it's gone or changes nothing: each page's rows. */
const pages = async (ui: Mounted, world: World, id: Section, limit = 40) => {
  const out: string[][] = [await rows(ui)]
  for (let i = 0; i < limit; i++) {
    if (!(await ui.find({ key: `${id}-next` }))) break
    const before = await all(ui)
    await press(ui, world, `${id}-next`)
    if ((await all(ui)) === before) break
    out.push(await rows(ui))
  }
  return out
}

/** A bucket's start as its header may show it, `2026-10-12` or `10-12`. */
const date = (d: string) => new RegExp(`(?<![\\d-])(2026-)?${d.replace(/^2026-/, '')}(?!\\d)`)
/** Which of `names` a page shows, as indices into `names`, in the page's row order. */
const shownOn = (page: string[], names: (string | RegExp)[]) =>
  names
    .map((n, i) => [i, at(page, typeof n === 'string' ? word(n) : n)] as const)
    .filter(([, row]) => row >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([i]) => i)

// ---- [1] the command ----

test('[1] /syn-analysis opens the dashboard pane on the Analysis tab and answers with "Analysis", on the terminal and the desktop', async ($, on) => {
  const world = engine(on, FULL)
  const answer = await analysis($)
  await world.clock.settle()
  expect(JSON.stringify(answer)).toMatch(/Analysis/)
  expect(world.opened).toContain(PLUGIN)
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    // The Analysis tab, not another: its sections are drawn.
    expect(await all(ui), surface).toMatch(word('Topics'))
    expect(await all(ui), surface).toMatch(word('Word 00'))
    await ui.unmount()
  }
})

// ---- [2] no file ----

test('[2] with no focus.json the tab says there is no run yet and that Run makes one, with no error, on each surface', async ($, on) => {
  const world = await opened($, on, null)
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    const text = await all(ui)
    expect(text, surface).toMatch(/no run/i)
    expect(text, surface).toMatch(/\bRun\b/)
    expect((await errors(ui)).map(t => t.text), surface).toEqual([])
    await ui.unmount()
  }
})

// ---- [3] the heading ----

test('[3] the heading shows when the run was made (relative), its prompts (summed over buckets), terms and topics counts, on each surface', async ($, on) => {
  const world = await opened($, on, FULL)
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    const text = await all(ui)
    expect(text, `${surface}: generated 2 hours ago`).toMatch(/(?<!\d)2\s*h\b|2 hours/)
    expect(text, `${surface}: 113 + 52 + 29 prompts`).toMatch(figure(194, 'prompts?'))
    expect(text, `${surface}: 41 terms in the file`).toMatch(figure(41, 'terms?'))
    expect(text, `${surface}: 21 topics in the file`).toMatch(figure(21, 'topics?'))
    await ui.unmount()
  }
})

test('[3] a one-bucket file: the heading counts 29 prompts, 1 term, 1 topic', async ($, on) => {
  const world = await opened($, on, SMALL)
  const ui = await show($, world, 'desktop')
  const text = await all(ui)
  expect(text).toMatch(figure(29, 'prompts?'))
  expect(text).toMatch(figure(1, 'terms?'))
  expect(text).toMatch(figure(1, 'topics?'))
  await ui.unmount()
})

// ---- [4] Terms ----

const WORDS = (n: number) => Array.from({ length: n }, (_, i) => `Word ${pad(i)}`)

for (const surface of SURFACES) {
  test(`[4] on the ${surface}, Terms is open by default, 10 terms a page by count with surface form and count; of 41 terms the 40 most counted page into 4, and back`, async ($, on) => {
    const world = await opened($, on, FULL)
    const ui = await show($, world, surface)
    const first = await rows(ui)
    expect(at(first, /^Terms\b/), 'a Terms section').toBeGreaterThanOrEqual(0)
    // Each reading carries its count; the stem is never what's shown.
    expect(near(first, at(first, word('Word 00')), 3)).toMatch(word('1000'))
    expect(near(first, at(first, word('Word 09')), 3)).toMatch(word('991'))
    expect(at(first, word('stem00')), 'the stem').toBe(-1)

    const all41 = await pages(ui, world, 'terms')
    // At most 40 shown: the 41st (count 960) is on no page.
    expect(all41.map(p => shownOn(p, WORDS(41))), 'the 40 most counted once each, 10 a page, by count').toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
      [30, 31, 32, 33, 34, 35, 36, 37, 38, 39],
    ])
    expect(near(all41[3]!, at(all41[3]!, word('Word 39')), 3)).toMatch(word('961'))
    // terms-prev goes back a page.
    await press(ui, world, 'terms-prev')
    expect(shownOn(await rows(ui), WORDS(41))).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29])
    await ui.unmount()
  })

  test(`[4] on the ${surface}, 40 terms page into 4`, async ($, on) => {
    const world = await opened($, on, { ...FULL, terms: TERMS41.filter(t => t.term !== 'stem40') })
    const ui = await show($, world, surface)
    const all40 = await pages(ui, world, 'terms')
    expect(all40.map(p => shownOn(p, WORDS(40)).length)).toEqual([10, 10, 10, 10])
    await ui.unmount()
  })
}

test('[4] one term with no neighbours is one reading with its surface form and count', async ($, on) => {
  const world = await opened($, on, SMALL)
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    const list = await rows(ui)
    const row = at(list, word('Solo Word'))
    expect(row, surface).toBeGreaterThanOrEqual(0)
    expect(near(list, row, 3), surface).toMatch(word('5'))
    expect((await errors(ui)).map(t => t.text), surface).toEqual([])
    await ui.unmount()
  }
})

test('[4] no terms (an empty list) lists no readings and draws no error', async ($, on) => {
  const world = await opened($, on, { ...FULL, terms: [] })
  const ui = await show($, world, 'desktop')
  const text = await all(ui)
  expect(text).not.toMatch(word('Word 00'))
  expect(text).toMatch(figure(0, 'terms?'))
  expect((await errors(ui)).map(t => t.text)).toEqual([])
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`[4] on the ${surface}, unfolding another term's neighbours folds the first's: one at a time`, async ($, on) => {
    const world = await opened($, on, FULL)
    const ui = await show($, world, surface)
    await press(ui, world, (await toggleKey(ui, ['stem00', 'Word 00']))!)
    expect(await all(ui)).toMatch(word('nbr2x'))
    const key = await toggleKey(ui, ['stem01', 'Word 01'])
    expect(key, 'a fold toggle for Word 01').toBeDefined()
    await press(ui, world, key!)
    const text = await all(ui)
    expect(text, "Word 01's neighbour").toMatch(word('lonex'))
    expect(text, "Word 00's folded").not.toMatch(word('nbr2x'))
    await ui.unmount()
  })
}

test("[4] a term's neighbours are folded by default; unfolded, the 8 with the highest npmi show by surface form, in npmi order", async ($, on) => {
  const world = await opened($, on, FULL)
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    expect(await all(ui), `${surface}: folded`).not.toMatch(word('nbr2x'))
    const key = await toggleKey(ui, ['stem00', 'Word 00'])
    expect(key, `${surface}: a fold toggle for Word 00`).toBeDefined()
    await press(ui, world, key!)
    const list = await rows(ui)
    // The top neighbour is the stem `stem40`, shown by its surface form.
    const top = at(list, word('Word 40'))
    expect(top, `${surface}: the top neighbour by surface form`).toBeGreaterThanOrEqual(0)
    expect(at(list, word('stem40')), `${surface}: never the stem`).toBe(-1)
    const order = [top, ...[2, 3, 4, 5, 6, 7, 8].map(i => at(list, word(`nbr${i}x`)))]
    expect(order.every(i => i >= 0), `${surface}: 8 neighbours ${JSON.stringify(order)}`).toBe(true)
    expect([...order].sort((a, b) => a - b), `${surface}: by npmi`).toEqual(order)
    expect(at(list, word('nbr9x')), `${surface}: the 9th is cut`).toBe(-1)
    // Pressed again, it folds (and the next surface starts folded, as the folds are the mod's state).
    await press(ui, world, key!)
    expect(await all(ui), `${surface}: folded again`).not.toMatch(word('nbr2x'))
    await ui.unmount()
  }
})

// ---- [5] By week / By day ----

const WEEKS3 = ['2026-10-12', '2026-10-05', '2026-09-28']
const B_TERMS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `b${i}x`)

/** 25 weeks from 2026-04-20, one prompt more each week, given oldest first. */
const WEEKS25 = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2026, 3, 20) + i * 7 * 24 * HOUR).toISOString().slice(0, 10))
const BUCKETS25 = WEEKS25.map((start, i) => ({ start, prompts: i + 1, sessions: 1, repos: {}, terms: [{ term: `w${i}x`, tfidf: 1, count: 1 }], topics: [] }))

for (const surface of SURFACES) {
  test(`[5] on the ${surface}, By week is folded until its header opens it, which closes Terms; its buckets newest first, each folded`, async ($, on) => {
    const world = await opened($, on, FULL)
    const ui = await show($, world, surface)
    const before = await rows(ui)
    expect(at(before, /^By week\b/), 'titled By week').toBeGreaterThanOrEqual(0)
    expect(at(before, /^By day\b/)).toBe(-1)
    expect(shownOn(before, WEEKS3.map(date)), 'folded: no buckets').toEqual([])

    await press(ui, world, 'toggle-weeks')
    const list = await rows(ui)
    expect(shownOn(list, WEEKS3.map(date)), 'a header per bucket, newest first').toEqual([0, 1, 2])
    // Every bucket starts folded.
    expect(shownOn(list, [...B_TERMS, 'old05x', 'old28x'])).toEqual([])
    // One section open at a time: Terms closed.
    expect(at(list, word('Word 00')), 'Terms closed').toBe(-1)
    await ui.unmount()
  })

  test(`[5] on the ${surface}, a bucket unfolds to its prompts, sessions and 8 terms by tfidf with counts; unfolding another folds it`, async ($, on) => {
    const world = await opened($, on, FULL)
    const ui = await show($, world, surface)
    await press(ui, world, 'toggle-weeks')
    const newest = await toggleKey(ui, ['2026-10-12', '10-12'])
    expect(newest, 'a fold toggle for the 10-12 bucket').toBeDefined()
    await press(ui, world, newest!)
    const list = await rows(ui)
    const text = list.join('\n')
    expect(text).toMatch(figure(29, 'prompts?'))
    expect(text).toMatch(figure(3, 'sessions?'))
    expect(shownOn(list, B_TERMS), '8 terms by tfidf, the 9th cut').toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // A term's figure is its count.
    expect(near(list, at(list, word('b1x')), 3)).toMatch(word('11'))
    expect(text, 'the others stay folded').not.toMatch(word('old05x'))

    const older = await toggleKey(ui, ['2026-10-05', '10-05'])
    expect(older, 'a fold toggle for the 10-05 bucket').toBeDefined()
    await press(ui, world, older!)
    const after = await all(ui)
    expect(after).toMatch(word('old05x'))
    expect(after).toMatch(figure(52, 'prompts?'))
    expect(after, 'one bucket at a time').not.toMatch(word('b1x'))
    await ui.unmount()
  })

  test(`[5] on the ${surface}, weeks-next and weeks-prev page through 25 buckets, each once, newest first`, async ($, on) => {
    const world = await opened($, on, { ...FULL, buckets: BUCKETS25 })
    const ui = await show($, world, surface)
    await press(ui, world, 'toggle-weeks')
    const all25 = await pages(ui, world, 'weeks')
    expect(all25.length, 'more than one page').toBeGreaterThan(1)
    const newestFirst = [...WEEKS25].reverse().map(date)
    expect(all25.flatMap(p => shownOn(p, newestFirst))).toEqual(Array.from({ length: 25 }, (_, i) => i))
    const last = shownOn(all25.at(-1)!, newestFirst)
    await press(ui, world, 'weeks-prev')
    expect(shownOn(await rows(ui), newestFirst)).toEqual(shownOn(all25.at(-2)!, newestFirst))
    expect(last).toContain(24)
    await ui.unmount()
  })

  test(`[5] on the ${surface}, a daily file's section is titled By day`, async ($, on) => {
    const world = await opened($, on, SMALL)
    const ui = await show($, world, surface)
    const list = await rows(ui)
    expect(at(list, /^By day\b/)).toBeGreaterThanOrEqual(0)
    expect(at(list, /^By week\b/)).toBe(-1)
    await press(ui, world, 'toggle-weeks')
    await press(ui, world, (await toggleKey(ui, ['2026-10-18', '10-18']))!)
    // Its term, by stem or by the surface form the terms give it.
    expect(await all(ui)).toMatch(/(?<![\w])(solo|Solo Word)(?![\w])/)
    await ui.unmount()
  })
}

// ---- [6] Topics ----

const TOPIC_NAMES = Array.from({ length: 21 }, (_, i) => `Topic ${pad(i)}`)

for (const surface of SURFACES) {
  test(`[6] on the ${surface}, Topics opens by its header (closing Terms) and pages by total, each with name, lifespan MM-DD → MM-DD and its total as a percent`, async ($, on) => {
    const world = await opened($, on, FULL)
    const ui = await show($, world, surface)
    expect(at(await rows(ui), /^Topics\b/), 'a Topics section').toBeGreaterThanOrEqual(0)
    expect(shownOn(await rows(ui), TOPIC_NAMES), 'folded until opened').toEqual([])
    await press(ui, world, 'toggle-topics')
    const first = await rows(ui)
    expect(at(first, word('Word 00')), 'Terms closed').toBe(-1)
    // Share is the total, a fraction, as a percent: 0.21 → 21%, 0.20 → 20%.
    expect(near(first, at(first, word('Topic 00')))).toMatch(/09-30 → 10-14/)
    expect(near(first, at(first, word('Topic 00')))).toMatch(/(?<![\d.])21(\.0)?\s*%/)
    expect(near(first, at(first, word('Topic 01')))).toMatch(/09-28 → 10-12/)
    expect(near(first, at(first, word('Topic 01')))).toMatch(/(?<![\d.])20(\.0)?\s*%/)

    const every = await pages(ui, world, 'topics')
    const seen = every.flatMap(p => shownOn(p, TOPIC_NAMES))
    // The 20 largest reachable, by total, each once (spec unclear whether the 21st is listed).
    expect(seen.slice(0, 20), 'by total, each once').toEqual(Array.from({ length: 20 }, (_, i) => i))
    if (every.length > 1) {
      await press(ui, world, 'topics-prev')
      expect(shownOn(await rows(ui), TOPIC_NAMES)).toEqual(shownOn(every.at(-2)!, TOPIC_NAMES))
    }
    await ui.unmount()
  })
}

test('[6] a single topic with a total of 1 shows 100%', async ($, on) => {
  const world = await opened($, on, SMALL)
  const ui = await show($, world, 'desktop')
  await press(ui, world, 'toggle-topics')
  const list = await rows(ui)
  const row = at(list, word('Only topic'))
  expect(row).toBeGreaterThanOrEqual(0)
  // First and last the same day: that one date, no arrow.
  expect(near(list, row)).toMatch(/^10-18$/m)
  expect(near(list, row)).not.toMatch(/→/)
  expect(near(list, row)).toMatch(/100(\.0)?\s*%/)
  await ui.unmount()
})

// ---- [7] Run ----

const ARGS = (since: string, bucket: string) => ['bun', 'analysis/focus.ts', '--since', since, '--bucket', bucket]

test('[7] Run spawns the analyzer once with the file’s since and bucket; the heading says running; a second press spawns nothing; a changed file is re-read after', async ($, on) => {
  const world = await opened($, on, FULL)
  let finish = () => {}
  world.run = {
    code: 0,
    hold: new Promise<void>(resolve => (finish = resolve)),
    // The run writes a new focus.json: one week of 500 prompts.
    done: () => {
      world.file = JSON.stringify({ ...FULL, buckets: [{ ...BUCKETS3[1], start: '2026-10-19', prompts: 500 }] })
      world.mtime = NOW + 60_000
    },
  }
  const ui = await show($, world, 'desktop')
  expect(await all(ui)).not.toMatch(/running/i)
  const run = await buttonKey(ui, RUN)
  expect(run, 'a Run button').toBeDefined()
  const first = ui.press({ key: run! })
  await world.clock.settle()
  await ui.redraw()
  expect(world.spawned).toEqual([ARGS('2026-09-01', 'week')])
  expect(await all(ui), 'running in the heading').toMatch(/running/i)

  // Pressed again while it runs: nothing more starts.
  const again = await buttonKey(ui, /^Run(ning)?\b/i)
  if (again) {
    const second = ui.press({ key: again })
    await world.clock.settle()
    finish()
    await Promise.all([first, second])
  } else {
    finish()
    await first
  }
  expect(world.spawned).toHaveLength(1)

  // Done: the new file is read and its figures show.
  await world.clock.advance(5_000)
  await ui.redraw()
  const text = await all(ui)
  expect(text).not.toMatch(/running/i)
  expect(text).toMatch(figure(500, 'prompts?'))
  expect((await errors(ui)).map(t => t.text)).toEqual([])
  await ui.unmount()
})

test('[7] Run on the terminal spawns the analyzer too', async ($, on) => {
  const world = await opened($, on, FULL)
  const ui = await show($, world, 'terminal')
  const run = await buttonKey(ui, RUN)
  expect(run, 'a Run button on the terminal').toBeDefined()
  await press(ui, world, run!)
  expect(world.spawned).toEqual([ARGS('2026-09-01', 'week')])
  await ui.unmount()
})

test('[7] a run that exits 1 shows one error line with the exit code and the last stderr line', async ($, on) => {
  const world = await opened($, on, FULL)
  world.run = { code: 1, stderr: 'reading transcripts\nTypeError: cannot read focus\n' }
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    await press(ui, world, (await buttonKey(ui, RUN))!)
    const list = await rows(ui)
    const lines = list.filter(r => /TypeError: cannot read focus/.test(r))
    expect(lines, `${surface}: one error line`).toHaveLength(1)
    expect(list.join('\n'), `${surface}: the exit code`).toMatch(/(exit(ed)?|code)\D{0,10}1(?!\d)/i)
    expect(list.join('\n'), `${surface}: only the last stderr line`).not.toMatch(/reading transcripts/)
    expect((await errors(ui)).length, `${surface}: drawn as an error`).toBeGreaterThan(0)
    expect(list.join('\n'), surface).not.toMatch(/running/i)
    // The last good run still draws.
    expect(list.join('\n'), surface).toMatch(word('Word 00'))
    await ui.unmount()
  }
})

test('[7] a run that exits 0 leaves no error line', async ($, on) => {
  const world = await opened($, on, FULL)
  const ui = await show($, world, 'desktop')
  await press(ui, world, (await buttonKey(ui, RUN))!)
  expect((await errors(ui)).map(t => t.text)).toEqual([])
  expect(await all(ui)).not.toMatch(/running/i)
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`[7] on the ${surface}, a run past 120 s shows one error line saying it timed out, and Run starts again`, async ($, on) => {
    const world = await opened($, on, FULL)
    world.run = { code: null, signal: 'SIGTERM', hold: new Promise<void>(() => undefined) }
    const ui = await show($, world, surface)
    void ui.press({ key: (await buttonKey(ui, RUN))! })
    await world.clock.advance(119_000)
    await ui.redraw()
    expect(await all(ui), 'still running at 119 s').toMatch(/running/i)
    expect(await all(ui)).not.toMatch(/timed out/i)
    await world.clock.advance(2_000)
    await ui.redraw()
    const list = await rows(ui)
    expect(list.filter(r => /timed out/i.test(r)), 'one timed-out line').toHaveLength(1)
    expect((await errors(ui)).length, 'drawn as an error').toBeGreaterThan(0)
    expect(list.join('\n')).not.toMatch(/running/i)
    // Run is possible again.
    world.run = { code: 0 }
    await press(ui, world, (await buttonKey(ui, RUN))!)
    expect(world.spawned).toHaveLength(2)
    await ui.unmount()
  })
}

test('[7] before a run the tab looks for the analyzer beside the plugin, then in ~/Code/satoramoto/syns, and runs from where it is', async ($, on) => {
  const world = await opened($, on, FULL)
  // Only the ~/Code checkout has it.
  world.analyzerAt = path => path === '/home/r/Code/satoramoto/syns/analysis/focus.ts'
  const ui = await show($, world, 'desktop')
  await press(ui, world, (await buttonKey(ui, RUN))!)
  expect(world.analyzerStats.at(-1)).toBe('/home/r/Code/satoramoto/syns/analysis/focus.ts')
  expect(world.analyzerStats.length, 'the folder above the plugin was looked in first').toBeGreaterThan(1)
  expect(world.spawned).toEqual([ARGS('2026-09-01', 'week')])
  await ui.unmount()
})

// ---- [8] Since and bucket ----

test("[8] since defaults to the file's; a since that isn't YYYY-MM-DD shows a message and the next run keeps the old one; a valid one is used", async ($, on) => {
  const world = await opened($, on, FULL)
  const ui = await show($, world, 'desktop')
  const inputs = await ui.findAll({ type: 'Input' })
  expect(inputs.length, 'a since field').toBeGreaterThan(0)
  const field = inputs.find(i => JSON.stringify(i.props).includes('2026-09-01')) ?? inputs[0]!
  expect(JSON.stringify(field.props), "the file's since").toContain('2026-09-01')
  const before = await all(ui)
  /** The person types `text` into the since field and presses Enter. */
  const type = async (key: string, text: string) => {
    await $.ui.input({ plugin: PLUGIN, key, text, kind: 'change', surface: 'desktop' })
    await $.ui.input({ plugin: PLUGIN, key, text, surface: 'desktop' })
  }

  await type(field.key!, '2026-9-1x')
  await world.clock.settle()
  await ui.redraw()
  const after = await all(ui)
  expect(after, 'a message about the date').toMatch(/YYYY-MM-DD|date/i)
  expect(after).not.toEqual(before)
  await press(ui, world, (await buttonKey(ui, RUN))!)
  expect(world.spawned.at(-1)).toEqual(ARGS('2026-09-01', 'week'))

  await type(field.key!, '2026-08-15')
  await world.clock.settle()
  await press(ui, world, (await buttonKey(ui, RUN))!)
  expect(world.spawned.at(-1)).toEqual(ARGS('2026-08-15', 'week'))
  await ui.unmount()
})

test("[8] bucket defaults to the file's, toggles between day and week, and the next run uses it", async ($, on) => {
  const world = await opened($, on, FULL)
  const ui = await show($, world, 'desktop')
  // The control is a day/week pair: press the side wanted.
  const day = await buttonKey(ui, /^(day|daily)$/i)
  expect(day, 'a day choice').toBeDefined()
  await press(ui, world, day!)
  await press(ui, world, (await buttonKey(ui, RUN))!)
  expect(world.spawned.at(-1)).toEqual(ARGS('2026-09-01', 'day'))
  await press(ui, world, (await buttonKey(ui, /^(week|weekly)$/i))!)
  await press(ui, world, (await buttonKey(ui, RUN))!)
  expect(world.spawned.at(-1)).toEqual(ARGS('2026-09-01', 'week'))
  await ui.unmount()
})

test("[8] a daily file's bucket defaults to day", async ($, on) => {
  const world = await opened($, on, SMALL)
  const ui = await show($, world, 'desktop')
  await press(ui, world, (await buttonKey(ui, RUN))!)
  expect(world.spawned).toEqual([ARGS('2026-10-18', 'day')])
  await ui.unmount()
})

// ---- [9] Open page ----

test('[9] Open page shows on the desktop only', async ($, on) => {
  const world = await opened($, on, FULL)
  const desk = await show($, world, 'desktop')
  expect(await buttonKey(desk, /^Open page$/i), 'on the desktop').toBeDefined()
  await desk.unmount()
  const term = await show($, world, 'terminal')
  expect(await buttonKey(term, /Open page/i), 'not on the terminal').toBeUndefined()
  expect(await all(term)).not.toMatch(/Open page/i)
  await term.unmount()
})

// ---- [10] reading defensively ----

test('[10] a file without terms, edges, topics or categories draws the heading and By week, and no error', async ($, on) => {
  const { terms: _t, edges: _e, topics: _p, categories: _c, ...rest } = FULL
  const world = await opened($, on, rest)
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    const list = await rows(ui)
    expect(list.join('\n'), surface).toMatch(figure(194, 'prompts?'))
    expect(at(list, /^By week\b/), surface).toBeGreaterThanOrEqual(0)
    expect(at(list, /^Topics\b/), surface).toBe(-1)
    expect((await errors(ui)).map(t => t.text), surface).toEqual([])
    await ui.unmount()
  }
})

test('[10] an empty object draws no error, and Run is there', async ($, on) => {
  const world = await opened($, on, {})
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    expect((await errors(ui)).map(t => t.text), surface).toEqual([])
    expect(await buttonKey(ui, RUN), surface).toBeDefined()
    await ui.unmount()
  }
})

test('[10] invalid JSON shows one error line', async ($, on) => {
  const world = await opened($, on, '{"generatedAt": "2026-10-18T18:00:00Z", "buckets": [')
  for (const surface of SURFACES) {
    const ui = await show($, world, surface)
    expect((await errors(ui)).length, surface).toBeGreaterThan(0)
    const list = await rows(ui)
    expect(list.filter(r => /JSON/i.test(r)).length, `${surface}: one line`).toBeLessThanOrEqual(1)
    expect(at(list, /^Terms\b/), surface).toBe(-1)
    await ui.unmount()
  }
})

// ---- the real file ----

for (const surface of SURFACES) {
  test(`[3][4][5][6] on the ${surface}, a trimmed copy of the real focus.json draws its figures, terms, weeks and topics`, async ($, on) => {
    const world = await opened($, on, REAL)
    const ui = await show($, world, surface)
    const list = await rows(ui)
    const text = list.join('\n')
    expect(text).toMatch(figure(1947, 'prompts?'))
    expect(text).toMatch(figure(3, 'terms?'))
    expect(text).toMatch(figure(2, 'topics?'))
    // Terms by count, the stem `merg` shown as `merge`.
    expect(shownOn(list, ['start', 'build', 'merge'])).toEqual([0, 1, 2])
    expect(near(list, at(list, word('start')), 3)).toMatch(word('226'))
    expect(at(list, word('merg'))).toBe(-1)
    // By week: the newest, 10-12, unfolds to zen, syns, compression.
    await press(ui, world, 'toggle-weeks')
    expect(shownOn(await rows(ui), ['2026-10-12', '2026-10-05'].map(date))).toEqual([0, 1])
    await press(ui, world, (await toggleKey(ui, ['2026-10-12', '10-12']))!)
    expect(await all(ui)).toMatch(word('compression'))
    expect(await all(ui)).not.toMatch(word('meridians'))
    // Topics: vitruvian (24%) then training (14%), with their lifespans.
    await press(ui, world, 'toggle-topics')
    const topics = await rows(ui)
    expect(shownOn(topics, ['vitruvian', 'training'])).toEqual([0, 1])
    // Its first and last are the same day: that one date.
    expect(near(topics, at(topics, word('vitruvian')))).toMatch(/^09-07$/m)
    expect(near(topics, at(topics, word('vitruvian')))).toMatch(/(?<![\d.])24(\.3)?\s*%/)
    expect(near(topics, at(topics, word('training')))).toMatch(/09-07 → 10-12/)
    expect((await errors(ui)).map(t => t.text)).toEqual([])
    await ui.unmount()
  })
}
