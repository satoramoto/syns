import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { holdButtons, kit } from '../kit/ui'
import type { AgentRow, BandOpen, DashTab, EpicRow, PrCi, PrRow } from '../types'
import { band } from './band'
import { ignoredOf, toView, updateText } from './brain'
import { toSnap } from './context'
import { openInbox, sortEpics, toEpic } from './epics'
import { attach, hideTree } from './filetree/register'
import { render } from './view'
import type { Els } from './view'

const PANE = 'syns-dashboard'
const TITLE = 'syn'

const brain = atom({ plugin: 'syns-dashboard', key: 'brain' } as const, null)
const prs = atom({ plugin: 'syns-dashboard', key: 'prs' } as const, [])
const epics = atom({ plugin: 'syns-dashboard', key: 'epics' } as const, null as EpicRow[] | null)
const agents = atom({ plugin: 'syns-dashboard', key: 'agents' } as const, [])
const doing = atom({ plugin: 'syns-dashboard', key: 'doing' } as const, {})
const collapsed = atom({ plugin: 'syns-dashboard', key: 'collapsed' } as const, [])
const columns = atom({ plugin: 'syns-dashboard', key: 'columns' } as const, true)
const bandOpen = atom({ plugin: 'syns-dashboard', key: 'bandOpen' } as const, null as BandOpen)
const context = atom({ plugin: 'syns-dashboard', key: 'context' } as const, null)
const tab = atom({ plugin: 'syns-dashboard', key: 'tab' } as const, 'overview' as DashTab)
const ignoredOpen = atom({ plugin: 'syns-dashboard', key: 'ignoredOpen' } as const, false)
const unfolded = atom({ plugin: 'syns-dashboard', key: 'unfolded' } as const, [] as string[])
const prMenu = atom({ plugin: 'syns-dashboard', key: 'prMenu' } as const, null as string | null)
const mergeConfirm = atom({ plugin: 'syns-dashboard', key: 'mergeConfirm' } as const, null as string | null)

/** How long Merge waits for its confirming press. */
const CONFIRM_MS = 5_000

/** The pane's tabs, in order. */
const TABS: { id: DashTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'Files' },
]
/** The rows the tab row takes above a tab's body (its row and the room under it). */
const TAB_ROWS = 2

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The context window's categories, for the band's bar; read at start and whenever the fill moves. */
const readContext = async ($: EngineInterface) => {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (!b) return
  const fresh = toSnap(b)
  if (!same(await read($, context), fresh)) await update($, context, () => fresh)
}

/**
 * Runs one of syn's slash commands (`syn:inbox`) as if the person typed it, once
 * the session is idle. `$.prompt.submit` doesn't expand a slash command (the
 * model would read `/syn:inbox` as words), so it's only the fallback, should the
 * command be unknown (the `syn` plugin not loaded).
 */
const ask = ($: EngineInterface, command: string, args = '') => {
  const typed = `/${command}${args ? ` ${args}` : ''}`
  void $.command
    .run({ command, ...(args ? { args } : {}) })
    .catch(() => $.prompt.submit({ text: typed, asUser: true }))
    .catch(() => $.ui.toast(`${typed}: could not send it to the session`))
}

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

// ---- epics: <brain.json's folder>/epics/*/epic.json, read again when any of them (or brain.json, for open questions) moves ----

/** The mtimes the epics were last read at (brain.json's, then each folder's epic.json), as one string. */
let epicsStamp = ''

