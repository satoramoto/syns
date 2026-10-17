import type { On, ProcessSpawnRequest } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FILL } from '../../kit/tokens'
import { BAND_ROWS } from '../../kit/ui'

/** How long Kill's confirm waits for its second press (register.tsx's CONFIRM_MS). */
const CONFIRM_MS = 4_000

// The dashboard's Launcher tab drawn by the engine's test kit on each surface
// (the whole dashboard plugin is loaded; `/launcher` puts its pane on this tab).
// The test's hooks sit beneath the plugin and stand for the engine: `fs` holds
// one project's .claude/launch.json, `lsof` lists the ports set in `listening`,
// and `process.spawn` records what was started and runs as the test says.
const NOW = Date.UTC(2026, 9, 11, 12)

const LAUNCH = {
  version: '0.0.1',
  configurations: [
    { name: 'app', runtimeExecutable: 'npm', runtimeArgs: ['--prefix', 'app', 'run', 'dev'], port: 5173, env: { NODE_ENV: 'development' } },
    { name: 'storybook', runtimeExecutable: 'npm', runtimeArgs: ['--prefix', 'app', 'run', 'storybook'], port: 6006 },
  ],
}

const PANE = {
  component: 'Pane',
  requestId: 'syns-dashboard',
  props: { title: 'syn', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const result = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

type Proc = { ppid: number; command: string; cwd: string }

/**
 * The process table ps and lsof read: the storybook server on 6006 (pid 6006, as
 * every listening port's pid is its port) under the npm that ran its script.
 */
const PROCS: [number, Proc][] = [
  [6006, { ppid: 6000, command: 'node /repo/app/node_modules/.bin/storybook dev -p 6006', cwd: '/repo/app' }],
  [6000, { ppid: 1, command: 'npm --prefix app run storybook', cwd: '/repo' }],
]

/** When every process started, as `ps -o lstart=` says it, unless `starts` says otherwise. */
const START = 'Mon Oct 12 10:00:00 2026'

type World = {
  /** Ports something listens on, as lsof would list them, each by the process whose pid is the port. */
  listening: Set<number>
  /** More listeners: another process on a port, lsof listing it before the port's own (`first`) or after. */
  extra: { port: number; pid: number; addr: string; first?: boolean }[]
  /** What ps and lsof say of each pid. */
  procs: Map<number, Proc>
  /** When a pid's process started, where it isn't START. */
  starts: Map<number, string>
  /** Every `kill` the mod ran, its arguments after `kill`. */
  signals: string[][]
  /** Runs on each signal the mod sends, before the signal acts. */
  onSignal?: (sig: string, pid: number) => void
  /** A process that ignores SIGTERM (only SIGKILL ends it). */
  stubborn: boolean
  /** A process no signal ends. */
  unkillable: boolean
  /** Every toast the mod showed. */
  toasts: string[]
  /** The CPU percent ps reports for every listening process. */
  cpu: number
  /** Every spawn the mod asked for. */
  spawned: ProcessSpawnRequest[]
  /** Spawns that ended because the mod ended their loop. */
  killed: string[]
  /** The test's clock. */
  clock: ReturnType<typeof mock.clock>
  /** Every pane the mod opened. */
  opened: { id: string; title: string }[]
  /** Every command the plugin ran on the host (`process.run`), its argv. */
  ran: string[][]
}

/**
 * The engine beneath the mod. The project is /repo with its launch.json, the
 * session in /repo/app (so the mod walks up). A spawned server writes a line
 * and runs until its loop ends, unless `crash` names it: then it fails at once.
 */
const engine = (on: On, opts: { crash?: string; hang?: string; launch?: { version: string; configurations: object[] }; procs?: [number, Proc][] } = {}): World => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = {
    listening: new Set([6006]),
    extra: [],
    procs: new Map(opts.procs ?? PROCS),
    starts: new Map(),
    signals: [],
    stubborn: false,
    unkillable: false,
    toasts: [],
    cpu: 4,
    spawned: [],
    killed: [],
    clock,
    opened: [],
    ran: [],
  }
  const launch = opts.launch ?? LAUNCH
  on('session.cwd', async () => ({ value: '/repo/app' }))
  on('ui.open', async (_$, e) => {
    world.opened.push({ id: e.id, title: e.title ?? '' })
    return { value: { isPlaced: true } }
  })
  on('ui.panes', async () => ({ value: [] }))
  on('ui.toast', async (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.run', async () => ({ text: '' }))
  on('fs.exists', async (_$, e) => ({ value: e.path === '/repo/.claude/launch.json' || e.path === '/repo/.git' }))
  on('fs.read', async (_$, e) => {
    if (e.path !== '/repo/.claude/launch.json') throw new Error(`ENOENT ${e.path}`)
    return { value: JSON.stringify(launch) }
  })
  // Each listening port's process has the port for its pid; ps reports each at `world.cpu` percent and 200 MB,
  // and `ps -A` (or `-p`) the process table with start times. `kill -TERM` ends a process (unless stubborn or
  // unkillable), `-KILL` too (unless unkillable).
  const row = (pid: number, p: Proc) => `${String(pid).padStart(5)} ${p.ppid} ${world.starts.get(pid) ?? START} ${p.command}`
  on('process.run', async (_$, e) => {
    world.ran.push([...e.argv])
    const [cmd, ...args] = e.argv
    if (cmd === 'lsof' && args.includes('cwd')) {
      const pids = args[args.indexOf('-p') + 1]!.split(',').map(Number)
      return result(pids.filter(p => world.procs.has(p)).map(p => `p${p}\nfcwd\nn${world.procs.get(p)!.cwd}`).join('\n'))
    }
    if (cmd === 'lsof') {
      const extra = (first: boolean) => world.extra.filter(x => Boolean(x.first) === first).map(x => `p${x.pid}\nf4\nn${x.addr}:${x.port}`)
      const lines = [...extra(true), ...[...world.listening].map(p => `p${p}\nf3\nn*:${p}`), ...extra(false)]
      return result(lines.join('\n'), lines.length ? 0 : 1)
    }
    if (cmd === 'ps' && args.includes('-A')) return result([...world.procs].map(([pid, p]) => row(pid, p)).join('\n'))
    if (cmd === 'ps' && args.some(a => a.includes('lstart'))) {
      const pids = args[args.indexOf('-p') + 1]!.split(',').map(Number)
      const rows = pids.filter(p => world.procs.has(p)).map(p => row(p, world.procs.get(p)!))
      return result(rows.join('\n'), rows.length ? 0 : 1)
    }
    if (cmd === 'ps') return result(e.argv[e.argv.length - 1]!.split(',').map(pid => `${pid} ${world.cpu.toFixed(1)} 204800`).join('\n'))
    if (cmd === 'kill') {
      const [sig, pidText] = args as [string, string]
      const pid = Number(pidText)
      if (sig !== '-0') {
        world.signals.push(args)
        world.onSignal?.(sig, pid)
      }
      if (!world.unkillable && (sig === '-KILL' || (sig === '-TERM' && !world.stubborn))) {
        world.listening.delete(pid)
        world.procs.delete(pid)
        world.extra = world.extra.filter(x => x.pid !== pid)
      }
      return result('', world.listening.has(pid) || world.procs.has(pid) ? 0 : 1)
    }
    return result('', 1)
  })
  on('process.spawn', async function* (_$, e, next) {
    world.spawned.push(e)
    const name = e.argv.includes('dev') ? 'app' : 'storybook'
    if (opts.hang === name) {
      // Never writes, and ignores the abort: only Stop's own wait ends it.
      await new Promise<void>(() => undefined)
    }
    if (opts.crash === name) {
      yield { stream: 'stderr' as const, text: 'Error: Cannot find module vite\n' }
      return { value: { code: 1, signal: null } }
    }
    yield { stream: 'stdout' as const, text: '\x1b[32mVITE\x1b[0m ready in 300 ms\n' }
    // Runs until the mod leaves its loop, which aborts this dispatch.
    await new Promise<void>(resolve => (next.signal.aborted ? resolve() : next.signal.addEventListener('abort', () => resolve())))
    world.killed.push(name)
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  return world
}

const launcher = ($: Engine, args = '') =>
  $.command.run({ command: 'launcher', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

test('a session start registers /launcher and /preview, and reads no ports until the tab is shown', async ($, on) => {
  const world = engine(on)
  const registered: string[] = []
  on('command.register', async (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo/app', surface: 'terminal', isInteractive: true })
  expect(registered).toContain('launcher')
  expect(registered).toContain('preview')
  await world.clock.advance(10_000)
  expect(world.ran.filter(a => a[0] === 'lsof'), 'no probe while the tab is off screen').toEqual([])
})

test('/launcher opens the dashboard on its Launcher tab, listing each configuration of launch.json, on the terminal and the desktop', async ($, on) => {
  const tabs: unknown[] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'syns-dashboard' && e.key === 'tab') tabs.push(e.value)
    return next(e)
  })
  const world = engine(on)
  const { text } = await launcher($)
  expect(tabs).toEqual(['launcher'])
  expect(world.opened).toContainEqual({ id: 'syns-dashboard', title: 'syn' })
  expect(text).toContain('/repo/.claude/launch.json')
  expect(text).toContain('storybook  running elsewhere  http://localhost:6006')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'syns-dashboard', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: 'app' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'stopped' })).toBeDefined()
    // The terminal's word is shorter: its green ✓ already says it answers.
    expect(await ui.find({ type: 'Text', text: surface === 'terminal' ? /^elsewhere$/ : 'running elsewhere' })).toBeDefined()
    // A server something else runs can't be started twice; the stopped one can.
    expect(await ui.find({ key: 'start-app' })).toBeDefined()
    expect(await ui.find({ key: 'start-storybook' })).toBeUndefined()
    expect(await ui.find({ type: 'Link', text: 'localhost:6006' }), 'the URL of the one running elsewhere').toBeDefined()
    await ui.unmount()
  }
})

const mountAt = ($: Engine, surface: 'terminal' | 'desktop', bodyColumns: number) =>
  $.ui.mount({ plugin: 'syns-dashboard', surface, ...PANE, props: { ...PANE.props, bodyColumns } })

test('on the terminal, the path alone, a blank row, then each row with its kit status and actions, at every width', async ($, on) => {
  engine(on, { crash: 'app' })
  await launcher($)
  for (const columns of [30, 40, 60, 100]) {
    const ui = await mountAt($, 'terminal', columns)
    expect(await ui.find({ type: 'Text', text: 'repo/.claude/launch.json' }), `head at ${columns}`).toBeDefined()
    expect((await ui.find({ key: 'top' }))?.props.marginBottom, `the blank row under the head at ${columns}`).toBe(1)
    // The head says no counts: every row's header already says its state.
    expect(await ui.find({ type: 'Text', text: /^running$/ }), `no counts at ${columns}`).toBeUndefined()
    // A stopped server's state is the kit's status glyph, then its word where it fits.
    expect(await ui.find({ type: 'Text', text: '■' }), `stopped at ${columns}`).toBeDefined()
    expect(await ui.find({ key: 'word-app', text: 'stopped' }), `the word stopped at ${columns}`)[columns >= 40 ? 'toBeDefined' : 'toBeUndefined']()
    expect(await ui.find({ type: 'Button', text: 'Start' }), `Start at ${columns}`).toBeDefined()
    // The one running elsewhere keeps its glyph and its address, the word only where it fits.
    expect(await ui.find({ type: 'Text', text: '✓' }), `running elsewhere at ${columns}`).toBeDefined()
    expect(await ui.find({ type: 'Link', text: '6006' }), `its address at ${columns}`).toBeDefined()
    expect(await ui.find({ key: 'word-storybook', text: 'elsewhere' }), `the word at ${columns}`)[columns >= 40 ? 'toBeDefined' : 'toBeUndefined']()
    await ui.unmount()
  }

  // A crash unfolds its row: the exit code, then, a blank row on, the output's tail,
  // each line a dim note, without the lines the props already say.
  await launcher($, 'start app')
  const ui = await mountAt($, 'terminal', 60)
  expect(await ui.find({ type: 'Text', text: '✕' })).toBeDefined()
  expect(await ui.find({ key: 'word-app', text: 'failed' })).toBeDefined()
  const line = await ui.find({ type: 'Text', text: 'Error: Cannot find module vite' })
  expect(line?.props.dimColor).toBe(true)
  expect(line?.props.wrap).toBe('truncate')
  expect((await ui.find({ key: 'log-app' }))?.props.marginTop, 'a blank row above the output').toBe(1)
  expect(await ui.find({ type: 'Text', text: /exited with code/ }), 'the exit prop says it').toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\$ npm/ }), 'the command prop says it').toBeUndefined()
  await ui.unmount()

  // The desktop's output keeps every line.
  const desk = await mountAt($, 'desktop', 60)
  expect(await desk.find({ type: 'Text', text: 'exited with code 1' })).toBeDefined()
  await desk.unmount()
})

