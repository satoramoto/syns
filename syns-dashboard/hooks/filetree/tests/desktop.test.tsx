// Render and behaviour tests for the desktop version (desktop.tsx; from awesome-claude's
// filetree), drawn as the syn dashboard's Files tab: `/filetree` opens the dashboard's
// pane on Files, and the tree draws under its tab row.
import { expect, mock, test } from 'claude-code/testing'

import { C, FILE_TYPE, GRAY, TRACK } from '../../../kit/tokens'

const ROOT = '/Users/k/proj'
const NOW = 1_800_000_000_000

type Dirs = Record<string, [string, 'file' | 'dir'][]>

/** A repository on macOS: `src/a.ts` modified (+3 −1), `notes.md` new, the branch one ahead of its upstream. */
function world(on: any, opts: { dirs?: Dirs; heads?: string[]; status?: string; remote?: string } = {}) {
  const ran: string[][] = []
  const scrolls: unknown[] = []
  const dirs: Dirs = opts.dirs ?? {
    [ROOT]: [['src', 'dir'], ['README.md', 'file'], ['notes.md', 'file']],
    [`${ROOT}/src`]: [['a.ts', 'file'], ['b.ts', 'file']],
  }
  const heads = opts.heads ?? ['aaaaaaa1']
  mock.env(on, { HOME: '/Users/k', TMPDIR: '/var/folders/x/T/' })
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_$: any, e: any) => (ran.push(['toast', String(e.text)]), { value: undefined }))
  on('ui.scroll', (_$: any, e: any) => (scrolls.push(e), {}))
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
    ran.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'uname') return ok('Darwin\n')
    if (argv[0] === 'sh') return ok('missing\n')
    if (argv[0] !== 'git') return ok('')
    const verb = argv.slice(4).find(a => !a.startsWith('-'))
    if (verb === 'rev-parse' && argv.at(-1) === 'HEAD') return ok(`${(heads.length > 1 ? heads.shift() : heads[0]) ?? ''}\n`)
    if (verb === 'rev-parse') return ok(`\n${ROOT}\n`)
    if (verb === 'status') return ok(opts.status ?? '## main...origin/main [ahead 1]\0 M src/a.ts\0?? notes.md\0')
    if (verb === 'remote' && argv.includes('get-url')) return ok(`${opts.remote ?? 'git@github.com:k/proj.git'}\n`)
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
  return { clock, ran, scrolls }
}