const readEpics = async ($: EngineInterface) => {
  const brainFile = await pathOf($)
  const dir = `${brainFile.slice(0, brainFile.lastIndexOf('/'))}/epics`
  // A folder, or a link to one: the file under it says whether it's an epic.
  const entries = (await $.fs.list(dir).catch(() => [])).filter(x => x.kind === 'dir' || x.isLink).map(x => x.name).sort()
  const files = (
    await Promise.all(
      entries.map(async name => {
        const path = `${dir}/${name}/epic.json`
        const stat = await $.fs.stat(path).catch(() => null)
        return stat && stat.kind === 'file' ? { name, path, mtime: stat.mtimeMs } : null
      }),
    )
  ).filter(f => f !== null)
  const brainStat = await $.fs.stat(brainFile).catch(() => null)
  const stamp = JSON.stringify([brainStat?.mtimeMs ?? 0, files.map(f => [f.name, f.mtime])])
  const old = await read($, epics)
  if (old && stamp === epicsStamp) return
  epicsStamp = stamp
  const open = brainStat ? openInbox(await $.fs.read(brainFile).catch(() => '')) : null
  const rows = sortEpics(await Promise.all(files.map(async f => toEpic(await $.fs.read(f.path).catch(() => ''), f.name, open))))
  if (!same(old, rows)) await update($, epics, () => rows)
}

/**
 * Opens a URL in the browser or a file in its app, with macOS's `open`; a path
 * starting with `~` is taken from the home folder. `what` names it in the toast
 * should it fail.
 */
const openTarget = async ($: EngineInterface, target: string, what: string) => {
  if (!target) return
  const home = target === '~' || target.startsWith('~/') ? await $.env.get('HOME') : undefined
  const path = home ? `${home}${target.slice(1)}` : target
  const run = await $.process.run(['open', path], { timeoutMs: 10_000 })
  if (run.exitCode !== 0) await $.ui.toast(`${what}: could not open it (${(run.stderr || '').trim().split('\n').pop() || `open exited ${run.exitCode}`})`)
}

// ---- PRs: Ryan's open ones updated this week, plus any brain.json names, with CI; read when brain's list changes, else every few minutes ----

const PR_EVERY = 300_000
let prsStale = true
let prsAt = 0

/** A PR's CI from the checks' rollup state (`SUCCESS`, `FAILURE`, ...) and mergeability; a conflict wins. */
const ciOf = (rollup: string, mergeable: string): PrCi =>
  mergeable === 'CONFLICTING'
    ? 'conflicting'
    : rollup === 'SUCCESS'
      ? 'passing'
      : rollup === 'FAILURE' || rollup === 'ERROR'
        ? 'failing'
        : rollup === 'PENDING' || rollup === 'EXPECTED'
          ? 'pending'
          : ''

