import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BLANK, TEXT_ROLES } from '../../kit/ui'
import { C, GRAY } from '../../kit/tokens'

// The dashboard's Issues tab drawn by the engine's test kit on each surface.
// The test's own hooks sit beneath the dashboard and stand for the engine:
// `process.run` answers `gh` with two open issues (as GitHub's JSON has them),
// so no real gh runs, and `/issues` opens the pane on the tab and reads them
// into the dashboard's state.
const NOW = Date.UTC(2026, 9, 11, 12)
const HOUR = 3_600_000
const URL = 'https://github.com/satoramoto/awesome-claude/issues'

const GH_ISSUES = [
  {
    number: 24,
    title: 'Snapshot tests of what mods draw',
    url: `${URL}/24`,
    author: { login: 'satoramoto' },
    labels: [
      { name: 'tests', color: '0e8a16' },
      { name: 'terminal', color: '1d76db' },
    ],
    assignees: [],
    comments: [{}, {}, {}],
    updatedAt: new Date(NOW - 2 * HOUR).toISOString(),
    closedByPullRequestsReferences: [{ number: 31, url: 'https://github.com/satoramoto/awesome-claude/pull/31' }],
  },
  {
    number: 23,
    title: 'Fold arrow is clipped in the desktop pane',
    url: `${URL}/23`,
    author: { login: 'satoramoto' },
    labels: [{ name: 'refined', color: '0e8a16' }],
    assignees: [{ login: 'satoramoto' }],
    comments: [],
    updatedAt: new Date(NOW - 5 * HOUR).toISOString(),
  },
]

/** What `gh pr list` answers: the PR linked to close #24, its one check failing. */
const GH_PRS = [
  {
    number: 31,
    title: 'Snapshot tests for the overview pane',
    url: 'https://github.com/satoramoto/awesome-claude/pull/31',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ conclusion: 'FAILURE' }],
  },
]

