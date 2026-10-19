import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { holdButtons } from '../../kit/ui'
import type { AnalysisRun, AnalysisSection, DashTab } from '../../types'
import { type Command, TITLE, shownTab } from '../tabs'
import { noteView, toView } from './read'
import { renderAnalysis } from './view'
import type { AnalysisEls } from './view'

const view = atom({ plugin: 'syns-dashboard', key: 'analysisView' } as const, null)
const run = atom({ plugin: 'syns-dashboard', key: 'analysisRun' } as const, { running: false, startedAt: 0, error: '' } as AnalysisRun)
const folds = atom({ plugin: 'syns-dashboard', key: 'analysisFolds' } as const, [] as string[])
const since = atom({ plugin: 'syns-dashboard', key: 'analysisSince' } as const, null as string | null)
const bucket = atom({ plugin: 'syns-dashboard', key: 'analysisBucket' } as const, null as 'day' | 'week' | null)
const section = atom({ plugin: 'syns-dashboard', key: 'analysisSection' } as const, 'terms' as AnalysisSection)
const page = atom({ plugin: 'syns-dashboard', key: 'analysisPage' } as const, 0)
/** The dashboard's tab shown; `/syn-analysis` writes it to open the pane on this tab. */
const tab = atom({ plugin: 'syns-dashboard', key: 'tab' } as const, 'overview' as DashTab)
const isShown = () => shownTab() === 'analysis'

/** How often focus.json's mtime is looked at while the tab is shown. */
const READ_EVERY = 3_000
/** A run is stopped after this long. */
const RUN_CAP = 120_000
/** The run's stderr kept for its error line. */
const TAIL = 4_000

const DATE = /^\d{4}-\d{2}-\d{2}$/

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const homeOf = async ($: EngineInterface) => (await $.env.get('HOME')) ?? ''
const focusDir = async ($: EngineInterface) => `${await homeOf($)}/.syns/files/focus`

/** Reads focus.json when its mtime moved since the last read (or `force`); writes state only on a real change. */
const readFocus = async ($: EngineInterface, force = false) => {
  const path = `${await focusDir($)}/focus.json`
  const stat = await $.fs.stat(path).catch(() => null)
  const old = await read($, view)
  if (!stat || stat.kind !== 'file') {
    const missing = noteView(`No run yet at ${path}: press Run.`)
    if (!same(old, missing)) await update($, view, () => missing)
    return
  }
  if (!force && old && old.mtime === stat.mtimeMs) return
  const fresh = toView(await $.fs.read(path), stat.mtimeMs)
  if (!same(old, fresh)) await update($, view, () => fresh)
}

let busy = false
const tick = async ($: EngineInterface, force = false) => {
  if (busy || (!force && !isShown())) return
  busy = true
  try {
    await readFocus($, force)
  } finally {
    busy = false
  }
}

let worker: { cancel: () => void } | undefined
let started = false

/** The tab just drew, so it's on screen: the first draw starts the timer (a drawing writes nothing) and reads at once. */
const drawn = ($: EngineInterface) => {
  if (started) return
  started = true
  $.clock.after(0, () => {
    worker?.cancel()
    worker = $.clock.every(READ_EVERY, () => void tick($).catch(() => undefined))
    void tick($).catch(() => undefined)
  })
}

/** The syns checkout that holds `analysis/focus.ts`: the one this plugin loads from, else `~/Code/satoramoto/syns`. */
const synsDir = async ($: EngineInterface): Promise<string | null> => {
  const root = $.plugin.root.replace(/\/+$/, '')
  const candidates = [root.slice(0, root.lastIndexOf('/')), `${await homeOf($)}/Code/satoramoto/syns`]
  for (const dir of candidates) if (dir && (await $.fs.stat(`${dir}/analysis/focus.ts`).catch(() => null))?.kind === 'file') return dir
  return null
}

/** `bun` from its own install folder when it's there (the engine's PATH may not have it), else from PATH. */
const bunOf = async ($: EngineInterface) => {
  const own = `${await homeOf($)}/.bun/bin/bun`
  return (await $.fs.stat(own).catch(() => null)) ? own : 'bun'
}

const fail = ($: EngineInterface, error: string) => update($, run, () => ({ running: false, startedAt: 0, error }))

/**
 * Runs `bun analysis/focus.ts --since <since> --bucket <bucket>` in the syns
 * checkout, one at a time, stopped after RUN_CAP. The child lives in this
 * hook's loop, so it ends with the run, the cap, or the module (the session).
 * A failure is the one error line under the heading; focus.json is read again
 * when it ends.
 */
const runFocus = async ($: EngineInterface) => {
  if (live) return
  live = true
  try {
    await runOnce($)
  } finally {
    live = false
  }
}

/** Whether this module is running focus.ts now: a `running` state left by an unloaded module (a reload mid-run) isn't. */
let live = false