/** The rollup state of `gh pr view`'s `statusCheckRollup` list (check runs and statuses). */
const rollupOf = (checks: any[]): string => {
  if (!Array.isArray(checks) || !checks.length) return ''
  const bad = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
  if (checks.some(c => bad.has(String(c.conclusion ?? c.state ?? '')))) return 'FAILURE'
  if (checks.some(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')) return 'PENDING'
  return 'SUCCESS'
}

const MINE_QUERY =
  'query($q:String!){search(query:$q,type:ISSUE,first:50){nodes{... on PullRequest{number title url state isDraft mergeable autoMergeRequest{enabledAt} repository{nameWithOwner viewerDefaultMergeMethod} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}'

/** How far back Ryan's own PRs are listed: those not updated in this many days fall off. */
const MINE_DAYS = 7

/** Ryan's open PRs updated in the last MINE_DAYS days, in one GraphQL search: title, link, CI and mergeability. */
const readMine = async ($: EngineInterface): Promise<PrRow[]> => {
  const since = new Date(Date.now() - MINE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const run = await $.process.run(['gh', 'api', 'graphql', '-f', `q=is:pr is:open author:@me archived:false updated:>=${since}`, '-f', `query=${MINE_QUERY}`], { timeoutMs: 20_000 })
  if (run.exitCode !== 0) return []
  const nodes: any[] = JSON.parse(run.stdout)?.data?.search?.nodes ?? []
  return nodes
    .filter(p => p && p.number)
    .map(p => ({
      ref: `${p.repository?.nameWithOwner ?? ''}#${p.number}`,
      state: String(p.state ?? ''),
      title: String(p.title ?? ''),
      url: String(p.url ?? ''),
      ci: ciOf(String(p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? ''), String(p.mergeable ?? '')),
      draft: Boolean(p.isDraft),
      method: String(p.repository?.viewerDefaultMergeMethod ?? ''),
      auto: Boolean(p.autoMergeRequest),
    }))
}

/** One PR brain.json names that the search didn't find (someone else's, or closed). */
const readOne = async ($: EngineInterface, ref: string): Promise<PrRow> => {
  const [repo, n] = ref.split('#')
  // `gh pr view` has no repo default merge method: these merge with the fallback (squash).
  const none: PrRow = { ref, state: '', title: '', url: '', ci: '', draft: false, method: '', auto: false }
  try {
    const run = await $.process.run(['gh', 'pr', 'view', n!, '--repo', repo!, '--json', 'state,title,url,isDraft,mergeable,statusCheckRollup,autoMergeRequest'], { timeoutMs: 15_000 })
    if (run.exitCode !== 0) return none
    const j = JSON.parse(run.stdout)
    return { ref, state: String(j.state ?? ''), title: String(j.title ?? ''), url: String(j.url ?? ''), ci: ciOf(rollupOf(j.statusCheckRollup), String(j.mergeable ?? '')), draft: Boolean(j.isDraft), method: '', auto: Boolean(j.autoMergeRequest) }
  } catch {
    return none
  }
}

const readPrs = async ($: EngineInterface) => {
  const refs = (await read($, brain))?.prs ?? []
  prsStale = false
  prsAt = Date.now()
  const mine = await readMine($).catch(() => [] as PrRow[])
  const extra = await Promise.all(refs.filter(r => !mine.some(m => m.ref === r)).map(r => readOne($, r)))
  const rows = [...mine, ...extra]
  if (!same(await read($, prs), rows)) await update($, prs, () => rows)
}

/** `gh pr merge`'s flag for a repo's default merge method; squash when unknown. */
const methodFlag = (method: string) => (method === 'MERGE' ? '--merge' : method === 'REBASE' ? '--rebase' : '--squash')

/**
 * Merges a PR now (`merge`), turns auto-merge on (`auto`) or off (`disable-auto`) with gh,
 * toasts how it went (gh's error when it failed), and has the PRs read again at once.
 */
const mergePr = async ($: EngineInterface, p: PrRow, how: 'merge' | 'auto' | 'disable-auto') => {
  const [repo, n] = p.ref.split('#')
  const args = how === 'disable-auto' ? ['--disable-auto'] : how === 'auto' ? ['--auto', methodFlag(p.method)] : [methodFlag(p.method)]
  const done = { merge: `Merged ${p.ref}`, auto: `Auto-merge on for ${p.ref}`, 'disable-auto': `Auto-merge off for ${p.ref}` }[how]
  try {
    const run = await $.process.run(['gh', 'pr', 'merge', n!, '--repo', repo!, ...args], { timeoutMs: 30_000 })
    const err = (run.stderr || run.stdout || '').trim().split('\n').pop() ?? ''
    await $.ui.toast(run.exitCode === 0 ? done : `${p.ref}: ${err || `gh exited ${run.exitCode}`}`)
  } catch (e) {
    await $.ui.toast(`${p.ref}: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
  }
  prsStale = true
  await readPrs($).catch(() => undefined)
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

// ---- the Files tab: filetree's tree, read and watched only while it's on screen ----

/*
 * filetree's hooks (`attach`, in register below) draw the tree under this pane's
 * render and read nothing until it first draws there; drawing it is what puts it
 * on screen. The dashboard tells it only when it goes off screen (another tab
 * chosen, the pane hidden), and then its hooks pass through. A folder pushed
 * later (breadcrumbs) is filetree's `pinTree(path)`: the tree shows it from its
 * next draw.
 */
let filesDrawn = false
const filesOff = () => {
  if (!filesDrawn) return
  filesDrawn = false
  hideTree()
}

let busy = false
const tick = async ($: EngineInterface, force = false) => {
  if (busy) return
  if (!force && !(await isShown($))) {
    filesOff()
    return
  }
  busy = true
  try {
    // brain.json itself is read by its own timer (brainWorker), for the band and the pane alike.
    if (force) await readBrain($, true).catch(() => undefined)
    await readAgents($).catch(() => undefined)
    await readEpics($).catch(() => undefined)
    if (prsStale || Date.now() - prsAt > PR_EVERY) await readPrs($).catch(() => undefined)
  } finally {
    busy = false
  }
}

let worker: { cancel: () => void } | undefined

// ---- the band above the prompt: brain.json (one read, shared with the pane) every 2 s ----

let brainWorker: { cancel: () => void } | undefined

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

/**
 * Adds `value` to (`ignore`) or removes it from brain.json's `ignored[list]`, then
 * reads the file again. As `dismissUpdate`: the file is read fresh right before the
 * write, and only `ignored` changes. `ignored.prs` is tidied on the way, from the PR
 * data already read (no extra gh calls): refs gh says are merged or closed, and refs
 * an ignored repo already covers, are dropped.
 */
const setIgnored = async ($: EngineInterface, list: 'repos' | 'prs', value: string, ignore: boolean) => {
  const path = await pathOf($)
  const d = JSON.parse(await $.fs.read(path))
  if (!d || typeof d !== 'object') return
  const ig = ignoredOf(d.ignored)
  ig[list] = ignore ? (ig[list].includes(value) ? ig[list] : [...ig[list], value]) : ig[list].filter(x => x !== value)
  const rows = await read($, prs)
  const gone = new Set(rows.filter(p => p.state === 'MERGED' || p.state === 'CLOSED').map(p => p.ref))
  ig.prs = ig.prs.filter(r => !gone.has(r) && !ig.repos.includes(r.split('#')[0] ?? r))
  d.ignored = { ...(d.ignored && typeof d.ignored === 'object' ? d.ignored : {}), repos: ig.repos, prs: ig.prs }
  await $.fs.write(path, `${JSON.stringify(d, null, 2)}\n`)
  await readBrain($, true)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dashboard', description: 'Open the syn dashboard: what we are doing, decided, running, what needs you, next' })
    worker?.cancel()
    worker = $.clock.every(2_000, () => void tick($).catch(() => undefined))
    brainWorker?.cancel()
    brainWorker = $.clock.every(2_000, () => void readBrain($).catch(() => undefined))
    void $.ui.open({ id: PANE, title: TITLE })
    void tick($, true).catch(() => undefined)
    void readContext($).catch(() => undefined)

    return next(e)
  })

  // The band's context bar: pushed after each turn, no polling.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) await readContext($).catch(() => undefined)
    return result
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

  // The band above the prompt: what needs Ryan (approvals, questions, updates), each a press.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const data = { brain: await read($, brain), open: await read($, bandOpen), context: await read($, context) }
    const els = holdButtons($.ui.resolve(e), `AbovePrompt\u0000${e.surface}`) as unknown as Els
    const tree = band(els, e.surface, e.props.bodyColumns, data, {
      inbox: () => ask($, 'syn:inbox'),
      toggle: open => void update($, bandOpen, was => (was === open ? null : open)).catch(() => undefined),
      dismiss: text => void dismissUpdate($, text).catch(() => $.ui.toast('Could not dismiss that update in brain.json')),
      standup: () => ask($, 'syn:standup'),
    })
    return tree
  })

  // The pane: the tab row, then the tab shown. Registered before filetree's hooks
  // (`attach`, below), so this render is the outer one and `next` draws the tree.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const shown = await read($, tab)
    const select = (id: string) => {
      const chosen: DashTab = id === 'files' ? 'files' : 'overview'
      if (chosen !== 'files') filesOff()
      void update($, tab, () => chosen).catch(() => undefined)
    }
    // The rows under the tab row, for the tab's body.
    const scroll = e.props.scroll
    const rows = scroll ? Math.max(1, scroll.bodyRows - TAB_ROWS) : undefined
    /** The tab row over a tab's body. */
    const tabbed = (els: Els, body: RenderElement) => {
      const { Box } = els
      const k = kit(els as any, e.surface, e.props.bodyColumns, { focused: e.props.isFocused })
      return (
        <Box flexDirection="column" flexGrow={1} minWidth={0}>
          {k.tabs('tabs', TABS, shown, select)}
          {body}
        </Box>
      )
    }

    if (shown === 'files') {
      if (e.surface !== 'terminal' && e.surface !== 'desktop') {
        const els = holdButtons($.ui.resolve(e), e) as unknown as Els
        const k = kit(els as any, e.surface, e.props.bodyColumns)
        return tabbed(els, k.note('files-surface', 'Files shows on the desktop and the terminal.'))
      }
      // filetree draws the tree in the rows under the tab row.
      filesDrawn = true
      const tree = await next(scroll && rows !== undefined ? { ...e, props: { ...e.props, scroll: { ...scroll, bodyRows: rows } } } : e)
      return tabbed(holdButtons($.ui.resolve(e), e) as unknown as Els, tree)
    }

    const data = {
      brain: await read($, brain),
      prs: await read($, prs),
      epics: await read($, epics),
      agents: await read($, agents),
      doing: await read($, doing),
      collapsed: await read($, collapsed),
      ignoredOpen: await read($, ignoredOpen),
      unfolded: await read($, unfolded),
      prMenu: await read($, prMenu),
      mergeConfirm: await read($, mergeConfirm),
      now: await $.clock.now(),
    }
    const flowOn = await read($, columns)
    // Buttons keep their press handles across redraws, so a click made just before one still lands.
    const els = holdButtons($.ui.resolve(e), e) as unknown as Els
    return tabbed(
      els,
      render(els, e.surface, e.props.bodyColumns, rows, data, {
        toggle: id => void update($, collapsed, c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id])).catch(() => undefined),
        inbox: () => ask($, 'syn:inbox'),
        back: () => ask($, 'syn:back'),
        standup: () => ask($, 'syn:standup'),
        openEpic: p => void openTarget($, p.page, `${p.id}'s page`).catch(() => $.ui.toast(`${p.id}: could not open its page`)),
        openProof: (p, promise) => void openTarget($, promise.proof, `${p.id} ${promise.id}'s proof`).catch(() => $.ui.toast(`${p.id} ${promise.id}: could not open its proof`)),
        review: p => ask($, 'syn:review', p.id),
        ignore: (list, value, ignore) => void setIgnored($, list, value, ignore).catch(() => $.ui.toast('Could not change ignored in brain.json')),
        showIgnored: () => void update($, ignoredOpen, was => !was).catch(() => undefined),
        // Opening or closing a menu clears a pending merge confirm.
        menu: ref =>
          void (async () => {
            await update($, prMenu, was => (was === ref ? null : ref))
            if (await read($, mergeConfirm)) await update($, mergeConfirm, () => null)
          })().catch(() => undefined),
        merge: (p, how) => {
          if (how === 'confirm') {
            void update($, mergeConfirm, () => p.ref).catch(() => undefined)
            $.clock.after(CONFIRM_MS, () => void update($, mergeConfirm, was => (was === p.ref ? null : was)).catch(() => undefined))
            return
          }
          void (async () => {
            if (how === 'merge') await update($, mergeConfirm, () => null)
            await mergePr($, p, how)
          })().catch(() => undefined)
        },
        unfold: id => void update($, unfolded, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])).catch(() => undefined),
        flow: { on: flowOn, toggle: () => void update($, columns, was => !was).catch(() => undefined) },
      }, e.props.isFocused),
    )
  })

  // The Files tab: filetree's hooks (see build.ts), drawing under the render above and reading only while the tab is on screen.
  attach(on, options, PANE)
}