test('on the terminal, every row keeps the same columns: state, address and buttons line up', { timeoutMs: 15_000 }, async ($, on) => {
  engine(on)
  await launcher($)
  await launcher($, 'start app')
  for (const columns of [40, 60, 80]) {
    const ui = await mountAt($, 'terminal', columns)
    // app is starting (Stop, Restart), storybook runs elsewhere (no buttons): their slots are as wide.
    for (const slot of ['state', 'where', 'do']) {
      const a = (await ui.find({ key: `${slot}-app` }))?.props.width
      expect(a, `${slot} at ${columns}`).toBeGreaterThan(0)
      expect((await ui.find({ key: `${slot}-storybook` }))?.props.width, `${slot} at ${columns}`).toBe(a)
    }
    await ui.unmount()
  }
  await launcher($, 'stop app')
})

test('on a wide terminal the rows keep to the measure', async ($, on) => {
  engine(on)
  await launcher($)
  const ui = await mountAt($, 'terminal', 120)
  expect((await ui.find({ key: 'section-app' }))?.props.width).toBe(72)
  await ui.unmount()
})

// app is starting (Stop, Restart) and storybook, the longest title, runs elsewhere.
const STARTING = [
  { columns: 40, address: true, restart: true },
  { columns: 30, address: false, restart: true },
]
for (const o of STARTING) {
  test(`on the terminal at ${o.columns} columns, a starting row gives up its word and address before its Stop and Restart`, async ($, on) => {
    const world = engine(on)
    await launcher($)
    const ui = await mountAt($, 'terminal', o.columns)
    await ui.press({ key: 'start-app' })
    expect(world.spawned).toHaveLength(1)
    expect(await ui.find({ key: 'stop-app' })).toBeDefined()
    expect(await ui.find({ key: 'restart-app' }))[o.restart ? 'toBeDefined' : 'toBeUndefined']()
    expect(await ui.find({ type: 'Text', text: '◐' })).toBeDefined()
    expect(await ui.find({ key: 'word-app', text: 'starting' })).toBeUndefined()
    expect(await ui.find({ key: 'where-app' }))[o.address ? 'toBeDefined' : 'toBeUndefined']()
    await ui.press({ key: 'stop-app' })
    expect(world.killed).toEqual(['app'])
    await ui.unmount()
  })
}

