// Moved from satoramoto/awesome-claude `mods/issues` at 0652eb5; syns source now (the dashboard's Issues tab).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { holdButtons } from '../../kit/ui'

import type { DashTab, Issue, IssueList } from '../../types'
import { type Command, TITLE, shownTab } from '../tabs'
import { REFINED, cursorOf, renderApp, renderTerminal } from './view'
import type { AppElements, TermElements } from './view'

/** How many open issues are read; past this the count shows a "+". */
const LIMIT = 100
const FIELDS = 'number,title,url,author,labels,assignees,comments,updatedAt,closedByPullRequestsReferences'

const list = atom({ plugin: 'syns-dashboard', key: 'issuesList' } as const, null)
const selected = atom({ plugin: 'syns-dashboard', key: 'issuesSelected' } as const, [])
const adding = atom({ plugin: 'syns-dashboard', key: 'issuesAdding' } as const, null)
const reading = atom({ plugin: 'syns-dashboard', key: 'issuesReading' } as const, false)
const cursor = atom({ plugin: 'syns-dashboard', key: 'issuesCursor' } as const, null)
/** Whether a wide app pane flows the tiles into columns; the footer's switch flips it. */
const columns = atom({ plugin: 'syns-dashboard', key: 'issuesColumns' } as const, true)
/** The dashboard's tab shown; `/issues` writes it to open the pane on this tab. */
const tab = atom({ plugin: 'syns-dashboard', key: 'tab' } as const, 'overview' as DashTab)
/** Whether this tab is the one on screen: its reads and hooks wait otherwise. */
const isShown = () => shownTab() === 'issues'
/** Bumped after each add, so the quick-add field is drawn afresh, empty. */
let formKey = 0

const ref = (i: Issue) => `#${i.number} (${i.url})`

/** Refine: the session reads the issue, asks about whatever is unclear, then writes it up and labels it. */
export const refinePrompt = (i: Issue) =>
  [
    `Refine GitHub issue ${ref(i)}: "${i.title}".`,
    `Read it with \`gh issue view ${i.number} --comments\`, then ask me about anything ambiguous or underspecified, one round of questions at a time, until the scope is clear.`,
    `Then rewrite the issue body with the clarified scope and acceptance criteria (\`gh issue edit ${i.number} --body-file <file>\`) and add the label \`${REFINED}\` (\`gh label create ${REFINED} --color 0e8a16\` first if the repository doesn't have it; \`gh issue edit ${i.number} --add-label ${REFINED}\`).`,
  ].join('\n\n')

/** Start: one subagent takes the issue; unrefined, the session asks first whether to refine it. */
export const startPrompt = (i: Issue) => {
  const work = `start on it with a subagent: brief one agent (a lane lead, if this setup has one) with the issue as an outcome, working in its own worktree and branch off the default branch, and report back when it's pushed.`
  const refined = i.labels.some(l => l.name === REFINED)
  return refined
    ? `Start GitHub issue ${ref(i)}: "${i.title}". Read it with \`gh issue view ${i.number} --comments\`, then ${work}`
    : `Start GitHub issue ${ref(i)}: "${i.title}". It isn't labelled \`${REFINED}\` yet: first ask me whether to refine it (clarify what's ambiguous, rewrite it, label it \`${REFINED}\`) or start it as it is. Then do what I pick, and ${work}`
}

/** Sprint: every selected issue at once, in parallel, integrated on one branch for approval. */
export const sprintPrompt = (issues: Issue[], at: number) => {
  const name = `sprint/${new Date(at).toISOString().slice(0, 10)}`
  const unrefined = issues.filter(i => !i.labels.some(l => l.name === REFINED))
  return [
    `Run a sprint on these GitHub issues, in parallel:`,
    issues.map(i => `- ${ref(i)}: "${i.title}"`).join('\n'),
    unrefined.length
      ? `Not labelled \`${REFINED}\` yet: ${unrefined.map(i => `#${i.number}`).join(', ')}. Before starting, ask me whether to refine those first (clarify, rewrite, label \`${REFINED}\`) or take them as they are.`
      : null,
    `Read each with \`gh issue view <n> --comments\`. Then plan them as lanes that own disjoint files, and start one subagent per issue at the same time, each in its own worktree and branch off the default branch, briefed with its issue as an outcome.`,
    `Integrate as they land: keep one integration branch, \`${name}\`, that is the default branch merged with every issue branch, and run the checks there. Fixes go to the issue's own branch, then merge again.`,
    `When every issue is in and the checks pass, push \`${name}\` and open one PR from it for my approval, listing each issue (with "Closes #<n>") and what was decided. Don't turn on auto-merge for it: I'll review and merge it myself.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Hands a request to the session as the person's own prompt; it runs as a turn once the session is free. */
const ask = ($: EngineInterface, text: string, what: string) =>
  void $.prompt.submit({ text, asUser: true }).catch(() => $.ui.toast(`${what}: could not send the request to the session`))

/** Quick add: `gh issue create` with the title, then the list read again. */
const addIssue = async ($: EngineInterface, title: string) => {
  const clean = title.trim()
  if (!clean || (await read($, adding))) return
  await update($, adding, () => clean)
  try {
    const cwd = await $.session.cwd()
    const run = await $.process.run(['gh', 'issue', 'create', '--title', clean, '--body', ''], { cwd, timeoutMs: 30_000 })
    if (run.exitCode !== 0) await $.ui.toast(`New issue: ${ghNote(run.stderr)}`)
  } catch {
    await $.ui.toast('New issue: gh not installed')
  } finally {
    formKey++
    await update($, adding, () => null)
  }
  await refresh($)
}

/** One issue from `gh issue list --json`, as plain data. */
export const toIssue = (json: any): Issue => ({
  number: Number(json.number),
  title: String(json.title ?? ''),
  url: String(json.url ?? ''),
  author: String(json.author?.login ?? ''),
  labels: (json.labels ?? []).map((l: any) => ({ name: String(l.name ?? ''), color: `#${String(l.color ?? '8e8e93')}` })),
  assignees: (json.assignees ?? []).map((a: any) => String(a.login ?? '')),
  comments: Array.isArray(json.comments) ? json.comments.length : Number(json.comments) || 0,
  updatedAt: Date.parse(json.updatedAt) || 0,
  // Filled in from `gh pr list` once every issue is read (the references carry only a number and URL).
  prs: (json.closedByPullRequestsReferences ?? []).map((r: any) => ({
    number: Number(r.number),
    title: '',
    url: String(r.url ?? ''),
    state: '',
    isDraft: false,
    conflicting: false,
    failing: 0,
    pending: 0,
  })),
})

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

