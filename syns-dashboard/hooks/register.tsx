import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { holdButtons } from '../kit/ui'
import type { AgentRow, BandOpen, CiRow, PrRow } from '../types'
import { band } from './band'
import { toView, updateText } from './brain'
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
const failing = atom({ plugin: 'syns-dashboard', key: 'failing' } as const, [] as CiRow[])
const bandOpen = atom({ plugin: 'syns-dashboard', key: 'bandOpen' } as const, null as BandOpen)

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
    // brain.json itself is read by its own timer (brainWorker), for the band and the pane alike.
    if (force) await readBrain($, true).catch(() => undefined)
    await readAgents($).catch(() => undefined)
    if (prsStale || Date.now() - prsAt > PR_EVERY) await readPrs($).catch(() => undefined)
  } finally {
    busy = false
  }
}

let worker: { cancel: () => void } | undefined

// ---- the band above the prompt: brain.json (one read, shared with the pane) every 2 s, failing CI every few minutes ----

let brainWorker: { cancel: () => void } | undefined
let ciWorker: { cancel: () => void } | undefined

const CI_EVERY = 300_000

/** Ryan's open PRs whose checks fail, as gh's search finds them. */
const readFailing = async ($: EngineInterface) => {
  const run = await $.process.run(
    ['gh', 'search', 'prs', '--author', '@me', '--state', 'open', '--checks', 'failure', '--json', 'repository,number,title,url', '--limit', '20'],
    { timeoutMs: 20_000 },
  )
  // gh failed (offline, signed out): show nothing rather than a stale list.
  if (run.exitCode !== 0) {
    if ((await read($, failing)).length) await update($, failing, () => [])
    return
  }
  const rows: CiRow[] = (JSON.parse(run.stdout) as any[]).map(p => ({
    ref: `${p.repository?.nameWithOwner ?? ''}#${p.number}`,
    title: String(p.title ?? ''),
    url: String(p.url ?? ''),
  }))
  if (!same(await read($, failing), rows)) await update($, failing, () => rows)
}

/**
 * Removes the first entry of brain.json's `updates` whose content reads as `text`,
 * then reads the file again for the band and pane. The file is read fresh from disk
 * right before the write (never the cached view), so edits made since the last
 * 2 s read survive. Not atomic: `$.fs` has no rename, so no temp-file-and-rename.
 */
const dismissUpdate = async ($: EngineInterface, text: string) => {
  const path = await pathOf($)
  const d = JSON.parse(await $.fs.read(path))
  if (!d || !Array.isArray(d.updates)) return
  const i = d.updates.findIndex((u: unknown) => u != null && updateText(u) === text)
  if (i < 0) return
  d.updates.splice(i, 1)
  await $.fs.write(path, `${JSON.stringify(d, null, 2)}\n`)
  await readBrain($, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dashboard', description: 'Open the syn dashboard: what we are doing, decided, running, what needs you, next' })
    worker?.cancel()
    worker = $.clock.every(2_000, () => void tick($).catch(() => undefined))
    brainWorker?.cancel()
    brainWorker = $.clock.every(2_000, () => void readBrain($).catch(() => undefined))
    ciWorker?.cancel()
    ciWorker = $.clock.every(CI_EVERY, () => void readFailing($).catch(() => undefined))
    void readFailing($).catch(() => undefined)
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

  // The band above the prompt: what needs Ryan (approvals, questions, failing CI, updates), each a press.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const data = { brain: await read($, brain), failing: await read($, failing), open: await read($, bandOpen) }
    const els = holdButtons($.ui.resolve(e), `AbovePrompt\u0000${e.surface}`) as unknown as Els
    const tree = band(els, e.surface, e.props.bodyColumns, data, {
      inbox: () => ask($, 'syn:inbox'),
      toggle: open => void update($, bandOpen, was => (was === open ? null : open)).catch(() => undefined),
      dismiss: text => void dismissUpdate($, text).catch(() => $.ui.toast('Could not dismiss that update in brain.json')),
    })
    return tree ?? next(e)
  })

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