/** A running app (started here, answering) at `columns`, after `samples` reads of the ports. */
const runningAt = async ($: Engine, on: On, columns: number, samples = 1) => {
  const world = engine(on)
  await launcher($)
  await launcher($, 'start app')
  world.listening.add(5173)
  for (let i = 0; i < samples; i++) await launcher($, 'list')
  return { world, ui: await mountAt($, 'terminal', columns) }
}

// The rows' right sides give way in one order, together: the address shortens to its
// port, then the sparkline goes, then the word, then the address, then Restart. Stop
// never goes. Beside storybook's title and its sparkline's column (it has two
// samples), the whole row needs 64 columns, the short one 55, without the sparkline
// 47, without the word 37, without the address 30.
const ORDER = [
  { columns: 70, address: 'localhost:5173', word: true, restart: true },
  { columns: 50, address: ':5173', word: true, restart: true },
  { columns: 40, address: ':5173', word: false, restart: true },
  { columns: 32, address: null, word: false, restart: true },
  { columns: 25, address: null, word: false, restart: false },
]
for (const o of ORDER) {
  test(`on the terminal at ${o.columns} columns, a running row keeps ${[o.address ?? 'no address', o.word ? 'its word' : 'no word', o.restart ? 'Restart' : 'no Restart'].join(', ')}`, { timeoutMs: 15_000 }, async ($, on) => {
    const { ui } = await runningAt($, on, o.columns)
    expect(await ui.find({ type: 'Text', text: '✓' }), 'the glyph always').toBeDefined()
    expect(await ui.find({ key: 'stop-app' }), 'Stop always').toBeDefined()
    expect(await ui.find({ key: 'word-app', text: 'running' }), 'the word')[o.word ? 'toBeDefined' : 'toBeUndefined']()
    if (o.address) expect(await ui.find({ type: 'Text', text: new RegExp(`^${o.address}$`) }), 'the address').toBeDefined()
    else expect(await ui.find({ key: 'where-app' }), 'no address').toBeUndefined()
    if (o.address === ':5173') expect(await ui.find({ type: 'Text', text: /localhost:5173/ }), 'shortened').toBeUndefined()
    expect(await ui.find({ key: 'restart-app' }), 'Restart')[o.restart ? 'toBeDefined' : 'toBeUndefined']()
    await launcher($, 'stop app')
    await ui.unmount()
  })
}