/** The dashboard: the plugin, and the pane its tabs draw in. */
const PLUGIN = 'syns-dashboard'
const pane = (bodyColumns: number) => ({ component: 'Pane', requestId: PLUGIN, props: { title: 'syn', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }) as const

async function desktop($: any, on: any, columns = 46, opts: Parameters<typeof world>[1] = {}) {
  const w = world(on, opts)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.settle()
  // `/filetree` as the person types it: the dashboard's pane on Files.
  await $.command.run({ command: 'filetree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...pane(columns) })
  await w.clock.settle()
  return { ...w, ui }
}

/** The Text that shows exactly `text`. */
const textOf = async (ui: any, text: string) => (await ui.findAll({ type: 'Text', text })).find((t: any) => t.text === text)

test('desktop: rows are drawn by the hook with Octicons, git colours and lines changed; the terminal keeps its rows Client', async ($, on) => {
  const { ui, clock } = await desktop($, on)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  // Folders and files each with their Octicon, drawn as SVG.
  const svgs = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(svgs).toContain('M1.75 1A1.75') // folder
  expect(svgs).toContain('M2 1.75C2') // file (README.md)
  // Each row's name is a Button keyed by its path.
  for (const name of ['src', 'README.md', 'notes.md']) expect(await ui.find({ type: 'Button', key: `${ROOT}/${name}` })).toBeDefined()
  // A new file is lettered ? in green (its name is the Button's plain label: the desktop
  // draws no children), the root's lines changed green and red, the date in a grey.
  expect((await ui.find({ type: 'Button', key: `${ROOT}/notes.md` }))?.props.label).toBe('notes.md')
  expect((await ui.findAll({ type: 'Text', text: '?' })).some((t: any) => t.text === '?' && t.props.color === C.ok)).toBe(true)
  expect((await textOf(ui, '+3'))?.props.color).toBe(C.ok)
  expect((await textOf(ui, '−1'))?.props.color).toBe(C.bad)
  expect((await textOf(ui, '3h'))?.props.color).toBe(GRAY.mid)
  // The branch line: its name, one ahead; the upstream is an icon, not its name in text.
  expect(await textOf(ui, 'main')).toBeDefined()
  expect(await textOf(ui, ' ↑1')).toBeDefined()
  expect(await textOf(ui, 'origin/main')).toBeUndefined()
  await ui.unmount()
  const term = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...pane(60) })
  await clock.settle()
  expect(await term.find({ type: 'Client', key: 'rows' })).toBeDefined()
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
})

test('desktop: a press selects and highlights a row, opens a folder, twice opens a file, and the footer opens the selection', async ($, on) => {
  const { ui, clock, ran } = await desktop($, on)
  await ui.press({ key: `${ROOT}/src` })
  await clock.settle()
  expect(await ui.find({ type: 'Button', key: `${ROOT}/src/a.ts` })).toBeDefined()
  // The open folder's icon, and a source file's.
  const svgs = JSON.stringify(await ui.findAll({ type: 'Svg' }))
  expect(svgs).toContain('M.513 1.513') // folder-open
  expect(svgs).toContain('M4 1.75C4') // file-code
  await ui.press({ key: `${ROOT}/src/b.ts` })
  await clock.settle()
  const row = await ui.find({ type: 'Box', key: `row-${ROOT}/src/b.ts` })
  expect(row?.props.backgroundColor).toBe(TRACK)
  expect((await textOf(ui, 'src/b.ts'))?.props.color).toBe(GRAY.mid)
  expect(ran.some(a => a[0] === 'open')).toBe(false)
  await ui.press({ key: 'open' })
  await clock.settle()
  expect(ran).toContainEqual(['open', '--', `${ROOT}/src/b.ts`])
  await clock.advance(1_000)
  await ui.press({ key: `${ROOT}/README.md` })
  await ui.press({ key: `${ROOT}/README.md` })
  await clock.settle()
  expect(ran).toContainEqual(['open', '--', `${ROOT}/README.md`])
  await ui.press({ key: 'unselect' })
  await clock.settle()
  expect(await ui.find({ key: 'open' })).toBeUndefined()
  await ui.unmount()
})

test('desktop: search filters the rows, the clear button empties it, and sizes swap in for dates', async ($, on) => {
  const { ui, clock } = await desktop($, on)
  await ui.input({ key: 'q', text: 'b.ts', kind: 'change' })
  await clock.settle()
  expect(await ui.find({ type: 'Button', key: `${ROOT}/src/b.ts` })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `${ROOT}/README.md` })).toBeUndefined()
  await ui.press({ key: 'clear' })
  await clock.settle()
  expect(await ui.find({ type: 'Button', key: `${ROOT}/README.md` })).toBeDefined()
  expect(await ui.find({ key: 'clear' })).toBeUndefined()
  await ui.press({ key: 'size' })
  await clock.settle()
  expect(await textOf(ui, '3h')).toBeUndefined()
  expect(await textOf(ui, '1 B')).toBeDefined()
  await ui.unmount()
})

