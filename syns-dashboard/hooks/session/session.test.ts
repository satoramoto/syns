import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FILL } from '../../kit/tokens'
import { BAND_ROWS } from '../../kit/ui'

// The dashboard's Session tab drawn by the engine's test kit, mostly on the
// terminal. The whole dashboard plugin is loaded; the test's own hooks sit
// beneath it and stand for the engine: the session's usage (context and
// limits), git and gh answered from the fixtures below. `/overview` puts the
// pane on the Session tab and reads the usage; the tab's first draw starts its
// 3 s timer, which, moved by the mocked clock, reads git and gh.
const PLUGIN = 'syns-dashboard'
const NOW = Date.UTC(2026, 9, 11, 12)
const MIN = 60_000

// The pane draws resets against the wall clock, so they're set from it.
const WALL = Date.now()

const USAGE = {
  startedAt: NOW - 47 * MIN,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(WALL + 138 * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: 96, resetsAt: new Date(WALL + 76 * 60 * MIN).toISOString() },
  ],
  cost: { usd: 4.82 },
  context: {
    percent: 31,
    breakdown: {
      model: 'claude-opus-5-5',
      totalTokens: 61_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      percentage: 31,
      isAutoCompactEnabled: true,
      autoCompactThreshold: 167_000,
      categories: [
        { name: 'System prompt', tokens: 3_100, kind: 'used' },
        { name: 'System tools', tokens: 14_200, kind: 'used' },
        { name: 'MCP tools', tokens: 6_400, kind: 'used' },
        { name: 'Messages', tokens: 37_300, kind: 'used' },
        { name: 'Free space', tokens: 106_000, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      ],
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      gridRows: [],
      apiUsage: null,
    },
  },
}

/**
 * What the repo beneath is like, set per test: the checked-out branch (one
 * other than main is a workspace), and which reads fail (git's status, gh;
 * `usage` answers without the context breakdown).
 */
const world = { head: 'main', down: new Set<'git' | 'gh' | 'usage'>() }

const gitStatus = () => GIT_STATUS.replace('# branch.head main', `# branch.head ${world.head}`)