test('on the terminal, a running server draws a CPU sparkline that stays after its address shortens, and its CPU and memory unfolded', { timeoutMs: 15_000 }, async ($, on) => {
  const { world, ui } = await runningAt($, on, 100, 1)
  // One sample is no line yet.
  expect(await ui.find({ key: 'spark-app' }), 'no sparkline from one sample').toBeUndefined()
  world.cpu = 37
  await launcher($, 'list')
  expect(await ui.find({ key: 'spark-app' }), 'a sparkline from two samples').toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^[⠀-⣿ ]*[⡀-⣿][⠀-⣿ ]*$/ }), 'drawn in Braille').toBeDefined()

  await ui.press({ key: 'toggle-app' })
  expect(await ui.find({ type: 'Text', text: '37%' }), 'the last CPU sample').toBeDefined()
  expect(await ui.find({ type: 'Text', text: '200MB' }), 'its memory').toBeDefined()
  await ui.unmount()

  // At 60 columns the address has shortened to its port and the sparkline stays; at 50 it has gone.
  const mid = await mountAt($, 'terminal', 60)
  expect(await mid.find({ key: 'spark-app' })).toBeDefined()
  expect(await mid.find({ type: 'Text', text: /^:5173$/ })).toBeDefined()
  await mid.unmount()
  const narrow = await mountAt($, 'terminal', 50)
  expect(await narrow.find({ key: 'spark-app' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /^:5173$/ })).toBeDefined()
  await narrow.unmount()

  // The desktop draws as before: no sparkline, no CPU figures.
  const desk = await mountAt($, 'desktop', 100)
  expect(await desk.find({ key: 'spark-app' })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: '37%' })).toBeUndefined()
  await desk.unmount()

  // Stopped, it measures nothing.
  world.listening.delete(5173)
  await launcher($, 'stop app')
  const after = await mountAt($, 'terminal', 100)
  expect(await after.find({ key: 'spark-app' })).toBeUndefined()
  await after.unmount()
})

test('focused or not, the terminal pane draws the same rows and no key hints (the launcher binds no keys)', async ($, on) => {
  engine(on)
  await launcher($)
  for (const isFocused of [true, false]) {
    const ui = await $.ui.mount({ plugin: 'syns-dashboard', surface: 'terminal', ...PANE, props: { ...PANE.props, isFocused, bodyColumns: 60 } })
    expect(await ui.find({ key: 'start-app' }), `Start, focused ${isFocused}`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /·/ }), `no hint line, focused ${isFocused}`).toBeUndefined()
    await ui.unmount()
  }
})

test('Start runs the configuration in the project root with PORT set; it shows running once the port answers, and Stop ends it', async ($, on) => {
  const world = engine(on)
  await launcher($)

  const ui = await $.ui.mount({ plugin: 'syns-dashboard', surface: 'desktop', ...PANE })
  await ui.press({ key: 'start-app' })
  expect(world.spawned).toHaveLength(1)
  expect(world.spawned[0]!.argv).toEqual(['npm', '--prefix', 'app', 'run', 'dev'])
  expect(world.spawned[0]!.cwd).toBe('/repo')
  expect(world.spawned[0]!.env).toEqual({ NODE_ENV: 'development', PORT: '5173' })
  expect(await ui.find({ type: 'Text', text: 'starting' })).toBeDefined()
  expect(await ui.find({ key: 'stop-app' })).toBeDefined()
  expect(await ui.find({ key: 'start-app' })).toBeUndefined()

  // The port answers: the next read shows it running, with its URL.
  world.listening.add(5173)
  expect((await launcher($, 'list')).text).toContain('app  running  http://localhost:5173')
  expect(await ui.find({ type: 'Link', text: 'localhost:5173' }), 'its URL once it answers').toBeDefined()

  // Its output, colours stripped, unfolds under the row.
  await ui.press({ key: 'toggle-app' })
  expect(await ui.find({ type: 'Text', text: 'VITE ready in 300 ms' })).toBeDefined()

  world.listening.delete(5173)
  await ui.press({ key: 'stop-app' })
  expect(world.killed).toEqual(['app'])
  expect(await ui.find({ key: 'start-app' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'stopped' })).toBeDefined()
  await ui.unmount()
})