/** How many of a PR's checks fail and how many still run, from gh's `statusCheckRollup`. */
export const checksOf = (rollup: any[] | undefined) => {
  let failing = 0
  let pending = 0
  for (const c of rollup ?? []) {
    const verdict = String(c.conclusion ?? c.state ?? '')
    if (FAILED.has(verdict)) failing++
    else if ((c.status && c.status !== 'COMPLETED') || verdict === 'PENDING' || verdict === 'EXPECTED') pending++
  }
  return { failing, pending }
}

/** Fills each linked PR's title and state from one `gh pr list`, by number. */
const withPrs = async (issues: Issue[], gh: (args: string[]) => Promise<{ exitCode: number; stdout: string }>) => {
  if (!issues.some(i => i.prs.length)) return issues
  const run = await gh(['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,url,state,isDraft,mergeable,statusCheckRollup']).catch(() => null)
  if (!run || run.exitCode !== 0) return issues
  let byNumber: Map<number, any>
  try {
    byNumber = new Map((JSON.parse(run.stdout) as any[]).map(p => [Number(p.number), p]))
  } catch {
    return issues
  }
  return issues.map(i => ({
    ...i,
    prs: i.prs.map(pr => {
      const p = byNumber.get(pr.number)
      // A PR in another repository isn't in this list: it keeps its number and URL alone.
      if (!p || p.url !== pr.url) return pr
      return { ...pr, title: String(p.title ?? ''), state: String(p.state ?? ''), isDraft: Boolean(p.isDraft), conflicting: p.mergeable === 'CONFLICTING', ...checksOf(p.statusCheckRollup) }
    }),
  }))
}

/** `owner/name` from an issue's URL. */
export const repoOf = (url: string) => /github\.com\/([^/]+\/[^/]+)\//.exec(url)?.[1] ?? ''

/** A one-line reason from gh's stderr. */
export const ghNote = (stderr: string): string => {
  if (/auth login|not logged|authenticat/i.test(stderr)) return 'gh not authenticated (run gh auth login)'
  if (/no git remote|none of the git remotes|not a git/i.test(stderr)) return 'No GitHub repository for this session'
  if (/disabled issues|has issues disabled/i.test(stderr)) return 'Issues are turned off for this repository'
  return (stderr.trim().split('\n')[0] || 'gh failed').slice(0, 120)
}

/** The session's repository's open issues, newest change first. */
const loadIssues = async ($: EngineInterface): Promise<IssueList> => {
  // The engine's clock, as the render hook's: the figures' age reads against the same time.
  const at = await $.clock.now()
  const cwd = await $.session.cwd()
  const gh = (args: string[]) => $.process.run(['gh', ...args], { cwd, timeoutMs: 20_000 })
  let run
  try {
    run = await gh(['issue', 'list', '--state', 'open', '--limit', String(LIMIT + 1), '--json', FIELDS])
  } catch {
    return { repo: '', issues: [], more: false, at, note: 'gh not installed' }
  }
  if (run.exitCode !== 0) return { repo: '', issues: [], more: false, at, note: ghNote(run.stderr) }
  let issues: Issue[]
  try {
    issues = (JSON.parse(run.stdout) as any[]).map(toIssue).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return { repo: '', issues: [], more: false, at, note: 'Unreadable gh output' }
  }
  // With no issue to read it from, the repository's name takes a call of its own.
  let repo = repoOf(issues[0]?.url ?? '')
  if (!repo) {
    const view = await gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).catch(() => null)
    repo = view?.exitCode === 0 ? view.stdout.trim() : ''
  }
  return { repo, issues: await withPrs(issues.slice(0, LIMIT), gh), more: issues.length > LIMIT, at }
}