/** The workspace's PR, on the `lane` branch. */
const LANE_PR = {
  number: 9,
  title: 'Overview adopts the kit',
  url: 'https://github.com/satoramoto/awesome-claude/pull/9',
  state: 'OPEN',
  isDraft: false,
  reviewDecision: '',
  statusCheckRollup: [{ name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
  headRefName: 'lane',
  mergeable: 'MERGEABLE',
}

const GIT_STATUS = [
  '# branch.oid 0123456789abcdef',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -0',
  '1 .M N... 100644 100644 100644 aaa bbb mods/overview/hooks/terminal.tsx',
  '',
].join('\n')

const GH_PRS = [
  {
    number: 7,
    title: 'Terminal inspector',
    url: 'https://github.com/satoramoto/awesome-claude/pull/7',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED',
    statusCheckRollup: [{ name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
    headRefName: 'terminal',
    mergeable: 'MERGEABLE',
  },
  {
    number: 6,
    title: 'Kit renderer',
    url: 'https://github.com/satoramoto/awesome-claude/pull/6',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'tests', status: 'IN_PROGRESS', conclusion: '' }],
    headRefName: 'kit',
    mergeable: 'MERGEABLE',
  },
]

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const fail = { exitCode: 1, stdout: '', stderr: 'not answered in this test', isStdoutTruncated: false, isStderrTruncated: false }

/** git and gh as the repo above has them; anything else fails. */
const answer = (argv: readonly string[]) => {
  const cmd = argv.join(' ')
  if (cmd === 'git --no-optional-locks rev-parse --show-toplevel') return ok('/repo\n')
  if (cmd === 'git --no-optional-locks status --porcelain=v2 --branch') return world.down.has('git') ? fail : ok(gitStatus())
  if (cmd === 'git --no-optional-locks worktree list --porcelain') return ok('worktree /repo\nHEAD 0123\nbranch refs/heads/main\n')
  if (cmd === 'git --no-optional-locks diff --shortstat HEAD') return ok(' 1 file changed, 12 insertions(+), 3 deletions(-)\n')
  if (cmd === 'git rev-parse --abbrev-ref origin/HEAD') return ok('origin/main\n')
  if (cmd.startsWith('gh ') && world.down.has('gh')) return { ...fail, stderr: 'error connecting to api.github.com' }
  // On the workspace's branch, its PR is one of mine too.
  if (cmd.startsWith('gh pr list --author @me')) return ok(JSON.stringify(world.head === 'lane' ? [LANE_PR, ...GH_PRS] : GH_PRS))
  if (cmd.startsWith('gh pr list --state all')) return ok(JSON.stringify([LANE_PR]))
  // The workspace on `lane`: it exists, and its lines changed against main.
  if (cmd === 'git rev-parse --git-dir') return ok('.git\n')
  if (cmd === `git --no-optional-locks rev-parse --verify --quiet refs/heads/${world.head}`) return ok('0123\n')
  if (cmd === `git --no-optional-locks rev-parse --abbrev-ref HEAD`) return ok(`${world.head}\n`)
  if (cmd === `git --no-optional-locks diff --shortstat origin/main...${world.head}`) return ok(' 9 files changed, 1204 insertions(+), 385 deletions(-)\n')
  return fail
}

/** The engine beneath the mod; the clock it returns moves the mod's timer. Each command run is pushed to `runs`, when given. */
const engine = (on: On, runs?: string[]) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('command.run', async () => ({ text: '' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  // The dashboard's pane is on screen, so its own timer leaves the tab shown.
  on('ui.panes', async () => ({ value: [{ id: PLUGIN, title: 'syn', isShown: true, isFocused: false, isPlaced: true }] }) as never)
  on('session.usage', async () => ({ value: world.down.has('usage') ? { ...USAGE, context: { percent: 31 } } : USAGE }) as never)
  // The dashboard's Overview tab lists the agents; none here.
  on('agent.list', async () => ({ value: [] }) as never)
  on('process.run', async (_$, e) => {
    runs?.push(e.argv.join(' '))
    return { value: answer(e.argv) }
  })
  // The end of a turn, beneath the mod's hook that counts it.
  on('turn.complete', async () => ({ text: '' }))
  return clock
}

/** `/overview` as the person types it: the pane on the Session tab, the usage read. */
const overview = ($: Engine) =>
  $.command.run({ command: 'syn-overview', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

/** Opens the tab with /overview, which reads everything again on the next tick, and lets that tick run. */
const reopen = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
  await overview($)
  // One tick of the tab's timer: git, then gh.
  await clock.advance(3_000)
}

/**
 * A session that started, opened the Session tab with /overview, drew it once
 * (its first draw starts its timer), and read git and gh once.
 */
const session = async ($: Engine, on: On, head = 'main') => {
  world.head = head
  world.down.clear()
  const clock = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await overview($)
  const first = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  await first.unmount()
  await clock.advance(3_000)
  return clock
}

const pane = (columns: number) =>
  ({
    component: 'Pane',
    requestId: PLUGIN,
    props: { title: 'syn', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const

/** One main-loop turn's end, with `output` tokens out. */
const turn = ($: Engine, i: number, output = 500) =>
  $.turn.complete({ answer: '', durationMs: 20_000, isAborted: false, turnId: `t${i}`, reason: 'answer', usage: { input_tokens: 2_000, output_tokens: output, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 1_000, model: 'claude-opus-5-5' } } as never)

const WIDTHS = [30, 40, 60, 100] as const

test('the terminal lists the same sections as the desktop, in its order, each a section header', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(40) })
  const titles = (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold).map(t => t.text)
  const order = ['Context', 'Limits', 'Git', 'Accounting'].map(s => titles.indexOf(s))
  expect(order.every(i => i >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  // Each section folds by its arrow, as on the desktop.
  for (const id of ['context', 'limits', 'git', 'accounting']) expect(await ui.find({ key: `toggle-${id}` })).toBeDefined()
  // The dashboard's Overview has the agents: the tab has no section of its own for them.
  expect(await ui.find({ key: 'section-agents' })).toBeUndefined()
  await ui.unmount()
  // The desktop draws from the same data without a refusal.
  const desk = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...pane(46) })
  expect(await desk.find({ type: 'Text', text: 'Accounting' })).toBeDefined()
  await desk.unmount()
})

test('the tab reads nothing until it is shown: another tab passes the render on, and its timer starts on its first draw', async ($, on) => {
  world.head = 'main'
  world.down.clear()
  const runs: string[] = []
  const clock = engine(on, runs)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // The dashboard opens on its Overview tab: the Session tab's sections aren't drawn, and its timer isn't running.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  expect(await ui.find({ key: 'section-context' })).toBeUndefined()
  await ui.unmount()
  await clock.advance(6_000)
  expect(runs.some(r => r.startsWith('git --no-optional-locks status'))).toBe(false)
  // On its tab, its first draw starts the reads.
  await overview($)
  const tab = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  expect(await tab.find({ key: 'section-context' })).toBeDefined()
  await tab.unmount()
  await clock.advance(3_000)
  expect(runs.some(r => r.startsWith('git --no-optional-locks status'))).toBe(true)
})

/** An element description's key and children, as the drawn tree carries them. */
type Drawn = { type?: string; key?: string; props?: Record<string, any>; children?: unknown[] }
const keyOf = (d: Drawn) => d.key ?? d.props?.key
const kids = (d: Drawn) => ((d.children ?? d.props?.children ?? []) as unknown[]).flat(Infinity).filter((c): c is Drawn => !!c && typeof c === 'object')
/** Every Text under an element, depth first. */
const texts = (d: Drawn): Drawn[] => (d.type === 'Text' ? [d] : []).concat(kids(d).flatMap(texts))
const shown = (d: Drawn): string => ((d.children ?? d.props?.children ?? []) as unknown[]).flat(Infinity).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : c && typeof c === 'object' ? shown(c as Drawn) : '')).join('')

/** A section body's cells at a pane's width: the overview's measure (72), less the gutter (2) and the right margin (1). */
const bodyAt = (columns: number) => Math.min(columns, 72) - 3

test('a section header is the quiet rules look: a bold plain title, its figures on a shared column, a dim ─ rule after', async ($, on) => {
  const clock = await session($, on)
  await turn($, 0)
  await clock.settle()
  for (const columns of [40, 60]) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    // The title: bold in the default foreground; no orange, no italic anywhere in the header.
    const title = await ui.find({ type: 'Text', text: 'Activity' })
    expect(title?.props, `title at ${columns}`).toMatchObject({ bold: true, wrap: 'truncate' })
    expect(title?.props.color, `title at ${columns}`).toBeUndefined()
    // The header row: the title's column, then the figures, then the rule, then the fold arrow last.
    const section = (await ui.find({ key: 'section-activity' })) as Drawn | undefined
    const row = kids(section ?? {})[0] ?? {}
    expect(kids(row).map(keyOf), `header at ${columns}`).toEqual(['title', 'right', 'rule', 'fold'])
    const [head, right, rule, arrow] = kids(row)
    expect(arrow!.props?.flexShrink, `arrow at ${columns}`).toBe(0)
    // The figures start on the shared column: icon 2, title column 10, 2 apart.
    expect(head!.props?.width, `title column at ${columns}`).toBe(14)
    const marks = texts(head!).filter(t => shown(t) !== 'Activity')
    expect(marks.length, `icon at ${columns}`).toBeGreaterThan(0)
    expect(marks.every(t => t.props?.dimColor === true), `icon at ${columns}`).toBe(true)
    // The rule takes only the room left (it grows from no width) and is long enough to reach.
    expect(rule!.props, `rule box at ${columns}`).toMatchObject({ flexGrow: 1, width: 0, overflow: 'hidden' })
    const line = texts(rule!)[0]
    expect(line?.props?.dimColor, `rule at ${columns}`).toBe(true)
    expect(shown(line!), `rule at ${columns}`).toMatch(/^─+$/)
    // The figures: the first bold, the rest plain, units dim and never italic. Narrow, the cache share goes.
    expect(shown(right!)).toMatch(columns >= 60 ? /\d+ peak {2}\d+% cached/ : /\d+ peak/)
    const [first, second] = texts(right!).filter(t => /^\d+%?$/.test(shown(t)))
    expect(first?.props?.bold, `first figure at ${columns}`).toBe(true)
    if (columns >= 60) expect(second?.props?.bold, `second figure at ${columns}`).toBeFalsy()
    const unit = texts(right!).find(t => shown(t) === ' peak')
    expect(unit?.props?.dimColor, `unit at ${columns}`).toBe(true)
    expect(texts(row).some(t => t.props?.italic), `italic at ${columns}`).toBe(false)
    await ui.unmount()
  }
})

test('the context bar is one row across the section body: the parts as ━, the free room and the amber buffer as ─', async ($, on) => {
  await session($, on)
  for (const columns of WIDTHS.filter(c => c >= 30)) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    const meter = ((await ui.find({ key: 'meter' })) ?? {}) as Drawn
    const runs = texts(meter).filter(t => !kids(t).length && /^[━╸─]+$/.test(shown(t)))
    expect(runs.map(shown).join('').length, `at ${columns}`).toBe(bodyAt(columns))
    // No dithered, shaded or block cells; no scale or axis rows under it.
    expect(texts(meter).map(shown).join(''), `at ${columns}`).not.toMatch(/[█▓░▒╵▴]/)
    expect(runs.at(-1)?.props?.color, `buffer at ${columns}`).toBe('warning')
    expect(await sectionText(ui, 'context'), `at ${columns}`).not.toMatch(/[╵▴]|500k/)
    for (const label of ['System', 'MCP', 'Messages', 'Free', 'Buffer']) expect(await ui.find({ type: 'Text', text: label })).toBeDefined()
    await ui.unmount()
  }
})

test('Limits says its fullest window in the header only while folded: open, the readings say it', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  expect((await sectionText(ui, 'limits')).match(/96%/g)?.length).toBe(1)
  await ui.press({ key: 'toggle-limits' })
  expect(await sectionText(ui, 'limits')).toMatch(/96% weekly/)
  expect(await ui.find({ type: 'Text', text: '5-hour' })).toBeUndefined()
  await ui.unmount()
})