test('a redraw that leaves a row alone keeps its Start button\'s press handle, and a press on it still starts the server', async ($, on) => {
  const world = engine(on)
  await launcher($)
  const handleOf = async (ui: { drawn: () => Promise<unknown> }, key: string): Promise<number | undefined> => {
    const find = (d: any): any =>
      d && typeof d === 'object'
        ? d.type === 'Button' && d.props?.key === key
          ? d
          : ((d.children ?? []) as unknown[]).flat(Infinity).map(find).find(Boolean)
        : undefined
    return find(await ui.drawn())?.press?.handle
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'syns-dashboard', surface, ...PANE })
    const before = await handleOf(ui, 'start-app')
    expect(before, `${surface}: Start is drawn`).toBeDefined()
    // Unfolding the other row writes the pane's state and draws it again; app's row is as it was.
    await ui.press({ key: 'toggle-storybook' })
    expect(await ui.find({ key: 'command-storybook' }), `${surface}: storybook unfolded`).toBeDefined()
    expect(await handleOf(ui, 'start-app'), `${surface}: Start keeps the handle the first drawing had`).toBe(before)
    await ui.press({ key: 'toggle-storybook' })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'syns-dashboard', surface: 'desktop', ...PANE })
  await ui.press({ key: 'toggle-storybook' })
  await ui.press({ key: 'start-app' })
  expect(world.spawned, 'the press reached Start after the redraw').toHaveLength(1)
  await ui.unmount()
  await launcher($, 'stop app')
})

test('a server that exits with an error shows failed, unfolded with its output', async ($, on) => {
  engine(on, { crash: 'app' })
  await launcher($)
  expect((await launcher($, 'start app')).text).toContain('Starting app on http://localhost:5173')
  // The crash lands after Start answers; the next read shows it.
  expect((await launcher($, 'list')).text).toContain('app  failed  :5173')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'syns-dashboard', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: 'failed' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Error: Cannot find module vite' })).toBeDefined()
    expect(await ui.find({ key: 'start-app' })).toBeDefined()
    await ui.unmount()
  }
})

test('two Starts at once spawn one server', async ($, on) => {
  const world = engine(on)
  await launcher($)
  const [a, b] = await Promise.all([launcher($, 'start app'), launcher($, 'start app')])
  expect(world.spawned).toHaveLength(1)
  expect([a.text, b.text].some(t => t?.includes('already'))).toBe(true)
  await launcher($, 'stop app')
})

test('Stop answers even when the server never ends', async ($, on) => {
  const world = engine(on, { hang: 'app' })
  await launcher($)
  await launcher($, 'start app')
  const stopping = launcher($, 'stop app')
  await world.clock.advance(5_000)
  expect((await stopping).text).toContain('Stopped app')
})

test('/launcher start refuses a server whose port another process holds, and stop names where it runs', async ($, on) => {
  const world = engine(on)
  expect((await launcher($, 'start storybook')).text).toContain('port 6006 is in use by another process')
  expect((await launcher($, 'stop storybook')).text).toContain('started elsewhere')
  expect((await launcher($, 'start nope')).text).toContain('No configuration named "nope"')
  expect(world.spawned).toHaveLength(0)
})

// Two configurations on one port, as a checkout and its worktree's Storybook: the
// worktree's runs (started by bun with its --cwd, the server working there), the
// checkout's doesn't.
const SHARED = {
  version: '0.0.1',
  configurations: [
    { name: 'app', runtimeExecutable: 'npm', runtimeArgs: ['--prefix', 'app', 'run', 'dev'], port: 5173 },
    { name: 'storybook', runtimeExecutable: 'bun', runtimeArgs: ['run', 'storybook'], port: 6006, autoPort: true },
    { name: 'storybook-wt', runtimeExecutable: 'bun', runtimeArgs: ['run', '--cwd=/wt', 'storybook'], port: 6006, autoPort: true },
  ],
}
const SHARED_PROCS: [number, Proc][] = [
  [6006, { ppid: 6001, command: 'node /wt/node_modules/.bin/storybook dev --port 6006 --no-open --ci', cwd: '/wt' }],
  [6001, { ppid: 6000, command: '/opt/homebrew/bin/bun run --cwd=/wt storybook', cwd: '/repo' }],
  [6000, { ppid: 1, command: '/Applications/Claude.app/Contents/Helpers/disclaimer -- /opt/homebrew/bin/bun run --cwd=/wt storybook', cwd: '/repo' }],
]

test('on the desktop every header band is as tall, whatever its row holds, and nothing has a border', { timeoutMs: 15_000 }, async ($, on) => {
  const world = engine(on, { launch: SHARED, procs: SHARED_PROCS })
  await launcher($)
  await launcher($, 'start app')
  world.listening.add(5173)
  await launcher($, 'list')
  // app runs here (Stop, Restart, its URL), storybook's port is taken (Start, Kill),
  // storybook-wt runs elsewhere (Take over, Kill, its URL).
  for (const columns of [40, 80]) {
    const ui = await mountAt($, 'desktop', columns)
    expect(await ui.find({ key: 'stop-app' })).toBeDefined()
    expect(await ui.find({ key: 'start-storybook' })).toBeDefined()
    expect(await ui.find({ key: 'adopt-storybook-wt' })).toBeDefined()
    const bands = (await ui.findAll({ type: 'Box' })).filter(b => b.props.backgroundColor === FILL.head)
    expect(bands, `one band a row at ${columns}`).toHaveLength(3)
    for (const b of bands) {
      expect(b.props.height, `band height at ${columns}`).toBe(BAND_ROWS)
      expect(b.props.flexShrink).toBe(0)
    }
    const bordered = (await ui.findAll({})).filter(x => x.props.borderStyle !== undefined)
    expect(bordered, `no borders at ${columns}`).toHaveLength(0)
    await ui.unmount()
  }
  await launcher($, 'stop app')
})