test("desktop: Claude's read and write light their rows, then fade; a commit shows in the footer", async ($, on) => {
  const { ui, clock } = await desktop($, on, 46, { heads: ['aaaaaaa1', 'bbbbbbb2'] })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/README.md` } as any)
  await clock.settle()
  // A read: the icon in blue, with a blue rail, and the pane asked to show it.
  const rowOf = async (id: string) => JSON.stringify(await ui.find({ type: 'Box', key: `row-${id}` }))
  expect(await rowOf(`${ROOT}/README.md`)).toContain(`"backgroundColor":"${C.blue}"`)
  expect(await rowOf(`${ROOT}/README.md`)).toContain(`fill=\\"${C.blue}\\"`)
  await clock.advance(3_000)
  // Faded: the icon back in its file type's colour (Markdown's), no rail.
  expect(await rowOf(`${ROOT}/README.md`)).toContain(`fill=\\"${FILE_TYPE.markdown.dark}\\"`)
  expect(await rowOf(`${ROOT}/README.md`)).not.toContain(`"backgroundColor":"${C.blue}"`)
  // A write inside a closed folder: the folder opens and the file's icon is lit amber.
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' } as any)
  await clock.settle()
  expect(await rowOf(`${ROOT}/src/a.ts`)).toContain(`fill=\\"${C.warn}\\"`)
  // A commit: the footer shows it with its short hash, green.
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as any)
  await clock.settle()
  expect(await textOf(ui, 'committed')).toBeDefined()
  expect(await textOf(ui, 'bbbbbbb')).toBeDefined()
  await ui.unmount()
})

test('desktop: the pane mounts at the sidebar widths, and an empty folder says so', async ($, on) => {
  const { ui, clock } = await desktop($, on, 28, { dirs: { [ROOT]: [] } })
  expect(await textOf(ui, 'empty')).toBeDefined()
  await ui.unmount()
  for (const columns of [46, 80]) {
    const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...pane(columns) })
    await clock.settle()
    expect(await wide.find({ type: 'Button', key: 'refresh' })).toBeDefined()
    await wide.unmount()
  }
})

/** The Svgs drawn, with their alts and sources. */
const svgs = async (ui: any): Promise<{ alt: string; source: string; isInteractive?: boolean }[]> => (await ui.findAll({ type: 'Svg' })).map((s: any) => s.props)

test('desktop header: the search field first, then the folder with its actions as icon buttons that draw no label text, then the branch', async ($, on) => {
  const { ui, clock, ran } = await desktop($, on, 60)
  // The order: search field, folder row, branch row.
  const drawn = JSON.stringify(await ui.drawn())
  const at = (s: string) => drawn.indexOf(s)
  expect(at('Search files')).toBeGreaterThan(-1)
  expect(at('Search files')).toBeLessThan(at('"proj"'))
  expect(at('"proj"')).toBeLessThan(at('"main"'))
  // No magnifier icon beside the field.
  expect(JSON.stringify(await svgs(ui))).not.toContain('M10.68 11.74')
  // Each action: a Button whose label is blank (Braille blanks, no visible text, as the
  // desktop draws the label and never children), over its icon, which its name labels.
  const actions: [string, string, string][] = [
    ['up', 'Up a folder', 'M3.47 7.78'],
    ['cwd', 'Follow the working directory', 'M6.906.664'],
    ['refresh', 'Refresh', 'M1.705 8.005'],
    ['hidden', 'Hide hidden files', 'M8 2c1.981'],
    ['size', 'Show sizes', '<circle'],
    ['collapse', 'Collapse all', 'M10.896 2H8.75'],
  ]
  const icons = await svgs(ui)
  for (const [key, name, path] of actions) {
    const button = await ui.find({ type: 'Button', key })
    expect(button).toBeDefined()
    expect(button.props.label.trim().replace(/⠀/g, '')).toBe('')
    expect(button.children ?? []).toEqual([])
    const icon = icons.find(s => s.alt === name)
    expect(icon?.source).toContain(path)
  }
  // No action's name is drawn as text anywhere.
  for (const [, name] of actions) expect(await textOf(ui, name)).toBeUndefined()
  // A press on one still reaches it.
  const before = ran.filter(a => a[0] === 'git' && a.includes('status')).length
  await ui.press({ key: 'refresh' })
  await clock.settle()
  expect(ran.filter(a => a[0] === 'git' && a.includes('status')).length).toBeGreaterThan(before)
  // The branch row: the name, ahead, and the upstream's host icon with the upstream as its tooltip.
  const up = (await svgs(ui)).find(s => s.alt === 'origin/main')
  expect(up?.isInteractive).toBe(true)
  expect(up?.source).toContain('<title>origin/main</title>')
  expect(up?.source).toContain('M6.766 11.328') // mark-github
  await ui.unmount()
})

// The upstream's icon by its remote's host, read with `git remote get-url`.
const HOSTS: [string, string, string][] = [
  ['GitLab', 'https://gitlab.com/k/proj.git', 'm23.6004 9.5927'],
  ['self-hosted GitLab', 'git@gitlab.corp.example:k/proj.git', 'm23.6004 9.5927'],
  ['Codeberg (Forgejo)', 'https://codeberg.org/k/proj.git', 'M16.7773 0c'],
  ['Forgejo', 'ssh://git@forgejo.example.net:2222/k/proj.git', 'M16.7773 0c'],
  ['GitHub', 'https://github.com/k/proj', 'M6.766 11.328'],
  ['another host', 'https://git.example.org/k/proj.git', 'M2 7.25A5.225'],
]
for (const [name, remote, path] of HOSTS) {
  test(`desktop branch row: a branch tracking ${name} shows that host's icon, the upstream its tooltip`, async ($, on) => {
    const { ui } = await desktop($, on, 60, { remote })
    const up = (await svgs(ui)).find(s => s.alt === 'origin/main')
    expect(up?.source).toContain(path)
    expect(up?.source).toContain('<title>origin/main</title>')
    await ui.unmount()
  })
}