test('a PR shows once: Workspaces lists its branch, Git leaves it out; its actions sit beside the branch', async ($, on) => {
  await session($, on, 'lane')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  expect(await sectionText(ui, 'workspaces')).toMatch(/Overview adopts the kit/)
  expect(await sectionText(ui, 'git')).not.toMatch(/Overview adopts the kit/)
  expect(await sectionText(ui, 'git')).toMatch(/Terminal inspector/)
  // The branch row: the branch, its number, then its actions right after, nothing on the far edge.
  const head = ((await ui.find({ key: 'branch-lane-head' })) ?? {}) as Drawn
  expect(kids(head).length).toBe(1)
  expect(JSON.stringify(kids(head)[0])).toContain('branch-lane-actions')
  await ui.unmount()
})

test('limits are readings: label, gauge, percent and reset, red from 90%', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(40) })
  expect(await ui.find({ type: 'Text', text: '5-hour' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2h18m' })).toBeDefined()
  const weekly = (await ui.findAll({ type: 'Text', text: /^━+╸?$/ })).map(t => t.props.color)
  expect(weekly).toContain('error')
  await ui.unmount()
})

test('git lists the checkout and its pull requests as rows with a status', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  expect(await ui.find({ type: 'Text', text: 'main' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /terminal\.tsx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Terminal inspector' })).toBeDefined()
  // The number sits on the right as meta, the part that goes first when the row is narrow.
  expect((await ui.find({ type: 'Text', text: '#7' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: '#7' }))?.props.italic).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: '✕ 1 failing' }))?.props.color).toBe('error')
  // A pending check is blue, as running is.
  expect((await ui.find({ type: 'Text', text: '◌ 1 pending' }))?.props.color).toBe('suggestion')
  expect(await ui.find({ type: 'Text', text: /review required/ })).toBeDefined()
  await ui.unmount()
})