// Nothing runs while the tab isn't shown: a timer, started on the tab's first
// draw, reads gh again while it is, every READ_EVERY, or within AT_MOST once
// something marked the list stale.
const READ_EVERY = 120_000
const AT_MOST = 20_000
let stale = true
let lastRead = 0
let busy = false

const refresh = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    stale = false
    lastRead = Date.now()
    // The header says a read is under way (and how old the figures it keeps are).
    await update($, reading, () => true)
    const fresh = await loadIssues($)
    const old = await read($, list)
    // A failed read keeps the last-good issues, marked with why; only the first read's failure is a note.
    const next = fresh.note && old && !old.note ? { ...old, failed: fresh.note } : fresh
    await update($, list, () => next)
  } finally {
    busy = false
    await update($, reading, () => false).catch(() => undefined)
  }
}

const tick = async ($: EngineInterface) => {
  if (!isShown()) return
  if (Date.now() - lastRead >= (stale ? AT_MOST : READ_EVERY)) await refresh($)
}

let worker: { cancel: () => void } | undefined
let started = false

/**
 * The tab just drew, so it's on screen. The first draw starts the timer, on a
 * timer of its own since a drawing writes nothing, and reads at once.
 */
const drawn = ($: EngineInterface) => {
  if (started) return
  started = true
  $.clock.after(0, () => {
    worker?.cancel()
    worker = $.clock.every(5_000, () => void tick($).catch(() => undefined))
    void tick($).catch(() => undefined)
  })
}

/**
 * The Issues tab of the dashboard's pane (`pane`): the session's repository's
 * open GitHub issues. Its hooks pass through unless its tab is shown, and it
 * reads gh only then. Returns its slash command, for the dashboard to register.
 */
export const attach = (on: Parameters<Register>[0], _options: Parameters<Register>[1], pane: string): void => {
  on('command.run', { command: 'syn-issues' }, async $ => {
    // Opened by the person on this tab: read now rather than on the next tick.
    // The pane is open (drawing "Reading issues…") while gh runs; awaited, so
    // the command settles with the list in state.
    await update($, tab, () => 'issues')
    await $.ui.open({ id: pane, title: TITLE })
    await refresh($).catch(() => undefined)

    return { text: 'Issues tab opened.' }
  })

  // A gh issue command (opening, closing, commenting) changes the list: read it again soon.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgh issue\b/.test(e.command)) stale = true

    return ran
    // Only watching: should it fail, the call goes on as if it weren't here.
  }).catch(($, e, next) => next(e))

  // The terminal's cursor is the issue whose row holds the focus ring: the
  // arrows and Tab walk the rows' marks, and the row under the ring is drawn selected.
  on('ui.focus', { component: 'Pane', requestId: pane }, async ($, e, next) => {
    if (!isShown()) return next(e)
    const result = await next(e)
    const n = cursorOf(e.element)
    if (n !== null) await update($, cursor, () => n).catch(() => undefined)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: pane }, async ($, e, next) => {
    if (!isShown()) return next(e)
    drawn($)
    const data = await read($, list)
    // The engine's clock, so ages read the same time a test holds still.
    const at = await $.clock.now()
    // Buttons keep their press handles across redraws, so a click made just before one
    // still lands; a scope of its own, as the dashboard's render holds its tab row's.
    const els = holdButtons($.ui.resolve(e), `${pane}\u0000issues\u0000${e.surface}`)
    if (e.surface === 'terminal') {
      const shown = { reading: await read($, reading), cursor: await read($, cursor) }
      return renderTerminal(els as TermElements, data, e.props.bodyColumns, at, {
        focused: e.props.isFocused,
        ...shown,
        start: issue => ask($, startPrompt(issue), 'Start'),
      })
    }
    const picked = await read($, selected)
    const form = await read($, adding)
    const columnsOn = await read($, columns)
    const pick = (n: number) => update($, selected, s => (s.includes(n) ? s.filter(x => x !== n) : [...s, n]))
    return renderApp(els as AppElements, data, e.props.bodyColumns, at, {
      add: title => void addIssue($, title).catch(() => undefined),
      refine: issue => ask($, refinePrompt(issue), 'Refine'),
      start: issue => ask($, startPrompt(issue), 'Start'),
      toggle: issue => void pick(issue.number).catch(() => undefined),
      clear: () => void update($, selected, () => []).catch(() => undefined),
      sprint: () =>
        void (async () => {
          const chosen = (data?.issues ?? []).filter(i => picked.includes(i.number))
          if (!chosen.length) return
          ask($, sprintPrompt(chosen, Date.now()), 'Sprint')
          await update($, selected, () => [])
        })().catch(() => undefined),
      selected: picked,
      adding: form,
      formKey,
      flow: { on: columnsOn, toggle: () => void update($, columns, was => !was).catch(() => undefined) },
    })
  })

}

/** `/issues`: the dashboard registers it as the session starts. */
export const COMMANDS: Command[] = [{ name: 'syn-issues', description: "Open the dashboard's Issues tab: the open GitHub issues of this session's repository" }]
