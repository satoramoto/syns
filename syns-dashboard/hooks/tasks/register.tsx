import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { holdButtons } from '../../kit/ui'
import type { DashTab, TaskRow } from '../../types'
import { type Command, TITLE, shownTab } from '../tabs'
import type { Els } from '../view'
import { DAY, emptyScan, PROMPT_MARK, repoOf, scanLine, TOOL_MARK, toRows, toView } from './read'
import type { Scan } from './read'
import { renderTasks } from './view'

const view = atom({ plugin: 'syns-dashboard', key: 'tasksView' } as const, null)
const collapsed = atom({ plugin: 'syns-dashboard', key: 'tasksCollapsed' } as const, [] as string[])
/** The dashboard's brain.json view, read by its own timer: the inbox's open approvals. */
const brain = atom({ plugin: 'syns-dashboard', key: 'brain' } as const, null)
/** The dashboard's tab shown; `/tasks` writes it to open the pane on this tab. */
const tab = atom({ plugin: 'syns-dashboard', key: 'tab' } as const, 'overview' as DashTab)
const isShown = () => shownTab() === 'tasks'

/** Sessions whose transcript moved in this long are listed. */
const WEEK = 7 * DAY
/** A subagent whose transcript moved in this long counts as running. */
const AGENT_LIVE = 90_000
/** How often the transcripts are looked at again while the tab is shown. */
const READ_EVERY = 10_000
/** How many transcripts are read at once. */
const AT_ONCE = 6
/** A title cut from the first prompt keeps this many characters. */
const TITLE_CHARS = 48

/**
 * The lines of a transcript from byte `$2` (1-based), `$3` bytes of it, that the
 * tab reads: the turn tools' calls whole (up to 60k characters), the prompts'
 * first 2k (enough for a title and their place in order), the last 3.5 MB of
 * that. Only the new bytes are read each time, so a big transcript costs one
 * pass, once.
 */
const PICK = [
  'tail -c +"$2" "$1" | head -c "$3"',
  `grep -F -e '${TOOL_MARK}' -e '${PROMPT_MARK}'`,
  `awk '{ if (index($0, "\\"name\\":\\"mcp__ccd_turn__")) print substr($0, 1, 60000); else print substr($0, 1, 2000) }'`,
  'tail -c 3500000',
].join(' | ')

/** One transcript as last read: how far, what it said, and what's known beside it. */
type Seen = { size: number; mtime: number; scan: Scan; cwd: string; title: string }
const seen = new Map<string, Seen>()

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Runs `f` over `xs`, `n` at a time. */
const pool = async <T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(xs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++
        out[i] = await f(xs[i]!)
      }
    }),
  )
  return out
}

/** The type of the subagent whose transcript moved last, within AGENT_LIVE; empty when none. */
const agentOf = async ($: EngineInterface, dir: string, now: number): Promise<string> => {
  const live = (await $.fs.list(`${dir}/subagents`).catch(() => []))
    .filter(x => x.name.endsWith('.jsonl') && now - x.mtimeMs < AGENT_LIVE)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!live) return ''
  try {
    const meta = JSON.parse(await $.fs.read(`${dir}/subagents/${live.name.replace(/\.jsonl$/, '.meta.json')}`))
    return String(meta?.agentType ?? '') || 'agent'
  } catch {
    return 'agent'
  }
}

/** Reads what's new in one transcript (all of it the first time, or when it shrank) into its scan. */
const readOne = async ($: EngineInterface, path: string, size: number, mtime: number): Promise<Seen> => {
  let s = seen.get(path)
  if (s && s.size === size && s.mtime === mtime) return s
  if (!s || size < s.size) s = { size: 0, mtime: 0, scan: emptyScan(), cwd: '', title: '' }
  if (!s.cwd) {
    const run = await $.process.run(['grep', '-m1', '-o', '"cwd":"[^"]*"', path], { timeoutMs: 20_000 }).catch(() => null)
    const m = /"cwd":"([^"]*)"/.exec(run?.stdout ?? '')
    s.cwd = m ? m[1]! : ''
  }
  if (size > s.size) {
    const run = await $.process.run(['sh', '-c', PICK, 'pick', path, String(s.size + 1), String(size - s.size)], { timeoutMs: 60_000 })
    if (run.exitCode !== 0) return s
    for (const line of run.stdout.split('\n')) if (line) scanLine(s.scan, line)
  }
  // The app's own title for the session, when it was given one (named, or renamed in the sidebar).
  const custom = await $.fs
    .read(`${path.replace(/\.jsonl$/, '')}/custom-title.json`)
    .then(t => String(JSON.parse(t)?.customTitle ?? ''))
    .catch(() => '')
  const first = s.scan.firstPrompt
  s.title = custom || (first.length > TITLE_CHARS ? `${first.slice(0, TITLE_CHARS - 1)}…` : first) || path.split('/').pop()!.slice(0, 8)
  s.size = size
  s.mtime = mtime
  seen.set(path, s)
  return s
}