const runOnce = async ($: EngineInterface) => {
  const v = await read($, view)
  const s = (await read($, since)) ?? v?.since ?? ''
  const b = (await read($, bucket)) ?? (v?.bucket === 'day' ? 'day' : 'week')
  const dir = await synsDir($)
  if (!dir) return fail($, 'No syns checkout with analysis/focus.ts (looked beside this plugin and in ~/Code/satoramoto/syns).')
  const argv = [await bunOf($), 'analysis/focus.ts', ...(DATE.test(s) ? ['--since', s] : []), '--bucket', b]
  await update($, run, () => ({ running: true, startedAt: Date.now(), error: '' }))
  const proc = $.process.spawn({ argv, cwd: dir })
  let capped = false
  const cap = $.clock.after(RUN_CAP, () => {
    capped = true
    void proc.return(undefined as never).catch(() => undefined)
  })
  let stderr = ''
  let error = ''
  try {
    for await (const piece of proc) if (piece.stream === 'stderr') stderr = (stderr + piece.text).slice(-TAIL)
    const end = await proc.result
    if (end.code !== 0) {
      const last = stderr.trim().split('\n').pop() ?? ''
      error = `focus.ts ${end.signal ? `ended by ${end.signal}` : `exited ${end.code}`}${last ? `: ${last}` : ''}`
    }
  } catch (e) {
    error = capped ? `focus.ts stopped after ${RUN_CAP / 1000} s.` : `focus.ts could not run: ${String((e as Error)?.message ?? e).slice(0, 160)}`
  } finally {
    cap.cancel()
  }
  if (capped && !error) error = `focus.ts stopped after ${RUN_CAP / 1000} s.`
  await update($, run, () => ({ running: false, startedAt: 0, error }))
  await readFocus($, true).catch(() => undefined)
}

/** The platform's opener: `open` on macOS, `xdg-open` elsewhere; asked once. */
let opener: string | undefined
const openerOf = async ($: EngineInterface) => {
  if (opener) return opener
  const os = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => null)
  opener = (os?.stdout ?? '').trim() === 'Darwin' || !os ? 'open' : 'xdg-open'
  return opener
}

/** Opens focus.html in its app; a failure is the error line. */
const openPage = async ($: EngineInterface) => {
  const path = `${await focusDir($)}/focus.html`
  if (!(await $.fs.stat(path).catch(() => null))) return fail($, `No page at ${path}: press Run.`)
  const ran = await $.process.run([await openerOf($), path], { timeoutMs: 10_000 })
  if (ran.exitCode !== 0) await fail($, `Could not open focus.html (${(ran.stderr || '').trim().split('\n').pop() || `exited ${ran.exitCode}`})`)
}

/**
 * The Analysis tab of the dashboard's pane (`pane`): the focus analyzer's last
 * run, read from focus.json and watched while the tab is shown, with Run and
 * Open page. Its hooks pass through unless its tab is shown.
 */
export const attach = (on: Parameters<Register>[0], _options: Parameters<Register>[1], pane: string): void => {
  on('command.run', { command: 'syn-analysis' }, async $ => {
    await update($, tab, () => 'analysis')
    await $.ui.open({ id: pane, title: TITLE })
    await tick($, true).catch(() => undefined)

    return { text: 'Analysis tab opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: pane }, async ($, e, next) => {
    if (!isShown()) return next(e)
    drawn($)
    const v = await read($, view)
    const stored = await read($, run)
    const r = stored.running && !live ? { ...stored, running: false } : stored
    const data = {
      view: v,
      run: r,
      folds: await read($, folds),
      section: await read($, section),
      page: await read($, page),
      since: (await read($, since)) ?? v?.since ?? '',
      bucket: (await read($, bucket)) ?? (v?.bucket === 'day' ? ('day' as const) : ('week' as const)),
      now: await $.clock.now(),
    }
    const els = holdButtons($.ui.resolve(e), `${pane}\u0000analysis\u0000${e.surface}`) as unknown as AnalysisEls
    const rows = e.props.scroll ? Math.max(1, e.props.scroll.bodyRows) : undefined
    const clearError = async () => {
      if ((await read($, run)).error) await update($, run, was => ({ ...was, error: '' }))
    }
    return renderAnalysis(els, e.surface, e.props.bodyColumns, rows, data, {
      // One term and one bucket unfolded at a time: opening one folds the other of its kind.
      toggle: id => {
        const kind = id.slice(0, id.indexOf('-') + 1)
        void update($, folds, f => (f.includes(id) ? f.filter(x => x !== id) : [...f.filter(x => !x.startsWith(kind)), id])).catch(() => undefined)
      },
      section: id =>
        void (async () => {
          await update($, section, was => (was === id ? 'none' : id))
          await update($, page, () => 0)
        })().catch(() => undefined),
      page: n => void update($, page, () => Math.max(0, n)).catch(() => undefined),
      run: () => void runFocus($).catch(() => undefined),
      // The page opens in the desktop's own apps; the terminal may be a remote shell.
      ...(e.surface === 'desktop' ? { open: () => void openPage($).catch(() => undefined) } : {}),
      setSince: s =>
        void (async () => {
          if (s && !DATE.test(s)) return fail($, `since: ${s} is not a date (YYYY-MM-DD).`)
          await update($, since, () => s || null)
          await clearError()
        })().catch(() => undefined),
      setBucket: b => void update($, bucket, () => b).catch(() => undefined),
    }, e.props.isFocused)
  })
}

/** `/syn-analysis`: the dashboard registers it as the session starts. */
export const COMMANDS: Command[] = [{ name: 'syn-analysis', description: "Open the dashboard's Analysis tab: the focus analyzer's last run, with Run" }]
