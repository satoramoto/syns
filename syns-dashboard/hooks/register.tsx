import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { holdButtons } from '../kit/ui'
import type { AgentRow, PrRow } from '../types'
import { toView } from './brain'
import { render } from './view'
import type { Els } from './view'

const PANE = 'syns-dashboard'
const TITLE = 'syn'

const brain = atom({ plugin: 'syns-dashboard', key: 'brain' } as const, null)
const prs = atom({ plugin: 'syns-dashboard', key: 'prs' } as const, [])
const agents = atom({ plugin: 'syns-dashboard', key: 'agents' } as const, [])
const doing = atom({ plugin: 'syns-dashboard', key: 'doing' } as const, {})
const collapsed = atom({ plugin: 'syns-dashboard', key: 'collapsed' } as const, [])
const columns = atom({ plugin: 'syns-dashboard', key: 'columns' } as const, true)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Runs one of syn's slash commands (`syn:inbox`) as if the person typed it, once
 * the session is idle. `$.prompt.submit` doesn't expand a slash command (the
 * model would read `/syn:inbox` as words), so it's only the fallback, should the
 * command be unknown (the `syn` plugin not loaded).
 */
const ask = ($: EngineInterface, command: string) =>
  void $.command
    .run({ command })
    .catch(() => $.prompt.submit({ text: `/${command}`, asUser: true }))
    .catch(() => $.ui.toast(`/${command}: could not send it to the session`))

// ---- brain.json, read again whenever its mtime moves ----

let brainPath: string | undefined
const pathOf = async ($: EngineInterface) => {
  if (brainPath) return brainPath
  const custom = await $.env.get('SYN_BRAIN')
  const home = await $.env.get('HOME')
  // syns keeps its state in ~/.syns; ~/.claude/brain.json is only a link to it now.
  brainPath = custom || `${home ?? '~'}/.syns/brain.json`
  return brainPath
}

/** Reads brain.json when it changed since the last read (or `force`); writes state only on a real change. */
const readBrain = async ($: EngineInterface, force = false) => {
  const path = await pathOf($)
  const stat = await $.fs.stat(path).catch(() => null)
  const old = await read($, brain)
  if (!stat) {
    const missing = { ...toView('{}', path, 0), error: `No brain state at ${path}` }
    if (!same(old, missing)) await update($, brain, () => missing)
    return
  }
  if (!force && old && !old.error && old.mtime === stat.mtimeMs) return
  const text = await $.fs.read(path)
  const fresh = toView(text, path, stat.mtimeMs)
  if (!same(old, fresh)) await update($, brain, () => fresh)
  if (!same(old?.prs, fresh.prs)) prsStale = true
}

// ---- the PRs brain.json names: their state from gh, read when the list changes, else every few minutes ----

const PR_EVERY = 300_000
let prsStale = true
let prsAt = 0

const readPrs = async ($: EngineInterface) => {
  const refs = (await read($, brain))?.prs ?? []
  prsStale = false
  prsAt = Date.now()
  const rows: PrRow[] = await Promise.all(
    refs.map(async ref => {
      const [repo, n] = ref.split('#')
      try {
        const run = await $.process.run(['gh', 'pr', 'view', n!, '--repo', repo!, '--json', 'state,title'], { timeoutMs: 15_000 })
        if (run.exitCode !== 0) return { ref, state: '', title: '' }
        const j = JSON.parse(run.stdout)
        return { ref, state: String(j.state ?? ''), title: String(j.title ?? '') }
      } catch {
        return { ref, state: '', title: '' }
      }
    }),
  )
  if (!same(await read($, prs), rows)) await update($, prs, () => rows)
}

// ---- live agents ----

const readAgents = async ($: EngineInterface) => {
  const fresh: AgentRow[] = (await $.agent.list()).map(a => ({ id: a.id, description: a.description, type: a.type, status: a.status }))
  if (!same(await read($, agents), fresh)) await update($, agents, () => fresh)
}

/** An agent's tool call in a few words: the tool and its main argument. */
export const describeCall = (tool: string, args: Record<string, unknown>) => {
  const arg = [args.file_path, args.command, args.pattern, args.url, args.query, args.description, args.prompt].find(v => typeof v === 'string') as string | undefined
  const short = arg ? arg.split('\n')[0]!.slice(0, 120) : ''
  return short ? `${tool} ${short}` : tool
}

// ---- work only while the pane is shown ----

let shownAt = 0
let shown = false
const isShown = async ($: EngineInterface) => {
  if (Date.now() - shownAt < 2_000) return shown
  shownAt = Date.now()
  try {
    shown = (await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)
  } catch {
    shown = false
  }
  return shown
}

let busy = false
const tick = async ($: EngineInterface, force = false) => {
  if (busy || (!force && !(await isShown($)))) return
  busy = true
  try {
    await readBrain($, force).catch(() => undefined)
    await readAgents($).catch(() => undefined)
    if (prsStale || Date.now() - prsAt > PR_EVERY) await readPrs($).catch(() => undefined)
  } finally {
    busy = false
  }
}

let worker: { cancel: () => void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dashboard', description: 'Open the syn dashboard: what we are doing, decided, running, what needs you, next' })
    worker?.cancel()
    worker = $.clock.every(2_000, () => void tick($).catch(() => undefined))
    void $.ui.open({ id: PANE, title: TITLE })
    void tick($, true).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async $ => {
    shownAt = 0
    await $.ui.open({ id: PANE, title: TITLE })
    await tick($, true).catch(() => undefined)

    return { text: 'syn dashboard opened.' }
  })

  // A subagent's call, as it starts: what that agent is doing now. Only watching.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const text = describeCall(e.tool, e as unknown as Record<string, unknown>)
      void (async () => {
        if ((await read($, doing))[id] !== text) await update($, doing, all => ({ ...all, [id]: text }))
      })().catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = {
      brain: await read($, brain),
      prs: await read($, prs),
      agents: await read($, agents),
      doing: await read($, doing),
      collapsed: await read($, collapsed),
      now: await $.clock.now(),
    }
    const flowOn = await read($, columns)
    // Buttons keep their press handles across redraws, so a click made just before one still lands.
    const els = holdButtons($.ui.resolve(e), e) as unknown as Els
    return render(els, e.surface, e.props.bodyColumns, e.props.scroll?.bodyRows, data, {
      toggle: id => void update($, collapsed, c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id])).catch(() => undefined),
      inbox: () => ask($, 'syn:inbox'),
      back: () => ask($, 'syn:back'),
      standup: () => ask($, 'syn:standup'),
      flow: { on: flowOn, toggle: () => void update($, columns, was => !was).catch(() => undefined) },
    }, e.props.isFocused)
  })
}