/** Every session active in the last week, read and drawn into `tasksView`. */
const refresh = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const home = (await $.env.get('HOME')) ?? ''
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`
  const root = `${config}/projects`
  const dirs = (await $.fs.list(root).catch(() => null))?.filter(x => x.kind === 'dir') ?? null
  if (!dirs) {
    const note = { at: now, repos: [], needs: [], sessions: 0, note: `No transcripts at ${root}` }
    if (!same(await read($, view), note)) await update($, view, () => note)
    return
  }
  const files = (
    await Promise.all(
      dirs.map(async d =>
        (await $.fs.list(`${root}/${d.name}`).catch(() => []))
          .filter(f => f.kind === 'file' && f.name.endsWith('.jsonl') && now - f.mtimeMs < WEEK)
          .map(f => ({ path: `${root}/${d.name}/${f.name}`, size: f.size, mtime: f.mtimeMs })),
      ),
    )
  ).flat()
  const sessions = await pool(files, AT_ONCE, async f => {
    const s = await readOne($, f.path, f.size, f.mtime).catch(() => null)
    if (!s) return { rows: [] as TaskRow[], repo: '' }
    const id = f.path.split('/').pop()!.replace(/\.jsonl$/, '')
    const agent = now - f.mtime < DAY ? await agentOf($, f.path.replace(/\.jsonl$/, ''), now) : ''
    return { rows: toRows(s.scan, { id, repo: '', title: s.title, agent, at: f.mtime }, now), repo: repoOf(s.cwd, home) || 'elsewhere' }
  })
  // Transcripts gone from the week are forgotten.
  const kept = new Set(files.map(f => f.path))
  for (const p of seen.keys()) if (!kept.has(p)) seen.delete(p)
  const fresh = toView(sessions, now)
  const old = await read($, view)
  // Only the read time moved: leave the state be, so the pane doesn't redraw for nothing.
  if (!old || !same({ ...old, at: 0 }, { ...fresh, at: 0 })) await update($, view, () => fresh)
}

let busy = false
const tick = async ($: EngineInterface, force = false) => {
  if (busy || (!force && !isShown())) return
  busy = true
  try {
    await refresh($)
  } finally {
    busy = false
  }
}

let worker: { cancel: () => void } | undefined
let started = false

/** The tab just drew, so it's on screen: the first draw starts the timer (on a timer of its own, since a drawing writes nothing) and reads at once. */
const drawn = ($: EngineInterface) => {
  if (started) return
  started = true
  $.clock.after(0, () => {
    worker?.cancel()
    worker = $.clock.every(READ_EVERY, () => void tick($).catch(() => undefined))
    void tick($).catch(() => undefined)
  })
}

/** Opens a session in the Claude app. */
const openSession = async ($: EngineInterface, r: TaskRow) => {
  const run = await $.process.run(['open', `claude://claude.ai/epitaxy/local_${r.session}`], { timeoutMs: 10_000 })
  if (run.exitCode !== 0) await $.ui.toast(`${r.title}: could not open the session`)
}

/** Runs `/syn:inbox` once the session is idle; typed as the person's prompt should the command be unknown. */
const inbox = ($: EngineInterface) =>
  void $.command
    .run({ command: 'syn:inbox' })
    .catch(() => $.prompt.submit({ text: '/syn:inbox', asUser: true }))
    .catch(() => $.ui.toast('/syn:inbox: could not send it to the session'))

/**
 * The Tasks tab of the dashboard's pane (`pane`): every session of the last
 * week, one row per task-list item, grouped by repo, with what waits on you on
 * top. Its hooks pass through unless its tab is shown, and it reads the
 * transcripts only then.
 */
export const attach = (on: Parameters<Register>[0], _options: Parameters<Register>[1], pane: string): void => {
  on('command.run', { command: 'tasks' }, async $ => {
    await update($, tab, () => 'tasks')
    await $.ui.open({ id: pane, title: TITLE })
    await tick($, true).catch(() => undefined)

    return { text: 'Tasks tab opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: pane }, async ($, e, next) => {
    if (!isShown()) return next(e)
    drawn($)
    const data = {
      view: await read($, view),
      approvals: (await read($, brain))?.approvals ?? [],
      collapsed: await read($, collapsed),
      now: await $.clock.now(),
    }
    const els = holdButtons($.ui.resolve(e), `${pane}\u0000tasks\u0000${e.surface}`) as unknown as Els
    const rows = e.props.scroll ? Math.max(1, e.props.scroll.bodyRows) : undefined
    return renderTasks(els, e.surface, e.props.bodyColumns, rows, data, {
      toggle: id => void update($, collapsed, c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id])).catch(() => undefined),
      open: r => void openSession($, r).catch(() => $.ui.toast(`${r.title}: could not open the session`)),
      inbox: () => inbox($),
    }, e.props.isFocused)
  })
}

/** `/tasks`: the dashboard registers it as the session starts. */
export const COMMANDS: Command[] = [{ name: 'tasks', description: "Open the dashboard's Tasks tab: every session's task list of the last week, by repo" }]