test('two configurations on one port: only the one whose process holds it runs, the other reads port taken', async ($, on) => {
  engine(on, { launch: SHARED, procs: SHARED_PROCS })
  await launcher($)
  const { text } = await launcher($, 'list')
  expect(text).toContain('storybook  port taken  :6006')
  expect(text).toContain('storybook-wt  running elsewhere  http://localhost:6006')

  for (const surface of ['terminal', 'desktop'] as const) {
    // One stack on the desktop (below the column split), so each row has room for its URL.
    const ui = await mountAt($, surface, surface === 'desktop' ? 80 : 100)
    // The terminal's word is the short one; the desktop's says which.
    const taken = surface === 'terminal' ? { key: 'word-storybook', text: 'taken' } : { key: 'state-storybook', text: 'port taken' }
    expect(await ui.find(taken), `taken on the ${surface}`).toBeDefined()
    expect(await ui.find({ type: 'Link', text: 'localhost:6006' }), `one URL on the ${surface}`).toBeDefined()
    expect(await ui.findAll({ type: 'Link' }), `only the running one's URL on the ${surface}`).toHaveLength(1)
    // The taken one can start on the next port (autoPort) or kill what holds it; it's not its to take over.
    expect(await ui.find({ key: 'start-storybook' })).toBeDefined()
    expect(await ui.find({ key: 'kill-storybook' })).toBeDefined()
    expect(await ui.find({ key: 'adopt-storybook' })).toBeUndefined()
    // The running one offers Take over and Kill, never Start.
    expect(await ui.find({ key: 'adopt-storybook-wt' })).toBeDefined()
    expect(await ui.find({ key: 'kill-storybook-wt' })).toBeDefined()
    expect(await ui.find({ key: 'start-storybook-wt' })).toBeUndefined()
    if (surface === 'desktop') {
      // The head counts one running, not two.
      expect(await ui.find({ key: 'head', text: /1 running/ })).toBeDefined()
      expect(await ui.find({ key: 'head', text: /2 running/ })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('a process this session started is its own configuration\'s, even on a port another configuration shares', { timeoutMs: 15_000 }, async ($, on) => {
  const world = engine(on, { launch: SHARED, procs: [] })
  world.listening.clear()
  await launcher($, 'start storybook')
  world.listening.add(6006)
  const { text } = await launcher($, 'list')
  expect(text).toContain('storybook  running  http://localhost:6006')
  expect(text).toContain('storybook-wt  port taken  :6006')
  await launcher($, 'stop storybook')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on the ${surface}, Take over and Kill show only for a port held elsewhere; running rows offer Stop and Restart, stopped ones Start`, { timeoutMs: 15_000 }, async ($, on) => {
    const world = engine(on)
    await launcher($)
    const ui = await mountAt($, surface, 100)
    expect(await ui.find({ key: 'adopt-storybook' })).toBeDefined()
    expect(await ui.find({ key: 'kill-storybook' })).toBeDefined()
    expect(await ui.find({ key: 'stop-storybook' })).toBeUndefined()
    expect(await ui.find({ key: 'start-storybook' })).toBeUndefined()
    expect(await ui.find({ key: 'adopt-app' })).toBeUndefined()
    expect(await ui.find({ key: 'kill-app' })).toBeUndefined()
    expect(await ui.find({ key: 'start-app' })).toBeDefined()
    await ui.press({ key: 'start-app' })
    world.listening.add(5173)
    await launcher($, 'list')
    expect(await ui.find({ key: 'stop-app' })).toBeDefined()
    expect(await ui.find({ key: 'restart-app' })).toBeDefined()
    expect(await ui.find({ key: 'start-app' })).toBeUndefined()
    expect(await ui.find({ key: 'adopt-app' })).toBeUndefined()
    expect(await ui.find({ key: 'kill-app' })).toBeUndefined()
    // Unfolded, the process holding the port: its pid and its command.
    await ui.press({ key: 'toggle-storybook' })
    expect(await ui.find({ key: 'pid-storybook', text: '6006' })).toBeDefined()
    expect(await ui.find({ key: 'process-storybook', text: /storybook dev -p 6006/ })).toBeDefined()
    await ui.press({ key: 'stop-app' })
    await ui.unmount()
  })

  test(`on the ${surface}, Kill asks once more, ends the process on a second press, and reverts if none comes`, async ($, on) => {
    const world = engine(on)
    await launcher($)
    const ui = await mountAt($, surface, 100)
    await ui.press({ key: 'kill-storybook' })
    expect(await ui.find({ type: 'Text', text: 'Kill PID 6006?' }) ?? (await ui.find({ type: 'Button', text: 'Kill PID 6006?' })), 'the confirm').toBeDefined()
    expect(world.signals, 'nothing killed on the first press').toEqual([])
    // No second press: it lapses back to Kill.
    await world.clock.advance(CONFIRM_MS + 1)
    expect(await ui.find({ text: /Kill PID/ }), 'reverted').toBeUndefined()
    expect(await ui.find({ key: 'kill-storybook', text: 'Kill' })).toBeDefined()
    expect(world.signals).toEqual([])
    // Pressed twice in time: SIGTERM, then the row is stopped and Start works.
    await ui.press({ key: 'kill-storybook' })
    await ui.press({ key: 'kill-storybook' })
    expect(world.signals).toEqual([['-TERM', '6006']])
    expect(await ui.find({ key: 'start-storybook' })).toBeDefined()
    expect(await ui.find({ key: 'kill-storybook' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: surface === 'terminal' ? /^stopped$/ : 'stopped' })).toBeDefined()
    await ui.unmount()
  })

  test(`on the ${surface}, a taken-over server reads running with Stop, and Stop signals its pid`, async ($, on) => {
    const world = engine(on)
    await launcher($)
    // One stack on the desktop (below the column split), so the row has room for its URL.
    const ui = await mountAt($, surface, surface === 'desktop' ? 80 : 100)
    await ui.press({ key: 'adopt-storybook' })
    await launcher($, 'list')
    expect(await ui.find({ key: surface === 'terminal' ? 'word-storybook' : 'state-storybook', text: /^running$/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: 'localhost:6006' })).toBeDefined()
    expect(await ui.find({ key: 'stop-storybook' })).toBeDefined()
    expect(await ui.find({ key: 'adopt-storybook' })).toBeUndefined()
    expect(await ui.find({ key: 'kill-storybook' })).toBeUndefined()
    await ui.press({ key: 'toggle-storybook' })
    expect(await ui.find({ type: 'Text', text: /output can't be shown/ })).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ key: 'head', text: /1 running/ })).toBeDefined()
    await ui.press({ key: 'stop-storybook' })
    expect(world.signals).toEqual([['-TERM', '6006']])
    expect(await ui.find({ key: 'start-storybook' })).toBeDefined()
    await ui.unmount()
  })
}

test('Kill sends SIGKILL to a process that outlives SIGTERM', async ($, on) => {
  const world = engine(on)
  world.stubborn = true
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'kill-storybook' })
  const killing = ui.press({ key: 'kill-storybook' })
  await world.clock.advance(3_000)
  await killing
  expect(world.signals).toEqual([['-TERM', '6006'], ['-KILL', '6006']])
  expect(await ui.find({ key: 'start-storybook' })).toBeDefined()
  await ui.unmount()
})

/** A process that isn't the storybook server, as another program's. */
const OTHER: Proc = { ppid: 1, command: 'node /elsewhere/server.js', cwd: '/elsewhere' }

test('Kill refuses when the port has passed to another process between its two presses', async ($, on) => {
  const world = engine(on)
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'kill-storybook' })
  // The storybook server left the port (still alive) and another process listens there now.
  world.listening.delete(6006)
  world.procs.set(7007, OTHER)
  world.extra.push({ port: 6006, pid: 7007, addr: '127.0.0.1' })
  await ui.press({ key: 'kill-storybook' })
  expect(world.signals, 'no signal to either').toEqual([])
  expect(world.toasts).toEqual(['storybook: not killed: port 6006 is now held by process 7007, not process 6006.'])
  // The row is read again: it names the process on the port now.
  await ui.press({ key: 'toggle-storybook' })
  expect(await ui.find({ key: 'pid-storybook', text: '7007' })).toBeDefined()
  await ui.unmount()
})

test('Kill refuses when the pid is a later process (another start time) by its second press', async ($, on) => {
  const world = engine(on)
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'kill-storybook' })
  world.starts.set(6006, 'Mon Oct 12 11:30:00 2026')
  await ui.press({ key: 'kill-storybook' })
  expect(world.signals).toEqual([])
  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]).toContain('storybook: not killed: process 6006 is now another process (started Mon Oct 12 11:30:00 2026')
  await ui.unmount()
})

test('Kill sends no SIGKILL once the pid it sent SIGTERM is a later process', async ($, on) => {
  const world = engine(on)
  world.stubborn = true
  // Right after SIGTERM the pid belongs to a process started later.
  world.onSignal = sig => void (sig === '-TERM' && world.starts.set(6006, 'Mon Oct 12 11:30:00 2026'))
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'kill-storybook' })
  const killing = ui.press({ key: 'kill-storybook' })
  await world.clock.advance(3_000)
  await killing
  expect(world.signals).toEqual([['-TERM', '6006']])
  await ui.unmount()
})

test('lsof listing IPv4 and IPv6 listeners of different processes on one port: Kill names both and signals neither', async ($, on) => {
  const world = engine(on)
  world.procs.set(7007, OTHER)
  world.extra.push({ port: 6006, pid: 7007, addr: '[::1]' })
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'kill-storybook' })
  expect(world.toasts).toEqual([
    'storybook: not killed: 2 processes listen on port 6006 (processes 6006 and 7007); Kill ends one process, so end them from a terminal.',
  ])
  expect(await ui.find({ text: /Kill PID/ }), 'not armed').toBeUndefined()
  await ui.press({ key: 'kill-storybook' })
  expect(world.signals).toEqual([])
  await ui.unmount()
})

test('a taken-over server stays taken over while another process also listens on its port, listed first', async ($, on) => {
  const world = engine(on)
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'adopt-storybook' })
  world.procs.set(7007, OTHER)
  world.extra.push({ port: 6006, pid: 7007, addr: '[::1]', first: true })
  expect((await launcher($, 'list')).text).toContain('storybook  running  http://localhost:6006')
  expect(await ui.find({ key: 'stop-storybook' })).toBeDefined()
  // Stop signals the one taken over, not the other.
  await ui.press({ key: 'stop-storybook' })
  expect(world.signals).toEqual([['-TERM', '6006']])
  await ui.unmount()
})

test('a taken-over server whose process exits reads stopped, and Stop signals nothing', async ($, on) => {
  const world = engine(on)
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'adopt-storybook' })
  world.listening.delete(6006)
  world.procs.delete(6006)
  expect((await launcher($, 'list')).text).toContain('storybook  stopped  :6006')
  expect(await ui.find({ key: 'start-storybook' })).toBeDefined()
  expect(await ui.find({ key: 'stop-storybook' })).toBeUndefined()
  expect((await launcher($, 'stop storybook')).text).toContain("storybook isn't running from this session")
  expect(world.signals).toEqual([])
  await ui.unmount()
})

test('Stop on a taken-over server whose pid is now a later process refuses and lets it go', async ($, on) => {
  const world = engine(on)
  await launcher($)
  await mountAt($, 'desktop', 100).then(async ui => {
    await ui.press({ key: 'adopt-storybook' })
    await ui.unmount()
  })
  world.starts.set(6006, 'Mon Oct 12 11:30:00 2026')
  const { text } = await launcher($, 'stop storybook')
  expect(text).toContain('storybook: not stopped, and no longer taken over: process 6006 is now another process')
  expect(world.signals).toEqual([])
  const ui = await mountAt($, 'desktop', 100)
  expect(await ui.find({ key: 'adopt-storybook' }), 'it can be taken over again').toBeDefined()
  await ui.unmount()
})

test('a Stop that fails keeps the server taken over and says so', async ($, on) => {
  const world = engine(on)
  world.unkillable = true
  await launcher($)
  const ui = await mountAt($, 'desktop', 100)
  await ui.press({ key: 'adopt-storybook' })
  const stopping = launcher($, 'stop storybook')
  await world.clock.advance(3_000)
  expect((await stopping).text).toBe("storybook: Stop failed: could not end process 6006 (it may be another user's); still taken over.")
  expect(world.signals).toEqual([['-TERM', '6006'], ['-KILL', '6006']])
  expect((await launcher($, 'list')).text).toContain('storybook  running  http://localhost:6006')
  expect(await ui.find({ key: 'stop-storybook' })).toBeDefined()
  expect(await ui.find({ key: 'adopt-storybook' })).toBeUndefined()
  await ui.unmount()
})

test('on a narrow desktop a running row keeps its state word whole; its URL goes first', { timeoutMs: 15_000 }, async ($, on) => {
  const world = engine(on)
  await launcher($)
  await launcher($, 'start app')
  world.listening.add(5173)
  await launcher($, 'list')
  const narrow = await mountAt($, 'desktop', 30)
  expect((await narrow.find({ key: 'state-app' }))?.props.flexShrink, 'the word never shrinks').toBe(0)
  expect(await narrow.find({ key: 'state-app', text: 'running' })).toBeDefined()
  expect(await narrow.find({ key: 'where-app' }), 'no URL').toBeUndefined()
  expect(await narrow.find({ key: 'stop-app' })).toBeDefined()
  await narrow.unmount()
  const wide = await mountAt($, 'desktop', 80)
  expect(await wide.find({ key: 'where-app' })).toBeDefined()
  expect((await wide.find({ key: 'where-app' }))?.props.flexShrink, 'the URL gives way').toBe(1)
  await wide.unmount()
  await launcher($, 'stop app')
})

type Drawn = { type?: string; key?: string; props?: Record<string, any>; children?: unknown[] }
const kidsOf = (d: Drawn) => ((d.children ?? d.props?.children ?? []) as unknown[]).flat(Infinity).filter((c): c is Drawn => !!c && typeof c === 'object')
const everyOf = (d: Drawn): Drawn[] => [d, ...kidsOf(d).flatMap(everyOf)]
const keyOf = (d: Drawn) => String(d.key ?? d.props?.key ?? '')

test('on a wide desktop pane the configurations sit in columns, each section whole and once, in order; a sidebar and the terminal keep one stack', async ($, on) => {
  engine(on, { launch: SHARED, procs: SHARED_PROCS })
  await launcher($)
  const columnsAt = async (surface: 'terminal' | 'desktop', bodyColumns: number) => {
    const ui = await mountAt($, surface, bodyColumns)
    const tree = (await ui.drawn()) as Drawn
    await ui.unmount()
    return everyOf(tree)
      .filter(d => d.type === 'Box' && /^sections-col-\d+$/.test(keyOf(d)))
      .map(c => everyOf(c).map(keyOf).filter(k => k.startsWith('section-')).map(k => k.slice('section-'.length)))
  }
  expect(await columnsAt('desktop', 80)).toEqual([])
  const two = await columnsAt('desktop', 120)
  expect(two.length).toBe(2)
  expect(two.flat()).toEqual(['app', 'storybook', 'storybook-wt'])
  expect(await columnsAt('desktop', 180)).toEqual([['app'], ['storybook'], ['storybook-wt']])
  expect(await columnsAt('terminal', 180)).toEqual([])
})

test("the footer's columns switch turns a wide pane to one stack, and the setting stays in the mod's state for the next drawing", async ($, on) => {
  // What the mod writes to its `columns` state, as the host sees it.
  const writes: unknown[] = []
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'syns-dashboard' && e.key === 'launcherColumns') writes.push(e.value)
    return next(e)
  })
  engine(on, { launch: SHARED, procs: SHARED_PROCS })
  await launcher($)
  const flowed = (tree: Drawn) => everyOf(tree).filter(d => d.type === 'Box' && /^sections-col-\d+$/.test(keyOf(d))).length
  const ui = await mountAt($, 'desktop', 120)
  expect(flowed((await ui.drawn()) as Drawn)).toBe(2)
  expect((await ui.find({ key: 'flow-toggle' }))?.props).toMatchObject({ label: 'columns' })
  await ui.press({ key: 'flow-toggle' })
  expect(writes).toEqual([false])
  await ui.unmount()
  // Drawn again (a reload keeps the mod's state): one stack, the switch dim.
  const again = await mountAt($, 'desktop', 120)
  expect(flowed((await again.drawn()) as Drawn)).toBe(0)
  expect((await again.find({ key: 'flow-toggle' }))?.props).toMatchObject({ label: 'single column', dimColor: true })
  await again.unmount()
})