test('desktop branch row: an untracked branch has no upstream icon, and a short name leaves no gap', async ($, on) => {
  const { ui, ran } = await desktop($, on, 60, { status: '## dev\0 M src/a.ts\0' })
  expect(await textOf(ui, 'dev')).toBeDefined()
  expect((await svgs(ui)).some(s => s.source.includes('<title>'))).toBe(false)
  expect(ran.some(a => a[0] === 'git' && a.includes('get-url'))).toBe(false)
  // The name's box is no wider than the name (it was six cells, leaving a gap after "dev").
  expect(JSON.stringify(await ui.drawn())).not.toContain('"minWidth":6')
  await ui.unmount()
})

test('desktop branch row: a local upstream (no remote) has no upstream icon', async ($, on) => {
  const { ui, ran } = await desktop($, on, 60, { status: '## main...main [ahead 1]\0 M src/a.ts\0' })
  expect(await textOf(ui, 'main')).toBeDefined()
  expect((await svgs(ui)).some(s => s.source.includes('<title>'))).toBe(false)
  expect(ran.some(a => a[0] === 'git' && a.includes('get-url'))).toBe(false)
  await ui.unmount()
})

test('desktop rows: a file named like an Object prototype key draws as plain text', async ($, on) => {
  const { ui, clock } = await desktop($, on, 60, {
    dirs: { [ROOT]: [['foo.constructor', 'file'], ['x.toString', 'file'], ['a.__proto__', 'file']] },
    status: '## main...origin/main\0',
  })
  await clock.settle()
  for (const name of ['foo.constructor', 'x.toString', 'a.__proto__'])
    expect(JSON.stringify(await ui.find({ type: 'Box', key: `row-${ROOT}/${name}` }))).toContain(FILE_TYPE.text.dark)
  await ui.unmount()
})

test('desktop rows: icons in their file type colour (IntelliJ New UI), an ignored folder in the excluded tone', async ($, on) => {
  const { ui, clock } = await desktop($, on, 60, {
    dirs: { [ROOT]: [['node_modules', 'dir'], ['src', 'dir'], ['package.json', 'file'], ['README.md', 'file'], ['bun.lock', 'file'], ['styles.css', 'file']], [`${ROOT}/src`]: [['a.ts', 'file']] },
    status: '## main...origin/main\0 M src/a.ts\0!! node_modules/\0',
  })
  await clock.settle()
  const rowOf = async (name: string) => JSON.stringify(await ui.find({ type: 'Box', key: `row-${ROOT}/${name}` }))
  const fill = (hex: string) => `fill=\\"${hex}\\"`
  expect(await rowOf('src')).toContain(fill(FILE_TYPE.folder.dark))
  expect(await rowOf('node_modules')).toContain(fill(FILE_TYPE.excluded.dark))
  expect(await rowOf('package.json')).toContain(fill(FILE_TYPE.json.dark))
  expect(await rowOf('README.md')).toContain(fill(FILE_TYPE.markdown.dark))
  expect(await rowOf('bun.lock')).toContain(fill(FILE_TYPE.text.dark))
  expect(await rowOf('styles.css')).toContain(fill(FILE_TYPE.style.dark))
  // Each carries its light value for the light theme too.
  expect(await rowOf('package.json')).toContain(FILE_TYPE.json.light)
  // The header's action icons stay grey.
  const header = (await svgs(ui)).find(s => s.alt === 'Refresh')
  expect(header?.source).toContain(`fill="${GRAY.mid}"`)
  expect(header?.source).not.toContain('prefers-color-scheme')
  await ui.unmount()
})
