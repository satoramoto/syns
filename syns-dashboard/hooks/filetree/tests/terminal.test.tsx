// Render tests for the terminal in the kit's terminal design system (from awesome-claude's
// filetree), drawn as the syn dashboard's Files tab: `/filetree` opens the dashboard's
// pane on Files, and the tree draws under its tab row.
import { expect, mock, test } from 'claude-code/testing'

import { TREE } from '../../../kit/tokens'

const ROOT = '/Users/k/proj'
const NOW = 1_800_000_000_000
const LONG = 'a-file-whose-name-runs-on-and-on-well-past-any-sidebar.config.ts'

type Dirs = Record<string, [string, 'file' | 'dir'][]>

/** A repository on macOS: `src/a.ts` modified (+3 −1), `notes.md` new, the branch one ahead of its upstream. */
function world(on: any, opts: { dirs?: Dirs; top?: string; status?: string; remote?: string } = {}) {
  const dirs: Dirs = opts.dirs ?? {
    [ROOT]: [['src', 'dir'], ['README.md', 'file'], ['notes.md', 'file'], [LONG, 'file']],
    [`${ROOT}/src`]: [['a.ts', 'file'], ['b.ts', 'file']],
  }
  const top = opts.top ?? ROOT
  mock.env(on, { HOME: '/Users/k', TMPDIR: '/var/folders/x/T/' })
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', () => {
    throw new Error('no file')
  })
  on('fs.list', (_$: any, e: any) => {
    const kids = dirs[e.path]
    if (!kids) throw new Error(`ENOENT ${e.path}`)
    return { value: kids.map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: NOW - 3 * 3_600_000, isLink: false })) }
  })
  on('fs.stat', (_$: any, e: any) => {
    const p: string = e.path
    const parent = p.slice(0, p.lastIndexOf('/')) || '/'
    const hit = dirs[p] ? 'dir' : dirs[parent]?.find(([n]) => n === p.slice(p.lastIndexOf('/') + 1))?.[1]
    if (!hit) throw new Error(`ENOENT ${p}`)
    return { value: { kind: hit, size: 1, mtimeMs: NOW - 3 * 3_600_000, isLink: false } }
  })
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'uname') return ok('Darwin\n')
    if (argv[0] === 'sh') return ok('missing\n')
    if (argv[0] !== 'git') return ok('')
    const verb = argv.slice(4).find(a => !a.startsWith('-'))
    if (verb === 'rev-parse' && argv.at(-1) === 'HEAD') return ok('aaaaaaa1\n')
    if (verb === 'rev-parse') return top ? ok(`\n${top}\n`) : { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    if (verb === 'status') return ok(opts.status ?? '## main...origin/main [ahead 1]\0 M src/a.ts\0?? notes.md\0')
    if (verb === 'remote' && argv.includes('get-url')) return ok(`${opts.remote ?? 'https://github.com/k/proj.git'}\n`)
    if (verb === 'diff' && argv.includes('--numstat')) return ok('3\t1\tsrc/a.ts\0')
    if (verb === 'ls-files') return ok('src/a.ts\0src/b.ts\0README.md\0notes.md\0')
    return ok('')
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  // The dashboard's own hooks: its pane shown (so its tick never hides the tree), usage, commands.
  on('ui.panes', () => ({ value: [{ id: PLUGIN, title: 'syn', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.usage', () => ({ value: { context: {} } }))
  on('command.run', () => ({ text: '' }))
  return clock
}

/** The dashboard: the plugin, and the pane its tabs draw in. */
const PLUGIN = 'syns-dashboard'
const pane = (bodyColumns: number, isFocused = false) => ({ component: 'Pane', requestId: PLUGIN, props: { title: 'syn', isFocused, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }) as const

/** `/filetree` as the person types it: the dashboard's pane on Files. */
async function files($: any, clock: any) {
  await $.command.run({ command: 'filetree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.settle()
}

async function terminal($: any, on: any, columns = 60, opts: Parameters<typeof world>[1] & { focused?: boolean } = {}) {
  const clock = world(on, opts)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await files($, clock)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns, opts.focused) })
  await clock.settle()
  return { clock, ui }
}

type Seg = { t: string; c?: string; dc?: boolean; b?: boolean; sh?: string }
type Row = { id: string; left: Seg[]; right: Seg[] }
const rowsProps = async (ui: any) => ((await ui.find({ type: 'Client', key: 'rows' })) as any).props.props as { rows: Row[]; tones: Record<string, string>; bar?: unknown }
const rowOf = async (ui: any, name: string) => (await rowsProps(ui)).rows.find(r => r.id === `${ROOT}/${name}`)!
const seg = (r: Row, t: string) => [...r.left, ...r.right].find(s => s.t === t || s.t === ` ${t}`)
const cells = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.t].length, 0)

test('terminal: nested rows hang from TREE connectors, two cells a level, under a section header with its actions', async ($, on) => {
  const { ui, clock } = await terminal($, on)
  // The header is the kit's section: the folder's name bold, the actions on the right.
  const title = (await ui.findAll({ type: 'Text', text: 'proj' })).find((t: any) => t.props.bold)
  expect(title).toBeDefined()
  for (const key of ['up', 'cwd', 'refresh', 'hidden', 'size', 'collapse']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  // Nothing selected, so nothing to clear.
  expect(await ui.find({ type: 'Button', key: 'unselect' })).toBeUndefined()
  let rows = (await rowsProps(ui)).rows
  // The top level has no connector (the kit's treePrefix at depth 0): its icons share
  // the branch and search lines' column.
  expect(rows.map(r => r.left[0]?.t)).toEqual(['', '', '', ''])
  expect(rows.every(r => r.left[0]?.dc === true)).toBe(true)
  await ui.post({ press: `${ROOT}/src` }, { in: 'rows' })
  await clock.settle()
  rows = (await rowsProps(ui)).rows
  const tree = (name: string) => rows.find(r => r.id === `${ROOT}/${name}`)?.left[0]?.t
  expect(tree('src')).toBe('')
  // A child's connector starts under its folder's icon.
  expect(tree('src/a.ts')).toBe(TREE.tee)
  expect(tree('src/b.ts')).toBe(TREE.last)
  expect(rows.filter(r => r.left[0]?.t === TREE.last)).toHaveLength(1)
  await ui.unmount()
})

test('terminal: deeper rows carry a pipe for each open level above them that has more rows', async ($, on) => {
  const dirs: Dirs = {
    [ROOT]: [['src', 'dir'], ['README.md', 'file']],
    [`${ROOT}/src`]: [['lib', 'dir'], ['main.ts', 'file']],
    [`${ROOT}/src/lib`]: [['x.ts', 'file']],
  }
  const { ui, clock } = await terminal($, on, 60, { dirs })
  for (const dir of ['src', 'src/lib']) {
    await ui.post({ press: `${ROOT}/${dir}` }, { in: 'rows' })
    await clock.settle()
  }
  const rows = (await rowsProps(ui)).rows
  const tree = (name: string) => rows.find(r => r.id === `${ROOT}/${name}`)?.left[0]?.t
  expect(tree('src/lib')).toBe(TREE.tee)
  expect(tree('src/lib/x.ts')).toBe(TREE.pipe + TREE.last)
  expect(tree('src/main.ts')).toBe(TREE.last)
  expect(tree('README.md')).toBe('')
  await ui.unmount()
})

test("terminal: a name takes its git state's colour as a theme key; the figures after it stay dim", async ($, on) => {
  const { ui, clock } = await terminal($, on)
  await ui.post({ press: `${ROOT}/src` }, { in: 'rows' })
  await clock.settle()
  const notes = await rowOf(ui, 'notes.md')
  expect(seg(notes, 'notes.md')?.c).toBe('success')
  // The letter says the state in words, dim: one colour on the row.
  expect(seg(notes, '?')).toMatchObject({ dc: true })
  expect(seg(notes, '?')?.c).toBeUndefined()
  const a = await rowOf(ui, 'src/a.ts')
  expect(seg(a, 'a.ts')?.c).toBe('warning')
  for (const t of ['M', '+3', '−1']) {
    expect(seg(a, t)?.dc).toBe(true)
    expect(seg(a, t)?.c).toBeUndefined()
  }
  const readme = await rowOf(ui, 'README.md')
  expect(seg(readme, 'README.md')?.c).toBeUndefined()
  expect(seg(readme, '3h')?.dc).toBe(true)
  // A folder's lines changed and file counts, dim like any row's figures; its name plain,
  // as its state is only its files'.
  const src = await rowOf(ui, 'src')
  expect(seg(src, 'src')?.c).toBeUndefined()
  expect(src.right.map(s => s.t).join('')).toBe(' +3 −1 M1')
  expect(src.right.every(s => s.dc === true && s.c === undefined)).toBe(true)
  // No hex anywhere in the rows: theme keys and dim only.
  expect(JSON.stringify((await rowsProps(ui)).rows)).not.toMatch(/"c":"#/)
  await ui.unmount()
})

test("terminal: the branch line keeps the repo's totals in colour and marks the upstream by its host, never its name", async ($, on) => {
  const { ui } = await terminal($, on)
  // Ahead, then the upstream's host mark (GitHub's `gh`), dim after the name; never `origin/main`.
  expect((await ui.findAll({ type: 'Text', text: /↑1 gh/ })).length).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /origin\/main/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text', text: '+3' })).some((t: any) => t.props.color === 'success')).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: '−1' })).some((t: any) => t.props.color === 'error')).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: 'M1' })).some((t: any) => t.props.color === 'warning')).toBe(true)
  await ui.unmount()
})

for (const [remote, mark] of [
  ['git@gitlab.com:k/proj.git', 'gl'],
  ['https://codeberg.org/k/proj.git', 'fj'],
  ['https://git.example.org/k/proj.git', '⇅'],
] as const) {
  test(`terminal: an upstream on ${remote} is marked ${mark}`, async ($, on) => {
    const clock = world(on, { remote })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await clock.settle()
    await files($, clock)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
    await clock.settle()
    expect((await ui.findAll({ type: 'Text', text: `↑1 ${mark}` })).length).toBeGreaterThan(0)
    await ui.unmount()
  })
}

test('terminal: a branch that tracks nothing has no upstream mark', async ($, on) => {
  const clock = world(on, { status: '## spike\0 M src/a.ts\0' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await files($, clock)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  await clock.settle()
  const all = ((await ui.findAll({ type: 'Text' })) as any[]).map(t => String(t.text ?? ''))
  expect(all).toContain('spike')
  expect(all.some(t => /^(gh|gl|fj|⇅)$/.test(t.trim()))).toBe(false)
  await ui.unmount()
})

test('terminal: a long branch name is cut once, in the middle, with the file counts and the note giving way first', async ($, on) => {
  const head = 'feature/search-results-pane'
  const clock = world(on, { status: `## ${head}...origin/dev [ahead 2]\0 M src/a.ts\0?? notes.md\0` })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await files($, clock)
  const branch = async (columns: number) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    await clock.settle()
    const all = ((await ui.findAll({ type: 'Text' })) as any[]).map(t => String(t.text ?? ''))
    await ui.unmount()
    return {
      whole: all.includes(head),
      cut: all.find(t => t.startsWith('…') && head.endsWith(t.slice(1))),
      counts: all.includes('M1'),
      note: all.some(t => /↑2 gh/.test(t)),
    }
  }
  // Wide: the whole name, its note (ahead and the upstream's host mark) and the counts.
  expect(await branch(100)).toMatchObject({ whole: true, counts: true, note: true })
  // Narrow: the counts and the note give way; the name is cut once, keeping its end.
  const narrow = await branch(30)
  expect(narrow).toMatchObject({ whole: false, counts: false, note: false })
  expect(narrow.cut).toBeDefined()
  expect([...narrow.cut!].length).toBeGreaterThan(8)
})

test("terminal: Claude's reads and writes shimmer in the kit's meanings, and a commit shows in the footer", async ($, on) => {
  const { ui, clock } = await terminal($, on)
  const { tones } = await rowsProps(ui)
  // Reads blue (live), writes amber, commits green, failures red: theme keys, never hex.
  expect(tones).toMatchObject({ purple: 'suggestion', orange: 'warning', green: 'success', red: 'error' })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/README.md` } as any)
  await clock.settle()
  expect(seg(await rowOf(ui, 'README.md'), 'README.md')?.sh).toBe('purple')
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as any)
  await clock.settle()
  const done = (await ui.findAll({ type: 'Text', text: /commit/ })).find((t: any) => /commit/.test(t.text))
  expect(done).toBeDefined()
  await ui.unmount()
})

test('terminal: an empty folder and a folder outside git say so with the kit notes', async ($, on) => {
  const { ui } = await terminal($, on, 40, { dirs: { [ROOT]: [] }, top: '' })
  expect((await ui.find({ type: 'Text', text: 'empty' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'no git repo · git status starts after git init' }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('terminal: every row fits the section body at 30, 40, 60 and 100 columns', async ($, on) => {
  const { ui, clock } = await terminal($, on)
  await ui.post({ press: `${ROOT}/src` }, { in: 'rows' })
  await clock.settle()
  await ui.unmount()
  for (const columns of [30, 40, 60, 100]) {
    const at = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(columns) })
    await clock.settle()
    const { rows, bar } = await rowsProps(at)
    // The one-cell gutter the cursor's mark sits in, the runs, and the scrollbar (a gap and its thumb).
    for (const r of rows) expect(1 + cells(r.left) + cells(r.right) + (bar ? 2 : 0)).toBeLessThanOrEqual(columns - 3)
    // The long name is cut with an ellipsis rather than pushed past the edge.
    expect(rows.find(r => r.id === `${ROOT}/${LONG}`)?.left.at(-1)?.t.endsWith('…')).toBe(columns < 100)
    await at.unmount()
  }
})

/** Where the cursor sits: the row the Client marks, its name run, and the mark it drew. */
async function cursorOf(ui: any) {
  const props = (await rowsProps(ui)) as Awaited<ReturnType<typeof rowsProps>> & { active: string; mark: string; markColor?: string; focused: boolean }
  const row = props.rows.find(r => r.id === props.active)!
  const mark = await ui.find({ type: 'Text', text: '▌', in: 'rows' })
  return { props, row, name: row.left.at(-1)!, mark }
}

test("terminal: the cursor row is the kit's selected row, ▌ in suggestion and the name bold, never a background", async ($, on) => {
  const { ui, clock } = await terminal($, on, 60, { focused: true })
  await ui.post({ key: 'down' }, { in: 'rows' })
  await clock.settle()
  const on1 = await cursorOf(ui)
  expect(on1.props.focused).toBe(true)
  expect(on1.mark?.props.color).toBe('suggestion')
  expect(on1.mark?.props.dimColor).toBeFalsy()
  expect(on1.name.b).toBe(true)
  // Only the cursor row is marked and bold.
  expect((await ui.findAll({ type: 'Text', text: '▌', in: 'rows' })).length).toBe(1)
  expect(on1.props.rows.filter(r => r.id !== on1.props.active).some(r => r.left.at(-1)?.b)).toBe(false)
  expect(JSON.stringify(await ui.drawn({ in: 'rows' }))).not.toMatch(/"backgroundColor"/)
  // A move carries the mark to the next row.
  await ui.post({ key: 'down' }, { in: 'rows' })
  await clock.settle()
  expect((await cursorOf(ui)).props.active).not.toBe(on1.props.active)
  await ui.unmount()
  // Without the keyboard: the same row, its mark dim and its name's weight plain.
  const off = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60, false) })
  await clock.settle()
  const blurred = await cursorOf(off)
  expect(blurred.props.focused).toBe(false)
  expect(blurred.mark?.props.color).toBe('suggestion')
  expect(blurred.mark?.props.dimColor).toBe(true)
  expect(blurred.name.b).toBeUndefined()
  await off.unmount()
})

test('terminal: key hints show at the foot while the pane has the keyboard, and only then', async ($, on) => {
  const { ui, clock } = await terminal($, on, 60, { focused: true })
  const hint = await ui.find({ type: 'Text', text: /^↑↓ move · ⏎ open · ←→ fold · y copy path$/ })
  expect(hint).toBeDefined()
  // At 30 columns the pairs that don't fit give way to a dim ellipsis.
  await ui.unmount()
  const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(30, true) })
  await clock.settle()
  const cut = await narrow.find({ type: 'Text', text: /^↑↓ move/ })
  expect(cut?.text).toMatch(/…$/)
  await narrow.unmount()
  const blurred = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60, false) })
  await clock.settle()
  expect(await blurred.find({ type: 'Text', text: /move/ })).toBeUndefined()
  await blurred.unmount()
})

const DEEP: Dirs = {
  [ROOT]: [['packages', 'dir']],
  [`${ROOT}/packages`]: [['web', 'dir']],
  [`${ROOT}/packages/web`]: [['src', 'dir']],
  [`${ROOT}/packages/web/src`]: [['components', 'dir']],
  [`${ROOT}/packages/web/src/components`]: [['NavigationSidebarPanel.tsx', 'file']],
}
const DEEP_FILE = `${ROOT}/packages/web/src/components/NavigationSidebarPanel.tsx`

/** Opens each folder down to the deep file and selects it. */
async function selectDeep(ui: any, clock: any) {
  for (const dir of ['packages', 'packages/web', 'packages/web/src', 'packages/web/src/components']) {
    await ui.post({ press: `${ROOT}/${dir}` }, { in: 'rows' })
    await clock.settle()
  }
  await ui.post({ press: DEEP_FILE }, { in: 'rows' })
  await clock.settle()
}

test('terminal: the selected path in the footer is cut in the middle, keeping its first folder and its name', async ($, on) => {
  const { ui, clock } = await terminal($, on, 60, { dirs: DEEP })
  await selectDeep(ui, clock)
  const foot = await ui.find({ type: 'Text', text: /^selected / })
  expect(foot?.text).toBe('selected packages/…/NavigationSidebarPanel.tsx')
  // The label dim, the path plain.
  expect(foot?.props.dimColor).toBeFalsy()
  expect((await ui.findAll({ type: 'Text', text: /^selected\s*$/ })).some((t: any) => t.props.dimColor)).toBe(true)
  await ui.unmount()
  // Wide enough, the whole path.
  const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(100) })
  await clock.settle()
  expect((await wide.find({ type: 'Text', text: /^selected / }))?.text).toBe('selected packages/web/src/components/NavigationSidebarPanel.tsx')
  // The button that clears it sits beside it, and clears it.
  await wide.press({ key: 'unselect' })
  await clock.settle()
  expect(await wide.find({ type: 'Text', text: /^selected / })).toBeUndefined()
  await wide.unmount()
})

test('terminal: the preview header cuts a long path in the middle, and its key hints show while focused', { options: { open: 'preview' } }, async ($, on) => {
  const { ui, clock } = await terminal($, on, 48, { dirs: DEEP, focused: true })
  await selectDeep(ui, clock)
  await ui.post({ press: DEEP_FILE }, { in: 'rows' })
  await clock.settle()
  const title = (await ui.findAll({ type: 'Text', text: /NavigationSidebarPanel\.tsx$/ })).find((t: any) => t.props.bold)
  // A section of its own: the path its bold title, cut in the middle to what the arrow,
  // the shortest rule and the two quiet actions leave of 48 columns.
  expect(title?.text).toBe('…/NavigationSidebarPanel.tsx')
  for (const key of ['external', 'back']) expect((await ui.find({ type: 'Button', key }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^↑↓ scroll · ← back$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /move/ })).toBeUndefined()
  await ui.unmount()
  // Wide enough, the whole path.
  const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(100, true) })
  await clock.settle()
  expect((await wide.findAll({ type: 'Text', text: 'packages/web/src/components/NavigationSidebarPanel.tsx' })).some((t: any) => t.props.bold)).toBe(true)
  await wide.unmount()
})