/** The dashboard: the plugin, and the pane the Issues tab draws in. */
const PLUGIN = 'syns-dashboard'
const PANE = {
  component: 'Pane',
  requestId: PLUGIN,
  props: { title: 'syn', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** What `gh issue list` answers: GH_ISSUES by default. */
type Gh = { exitCode: number; stdout: string; stderr: string }

/**
 * The engine beneath the mod: a clock that holds still, and gh answering
 * `issue list` with `issues` (GH_ISSUES by default) and `repo view` with the
 * repository. `issues` may be a function, asked on each read (a later read
 * answering differently, or one held open). Returns the panes the mod opened,
 * as `{ id, title }`, with the clock as `clock`, the prompts the mod handed
 * the session as `prompts`, and how many times it read `gh issue list` as `reads()`.
 */
const engine = (on: On, issues: Gh | (() => Gh | Promise<Gh>) = { exitCode: 0, stdout: JSON.stringify(GH_ISSUES), stderr: '' }) => {
  const opened: { id: string; title?: string }[] = []
  const prompts: string[] = []
  let reads = 0
  const clock = mock.clock(on, { now: NOW })
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  // A call on `$` (an op) is answered with `{ value }`; an event like command.run with its result.
  on('session.cwd', async () => ({ value: '/repo' }))
  on('ui.open', async (_$, e) => {
    opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true } }
  })
  on('command.run', async () => ({ text: '' }))
  // The ring lands wherever it's sent.
  on('ui.focus', async () => ({}))
  on('process.run', async (_$, e) => ({
    value: {
      ...(e.argv[0] === 'gh' && e.argv[1] === 'issue' && e.argv[2] === 'list'
        ? (reads++, await (typeof issues === 'function' ? issues() : issues))
        : e.argv[0] === 'gh' && e.argv[1] === 'repo' && e.argv[2] === 'view'
          ? { exitCode: 0, stdout: 'satoramoto/awesome-claude\n', stderr: '' }
          : e.argv[0] === 'gh' && e.argv[1] === 'pr' && e.argv[2] === 'list'
            ? { exitCode: 0, stdout: JSON.stringify(GH_PRS), stderr: '' }
            : { exitCode: 1, stdout: '', stderr: 'not answered in this test' }),
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  return Object.assign(opened, { clock, prompts, reads: () => reads })
}

/** `/issues` as the person types it; it settles once gh was read into state. */
const open = ($: Engine) =>
  $.command.run({ command: 'issues', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

/** A first read held open: `/issues` draws the tab while gh runs; `done()` answers it and settles the command. */
const holdFirstRead = async ($: Engine, on: On) => {
  let answer: ((gh: Gh) => void) | null = null
  const { clock } = engine(on, () => new Promise<Gh>(resolve => (answer = resolve)))
  const command = open($)
  await clock.settle()
  return async () => {
    answer?.({ exitCode: 0, stdout: '[]', stderr: '' })
    await command
  }
}

test('the tab reads no gh until it is shown, then reads on its first draw', async ($, on) => {
  const { clock, reads } = engine(on)

  // The pane on its Overview tab, minutes passing: the Issues tab reads nothing.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 60 } })
  await clock.set(NOW + 10 * 60_000)
  await clock.settle()
  expect(reads()).toBe(0)

  // The person picks the Issues tab in the tab row: its first draw reads gh.
  await ui.press({ key: 'tabs-issues' })
  await ui.redraw()
  await clock.settle()
  expect(reads()).toBe(1)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Fold arrow is clipped in the desktop pane' })).toBeDefined()
  await ui.unmount()
})

test('/issues opens the dashboard on its Issues tab, listing the open issues, on the terminal and the desktop', async ($, on) => {
  const opened = engine(on)
  await open($)
  expect([...opened]).toEqual([{ id: PLUGIN, title: 'syn' }])

  // The terminal titles its section with the repository's name alone; the desktop's head line has it whole.
  for (const [surface, repo] of [
    ['terminal', 'awesome-claude'],
    ['desktop', 'satoramoto/awesome-claude'],
  ] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: repo })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Fold arrow is clipped in the desktop pane' })).toBeDefined()
    await ui.unmount()
  }
})

/** The pane on the terminal, `columns` wide; `isFocused` when it has the keyboard. */
const terminal = ($: Engine, columns = 60, isFocused = false) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: columns, isFocused } })

test('on the terminal, a section titled with the repository, the open count after it, an item per issue', async ($, on) => {
  engine(on)
  await open($)

  const ui = await terminal($)
  expect(await ui.find({ key: 'section-issues' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^awesome-claude$/ }))?.props.bold).toBe(true)
  // The open count is the one figure: bold, in the default foreground. The rows' ages say what
  // changed today, so the header doesn't count it again.
  const open2 = await ui.find({ type: 'Text', text: /^2$/ })
  expect(open2?.props.bold).toBe(true)
  expect(open2?.props.color).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^2 open$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /today/ })).toBeUndefined()
  // Each issue: the open-issue mark dim (every issue here is open), its title, its number and its age on the right.
  expect(await ui.findAll({ type: 'Text', text: /^◉$/ })).toHaveLength(2)
  expect((await ui.find({ type: 'Text', text: /^◉$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^◉$/ }))?.props.color).toBeUndefined()
  expect(await ui.find({ key: 'row-24' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Snapshot tests of what mods draw$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^#24$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2h$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
  await ui.unmount()
})

test('on the terminal, an issue shows its first label as a pill while it fits, the rest as a count', async ($, on) => {
  engine(on)
  await open($)

  const wide = await terminal($, 60)
  // The label's colour (GitHub's hex) only tints its one-cell swatch; the name is the default foreground.
  const pill = await wide.find({ type: 'Text', text: /^■ tests$/ })
  expect(pill).toBeDefined()
  expect(pill?.props.color).toBeUndefined()
  expect((await wide.find({ type: 'Text', text: /^■$/ }))?.props.color).toBe('#0e8a16')
  // The second label isn't a pill of its own: a dim `+1` says it's there.
  expect(await wide.find({ type: 'Text', text: /terminal/ })).toBeUndefined()
  expect((await wide.find({ type: 'Text', text: /^\+1$/ }))?.props.dimColor).toBe(true)
  await wide.unmount()

  // At 38 columns the pill's whole width (its swatch too) would take the title's room: it's left out.
  const tight = await terminal($, 38)
  expect(await tight.find({ type: 'Text', text: /^■$/ })).toBeUndefined()
  expect(await tight.find({ type: 'Text', text: /^#24$/ })).toBeDefined()
  expect(await tight.find({ type: 'Text', text: /^2h$/ })).toBeDefined()
  await tight.unmount()

  // At 30 columns the title keeps its room and the label is left out; the number and age stay.
  const narrow = await terminal($, 30)
  expect(await narrow.find({ type: 'Text', text: /tests$/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /^#24$/ })).toBeDefined()
  await narrow.unmount()
})

test('on the terminal, a linked PR is a dim tree row with its checks in their colour, and its issue a block', async ($, on) => {
  engine(on)
  await open($)

  const ui = await terminal($, 60)
  expect(await ui.find({ key: 'pr-24-31' })).toBeDefined()
  // Its number dim (the issue above is what's read), its title dim after it, its failing check amber.
  expect((await ui.find({ type: 'Text', text: /^#31$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^ {2}Snapshot tests for the overview pane$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^1 failing$/ }))?.props.color).toBe('warning')
  // #24 has a PR under it: a blank row parts it from #23, the issue after; the first issue has none above.
  expect((await ui.find({ key: 'issue-24' }))?.props.marginTop).toBe(0)
  expect((await ui.find({ key: 'issue-23' }))?.props.marginTop).toBe(1)
  await ui.unmount()
})

test('on the terminal, reading is a dim note under the section', async ($, on) => {
  const done = await holdFirstRead($, on)
  const ui = await terminal($)
  expect((await ui.find({ type: 'Text', text: /^Reading issues…$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
  await done()
})

test('on the terminal, no open issues is a dim note under the repository', async ($, on) => {
  engine(on, { exitCode: 0, stdout: '[]', stderr: '' })
  await open($)
  const ui = await terminal($)
  expect(await ui.find({ type: 'Text', text: /^awesome-claude$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^No open issues\.$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('on the terminal, a gh failure is an error note: a red ✕ and the reason', async ($, on) => {
  engine(on, { exitCode: 1, stdout: '', stderr: 'none of the git remotes configured for this repository point to a known GitHub host' })
  await open($)
  const ui = await terminal($)
  expect((await ui.find({ type: 'Text', text: /^✕$/ }))?.props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: /^No GitHub repository for this session$/ })).toBeDefined()
  await ui.unmount()
})

test('on the desktop, Refine shows only on an unrefined issue, Start on every one', async ($, on) => {
  engine(on)
  await open($)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'refine-24' })).toBeDefined()
  expect(await ui.find({ key: 'refine-23' })).toBeUndefined()
  expect(await ui.findAll({ type: 'Button', text: 'Start' })).toHaveLength(2)
  await ui.unmount()
})

/**
 * What the desktop would drop from a Button: it draws the label alone, never the
 * children, so a child element (a grey or coloured Text, an icon) never shows.
 */
const dropped = (b: { children: unknown[] }) => b.children.filter(c => typeof c === 'object' && c !== null)

test('on the desktop, every Button is drawn by its label: quiet ones dim, Selected blue under a blank Button, no outlines', async ($, on) => {
  engine(on)
  await open($)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const check = async () => {
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) expect(dropped(b)).toEqual([])
    // Nothing in the pane draws an outline.
    for (const b of await ui.findAll({ type: 'Box' })) expect(b.props.borderStyle).toBeUndefined()
  }
  await check()

  // Refine and Select are secondary: their labels a grey Text (the meta role) under a
  // blank Button that still answers to the key, as the kit draws a quiet action.
  const quiet = async (key: string, word: string) => {
    const press = await ui.find({ key: `${key}-press` })
    const label = (press?.children as { type?: string; props?: Record<string, unknown> }[] | undefined)?.find(c => c?.type === 'Text')
    expect(press?.text.replaceAll(BLANK, ''), key).toBe(word)
    expect(label?.props?.color, `${key} grey`).toBe(GRAY[TEXT_ROLES.meta])
    expect((await ui.find({ type: 'Button', key }))?.props.label, `${key} blank`).toBe(BLANK.repeat(word.length))
  }
  for (const [key, word] of [['refine-24', 'Refine'], ['pick-24', 'Select'], ['pick-23', 'Select']] as const) await quiet(key, word)
  expect((await ui.find({ type: 'Button', key: 'start-24' }))?.props.dimColor).toBeFalsy()

  // Pressing Select by its key picks the issue: the word turns blue, a Text the
  // desktop draws, with a blank-labelled Button over it that still answers to the key.
  await ui.press({ key: 'pick-24' })
  await ui.redraw()
  const tint = await ui.find({ key: 'pick-24-tint' })
  expect(tint?.props.position).toBe('relative')
  expect((await ui.find({ type: 'Text', text: /^Selected$/ }))?.props.color).toBe(C.blue)
  expect((await ui.find({ type: 'Button', key: 'pick-24' }))?.props.label).toBe(BLANK.repeat('Selected'.length))
  await quiet('clear', 'Clear')
  await check()

  // Pressed again, it's put back.
  await ui.press({ key: 'pick-24' })
  await ui.redraw()
  await quiet('pick-24', 'Select')
  // Each tile still draws its icons (the issue's mark, the linked PR's) as Svgs.
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(3)
  await ui.unmount()
})

test('on the terminal, the key hints show under the list only while the pane has the keyboard', async ($, on) => {
  engine(on)
  await open($)

  const blurred = await terminal($, 60, false)
  expect(await blurred.find({ type: 'Text', text: /^↑↓$/ })).toBeUndefined()
  await blurred.unmount()

  const focused = await terminal($, 60, true)
  expect(await focused.find({ key: 'hints' })).toBeDefined()
  // A blank row above them, and they start in the rows' mark column, past the cursor's one-cell gutter.
  const keys = await focused.find({ key: 'keys' })
  expect(keys?.props.paddingLeft).toBe(1)
  expect(keys?.props.marginTop).toBe(1)
  expect(await focused.find({ type: 'Text', text: /^↑↓$/ })).toBeDefined()
  expect((await focused.find({ type: 'Text', text: /^ move$/ }))?.props.dimColor).toBe(true)
  expect(await focused.find({ type: 'Text', text: /^enter$/ })).toBeDefined()
  expect(await focused.find({ type: 'Text', text: /^ start$/ })).toBeDefined()
  await focused.unmount()
})

test('on the terminal, the row under the focus is the cursor: ▌ in the gutter, its title bold', async ($, on) => {
  engine(on)
  await open($)

  const ui = await terminal($, 60, true)
  // Each row leads with a mark the arrows walk; no row is the cursor's before the focus lands on one.
  expect(await ui.find({ type: 'Button', key: 'mark-24' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'mark-23' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▌$/ })).toBeUndefined()

  // The person's arrow lands the focus on the second row's mark.
  await $.ui.focus({ component: 'Pane', requestId: PLUGIN, plugin: PLUGIN, element: 'mark-23', origin: { kind: 'person' } })
  await ui.redraw()
  const mark = await ui.find({ type: 'Text', text: /^▌$/ })
  expect(mark?.props.color).toBe('suggestion')
  expect(mark?.props.dimColor).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /^▌$/ })).toHaveLength(1)
  expect((await ui.find({ type: 'Text', text: /^Fold arrow is clipped in the desktop pane$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Snapshot tests of what mods draw$/ }))?.props.bold).toBeFalsy()
  await ui.unmount()

  // Without the keyboard the cursor stays put, its mark dim and the title its own weight.
  const blurred = await terminal($, 60, false)
  expect((await blurred.find({ type: 'Text', text: /^▌$/ }))?.props.dimColor).toBe(true)
  expect((await blurred.find({ type: 'Text', text: /^Fold arrow is clipped in the desktop pane$/ }))?.props.bold).toBeFalsy()
  await blurred.unmount()
})

test('on the terminal, Enter on a row starts its issue: the session gets the start prompt', async ($, on) => {
  const { prompts } = engine(on)
  await open($)

  const ui = await terminal($, 60, true)
  await ui.press({ key: 'mark-23' })
  await ui.unmount()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatch(/^Start GitHub issue #23 /)
})

test('on the terminal, a first read shows the pending mark in the figure slot', async ($, on) => {
  const done = await holdFirstRead($, on)
  const ui = await terminal($)
  // The innermost Text holding it carries its colour (the line around it holds only it too).
  expect((await ui.findAll({ type: 'Text', text: /^◌$/ })).map(t => t.props.color)).toContain('suggestion')
  await ui.unmount()
  await done()
})

test('on the terminal, a refresh keeps the issues and says how old they are while gh runs', async ($, on) => {
  let hold: ((gh: Gh) => void) | null = null
  const ok = { exitCode: 0, stdout: JSON.stringify(GH_ISSUES), stderr: '' }
  const { clock } = engine(on, () => (hold ? new Promise<Gh>(resolve => (hold = resolve)) : ok))
  await open($)
  await clock.set(NOW + 3 * 60_000)

  // The second read is held open: the last-good issues stay, the header says they're 3 minutes old.
  hold = () => undefined
  const reading = open($)
  await clock.settle()
  const ui = await terminal($)
  expect(await ui.find({ type: 'Text', text: /^↻ 3m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Snapshot tests of what mods draw$/ })).toBeDefined()

  // Read: the age goes.
  hold(ok)
  hold = null
  await reading
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /↻/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^2 open$/ })).toBeDefined()
  await ui.unmount()
})

test('on the terminal, a failed refresh keeps the last-good issues with an amber ▲ and their age', async ($, on) => {
  let answer: Gh = { exitCode: 0, stdout: JSON.stringify(GH_ISSUES), stderr: '' }
  const { clock } = engine(on, () => answer)
  await open($)
  await clock.set(NOW + 5 * 60_000)
  answer = { exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com' }
  await open($)

  const ui = await terminal($)
  expect((await ui.find({ type: 'Text', text: /^▲$/ }))?.props.color).toBe('warning')
  expect(await ui.find({ type: 'Text', text: /^ 5m$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Snapshot tests of what mods draw$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✕$/ })).toBeUndefined()
  await ui.unmount()
})

type Drawn = { type?: string; key?: string; props?: Record<string, any>; children?: unknown[] }
const kidsOf = (d: Drawn) => ((d.children ?? d.props?.children ?? []) as unknown[]).flat(Infinity).filter((c): c is Drawn => !!c && typeof c === 'object')
const everyOf = (d: Drawn): Drawn[] => [d, ...kidsOf(d).flatMap(everyOf)]
const keyOf = (d: Drawn) => String(d.key ?? d.props?.key ?? '')

test('on a wide desktop pane the issues sit in columns, each tile whole and once, in order; a sidebar keeps one list', async ($, on) => {
  engine(on)
  await open($)
  const columnsAt = async (surface: 'terminal' | 'desktop', bodyColumns: number) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props: { ...PANE.props, bodyColumns } })
    const tree = (await ui.drawn()) as Drawn
    await ui.unmount()
    const cols = everyOf(tree).filter(d => d.type === 'Box' && /^issues-col-\d+$/.test(keyOf(d)))
    return {
      cols: cols.map(c => everyOf(c).map(keyOf).filter(k => /^issue-\d+$/.test(k))),
      // The repository's line stays above the columns, across the pane.
      headInColumn: cols.some(c => everyOf(c).some(d => keyOf(d) === 'repo')),
    }
  }
  expect((await columnsAt('desktop', 60)).cols).toEqual([])
  for (const width of [120, 180]) {
    // Two issues: two columns at most, whatever the width.
    const { cols, headInColumn } = await columnsAt('desktop', width)
    expect(cols).toEqual([['issue-24'], ['issue-23']])
    expect(headInColumn).toBe(false)
  }
  expect((await columnsAt('terminal', 180)).cols).toEqual([])
})

test("the footer's columns switch turns a wide pane to one list, and the setting stays in the mod's state for the next drawing", async ($, on) => {
  // What the mod writes to its `columns` state, as the host sees it.
  const writes: unknown[] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === PLUGIN && e.key === 'issuesColumns') writes.push(e.value)
    return next(e)
  })
  engine(on)
  await open($)
  const flowed = (tree: Drawn) => everyOf(tree).filter(d => d.type === 'Box' && /^issues-col-\d+$/.test(keyOf(d))).length
  const mount = () => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 120 } })
  const ui = await mount()
  expect(flowed((await ui.drawn()) as Drawn)).toBe(2)
  // The desktop draws the switch's label as a Text under a blank Button keyed `flow-toggle`
  // (its label Braille blanks, U+2800, so they trail the text).
  expect((await ui.find({ key: 'flow-toggle-press' }))?.text).toMatch(/^columns⠀*$/)
  await ui.press({ key: 'flow-toggle' })
  expect(writes).toEqual([false])
  await ui.unmount()
  // Drawn again (a reload keeps the mod's state): one list, the switch dim.
  const again = await mount()
  expect(flowed((await again.drawn()) as Drawn)).toBe(0)
  expect((await again.find({ key: 'flow-toggle-press' }))?.text).toMatch(/^single column⠀*$/)
  await again.unmount()
})