test('the terminal draws only the kit glyphs: no ✗ ⚑ ⑂ ⟳ ● marks', async ($, on) => {
  await session($, on)
  for (const columns of WIDTHS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    for (const glyph of ['✗', '⚑', '⑂', '⟳', '●']) expect(texts.includes(glyph)).toBe(false)
    // Nothing with an emoji presentation, which some terminals draw two cells wide.
    expect(texts).not.toMatch(/(?![#*0-9$])\p{Emoji}/u)
    await ui.unmount()
  }
})

test("a header's figures are one line that ends in an ellipsis when cut, not a figure clipped mid-word", async ($, on) => {
  const clock = await session($, on)
  await turn($, 0)
  await clock.settle()
  for (const columns of WIDTHS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    expect((await ui.find({ type: 'Text', text: /^\d+ peak( {2}\d+% cached)?$/ }))?.props, `activity at ${columns}`).toMatchObject({ wrap: 'truncate' })
    await ui.unmount()
  }
})

/** The Texts a section draws, header and body. */
const sectionTexts = async (ui: { find: (q: { key: string }) => Promise<unknown> }, id: string) => texts(((await ui.find({ key: `section-${id}` })) ?? {}) as Drawn)
/** One section's drawn text, run together. */
const sectionText = async (ui: { find: (q: { key: string }) => Promise<unknown> }, id: string) => shown(((await ui.find({ key: `section-${id}` })) ?? {}) as Drawn)

test("before the first reads, Context and Git hold their figures' place with the pending ◌", async ($, on) => {
  world.head = 'main'
  world.down.clear()
  // The usage answers without its breakdown, so /overview puts the pane on the tab with no context yet.
  world.down.add('usage')
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await overview($)
  // Drawn before the clock moves: the tab's timer hasn't read git yet.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(40) })
  for (const id of ['context', 'git']) {
    const pending = (await sectionTexts(ui, id)).filter(t => shown(t) === '◌').map(t => t.props?.color)
    expect(pending, id).toContain('suggestion')
  }
  // No hand-written word stands in for the figures.
  expect(await ui.find({ type: 'Text', text: /measuring/ })).toBeUndefined()
  expect(await sectionText(ui, 'git')).toMatch(/Reading git…/)
  expect(await sectionText(ui, 'context')).toMatch(/Reading context…/)
  await ui.unmount()
})

test("the context legend keys the bar with its own glyphs, ━ for the parts and ─ for the room, each label close to its figure", async ($, on) => {
  await session($, on)
  for (const columns of [40, 60, 100]) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    const legend = ((await ui.find({ key: 'ctx' })) ?? {}) as Drawn
    const keys = texts(legend).map(shown).filter(t => /^[━─■█▓]$/.test(t))
    // The bar's parts (System, MCP, Messages), then Free and Buffer.
    expect(keys, `at ${columns}`).toEqual(['━', '━', '━', '─', '─'])
    // Each entry is as wide as its label and figure need, not a share of the pane: 2 + 8 + 1 + 5.
    const rows = kids(legend)
    const cells = rows.flatMap(kids)
    expect(cells.every(c => c.props?.width === 16), `at ${columns}`).toBe(true)
    // Row by row, as many columns as fit: two at 40, three from 60.
    expect(kids(rows[0]!).length, `at ${columns}`).toBe(columns < 60 ? 2 : 3)
    await ui.unmount()
  }
})

test('the tokens each turn added are a Braille sparkline on the Tokens row, from 4 turns', async ($, on) => {
  const clock = await session($, on)
  const usage = (output: number) => ({ input_tokens: 2_000, output_tokens: output, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 1_000, model: 'claude-opus-5-5' })
  const tokensRow = async (columns: number) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    const row = shown(((await ui.find({ key: 'turn-tokens' })) ?? {}) as Drawn)
    const section = await sectionText(ui, 'accounting')
    await ui.unmount()
    return { row, section }
  }
  for (const [i, output] of [800, 4_000, 1_500, 12_000].entries()) {
    await $.turn.complete({ answer: '', durationMs: 20_000, isAborted: false, turnId: `t${i}`, reason: 'answer', usage: usage(output) } as never)
    await clock.settle()
    if (i === 2) {
      // Three turns: too little to read a shape from, so no spark anywhere.
      const { section } = await tokensRow(40)
      expect(section).not.toMatch(/[⠁-⣿]/)
    }
  }
  for (const columns of [40, 60]) {
    const { row, section } = await tokensRow(columns)
    // The last turn's tokens (input, output and cache writes), then the spark on the same row,
    // newest on the right; no spark rows of its own.
    expect(row, `at ${columns}`).toMatch(/15k last turn\s*[⠀-⣿]*[⠁-⣿]$/)
    expect(section.replace(row, ''), `at ${columns}`).not.toMatch(/[⠁-⣿]/)
  }
})

test('narrow, Activity drops its cache share before its header is cut', async ($, on) => {
  const clock = await session($, on)
  await turn($, 0)
  await clock.settle()
  for (const [columns, cached] of [[40, false], [70, true]] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    expect(/cached/.test(await sectionText(ui, 'activity')), `at ${columns}`).toBe(cached)
    await ui.unmount()
  }
})

test('a git refresh that fails keeps the last-good figures, with an amber ▲ and their age in the header', async ($, on) => {
  const clock = await session($, on)
  world.down.add('git')
  await reopen($, clock)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  const head = (await sectionTexts(ui, 'git')).map(t => [shown(t), t.props?.color] as const)
  expect(head.find(([t]) => t === '▲')?.[1]).toBe('warning')
  expect(head.some(([t]) => /^ \d+[smhd]$/.test(t))).toBe(true)
  // The body is the last-good checkout, not an error.
  expect(await ui.find({ type: 'Text', text: 'main' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑2' })).toBeDefined()
  expect(await sectionText(ui, 'git')).not.toMatch(/git status failed|not answered/)
  await ui.unmount()

  // The next good read clears the mark.
  world.down.delete('git')
  await reopen($, clock)
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  expect((await sectionTexts(again, 'git')).some(t => shown(t) === '▲')).toBe(false)
  await again.unmount()
})

test('a gh refresh that fails keeps the last pull requests, in Git and in Workspaces, marked ▲', async ($, on) => {
  const clock = await session($, on, 'lane')
  world.down.add('gh')
  await reopen($, clock)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  for (const id of ['git', 'workspaces']) {
    expect((await sectionTexts(ui, id)).find(t => shown(t) === '▲')?.props?.color, id).toBe('warning')
  }
  expect(await ui.find({ type: 'Text', text: 'Terminal inspector' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Overview adopts the kit' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /error connecting/ })).toBeUndefined()
  await ui.unmount()
})

test("a workspace's PR row drops its lines changed before CI when the row runs out of room", async ($, on) => {
  await session($, on, 'lane')
  const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  const row = async (ui: typeof wide) => shown(((await ui.find({ key: 'branch-lane-pr' })) ?? {}) as Drawn)
  // Its lines against main, the checkout's uncommitted ones included.
  expect(await row(wide)).toMatch(/\+1216 −388/)
  expect(await row(wide)).toMatch(/✕ 1 failing/)
  await wide.unmount()
  const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(30) })
  expect(await row(narrow)).not.toMatch(/\+1216/)
  expect(await row(narrow)).toMatch(/✕ 1 failing/)
  await narrow.unmount()
})

test('below 30 columns each section draws its header and figures only', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(28) })
  for (const title of ['Context', 'Limits', 'Git', 'Accounting']) expect(await ui.find({ type: 'Text', text: title }), title).toBeDefined()
  // The figures say what matters on their own: the fullest limit window is in its header.
  expect(await sectionText(ui, 'limits')).toMatch(/96% weekly/)
  expect(await sectionText(ui, 'context')).toMatch(/31% of 200k/)
  // No bodies: no bar, no readings, no rows.
  expect(await ui.find({ key: 'meter' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '5-hour' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Model' })).toBeUndefined()
  await ui.unmount()
})

test('the desktop draws the inspector without outlines: every section header a fixed-height fill, no border anywhere, hide a dim label', async ($, on) => {
  const clock = await session($, on, 'lane')
  // One turn, so Activity draws too: five sections.
  await turn($, 0)
  await clock.settle()
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...pane(60) })
  const tree = (await ui.drawn()) as Drawn
  const every = (d: Drawn): Drawn[] => [d, ...kids(d).flatMap(every)]
  const boxes = every(tree).filter(d => d.type === 'Box')
  // The real desktop draws a `transparent` border in the text's colour: headers and tiles came out as outlined bubbles.
  expect(boxes.filter(b => b.props?.borderStyle !== undefined)).toEqual([])
  // A header is a card: a container over an absolute ground (rounded edges round a fill).
  const cardFill = (b: Drawn) => {
    const ground = kids(b).find(d => keyOf(d) === 'card-ground')
    return ground && kids(ground).find(d => keyOf(d) === 'card-fill')?.props?.backgroundColor
  }
  const bands = boxes.filter(b => cardFill(b) === FILL.head)
  expect(bands.length).toBeGreaterThanOrEqual(5)
  for (const b of bands) {
    expect(b.props?.height).toBe(BAND_ROWS)
    expect(b.props?.paddingY).toBeUndefined()
  }
  // The desktop draws a Button's label alone: hide is a dim label, no grey child Text.
  const hide = every(tree).find(d => d.type === 'Button' && String(keyOf(d)).startsWith('hide-'))
  expect(hide?.props).toMatchObject({ label: 'hide', dimColor: true })
  expect(kids(hide!)).toEqual([])
  await ui.unmount()
})

/** The flow columns a drawn tree has (keys `<flow>-col-<n>`), each with the section ids in it, in order. */
const flowed = (tree: Drawn, flow = 'sections') => {
  const every = (d: Drawn): Drawn[] => [d, ...kids(d).flatMap(every)]
  const ids = (d: Drawn) =>
    every(d)
      .map(x => String(keyOf(x) ?? ''))
      .filter(k => k.startsWith('section-'))
      .map(k => k.slice('section-'.length))
  return every(tree)
    .filter(d => d.type === 'Box' && new RegExp(`^${flow}-col-\\d+$`).test(String(keyOf(d))))
    .map(ids)
}

test('a wide desktop pane lays the sections out in columns, each section once in reading order; a sidebar and the terminal keep one stack', async ($, on) => {
  const clock = await session($, on, 'lane')
  await turn($, 0)
  await clock.settle()
  const draw = async (surface: 'terminal' | 'desktop', columns: number) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...pane(columns) })
    const tree = (await ui.drawn()) as Drawn
    await ui.unmount()
    return tree
  }
  const every = (d: Drawn): Drawn[] => [d, ...kids(d).flatMap(every)]
  const order = (tree: Drawn) => every(tree).map(x => String(keyOf(x) ?? '')).filter(k => k.startsWith('section-')).map(k => k.slice('section-'.length))

  // A sidebar's width: one stack, as before.
  const narrow = await draw('desktop', 60)
  expect(flowed(narrow)).toEqual([])
  const stack = order(narrow)
  // (One turn in this session, so Activity draws.)
  expect(stack).toEqual(['context', 'limits', 'activity', 'workspaces', 'accounting'])

  // Expanded: two columns, then three, splitting between sections and keeping their order.
  for (const [columns, n] of [[120, 2], [180, 3]] as const) {
    const cols = flowed(await draw('desktop', columns))
    expect(cols.length, `${columns} columns`).toBe(n)
    for (const col of cols) expect(col.length).toBeGreaterThan(0)
    expect(cols.flat()).toEqual(stack)
  }

  // The terminal never splits.
  expect(flowed(await draw('terminal', 180))).toEqual([])
})

test("the footer's columns switch turns a wide pane to one stack, and the setting stays in the mod's state for the next drawing", async ($, on) => {
  // What the tab writes to its `sessionColumns` state, as the host sees it.
  const writes: unknown[] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === PLUGIN && e.key === 'sessionColumns') writes.push(e.value)
    return next(e)
  })
  await session($, on, 'lane')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...pane(120) })
  expect(flowed((await ui.drawn()) as Drawn).length).toBe(2)
  // The desktop draws the switch's label as a Text under a blank Button keyed `flow-toggle`
  // (its label Braille blanks, U+2800, so they trail the text).
  expect((await ui.find({ key: 'flow-toggle-press' }))?.text).toMatch(/^columns⠀*$/)
  await ui.press({ key: 'flow-toggle' })
  expect(writes).toEqual([false])
  await ui.unmount()
  // Drawn again (a reload keeps the mod's state): one stack, the switch dim.
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...pane(120) })
  expect(flowed((await again.drawn()) as Drawn)).toEqual([])
  expect((await again.find({ key: 'flow-toggle-press' }))?.text).toMatch(/^single column⠀*$/)
  await again.unmount()
})
