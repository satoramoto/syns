// Moved from satoramoto/awesome-claude `mods/overview` at 0652eb5; syns source now (the dashboard's Session tab).
import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  ModelUsage,
  ProcessRunResult,
  Register,
  SessionContextBreakdown,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import type {
  BranchView,
  DashTab,
  GhInfo,
  GitFile,
  GitInfo,
  GitNote,
  GitPr,
  Item,
  Limit,
  Segment,
  SessionActivity,
  Snapshot,
  Tracked,
  TurnPoint,
  WorkspacesGh,
} from '../../types'
import { parseLeftRight, startedBy } from './branches'
import { createPerf } from '../../kit/perf'
import { holdButtons } from '../../kit/ui'

import { type Command, TITLE, shownTab } from '../tabs'
import { renderDesktop } from './desktop'
import type { AppElements, DesktopData, Helpers } from './desktop'
import { renderTerminal } from './terminal'
import type { TermElements, TermHelpers } from './terminal'
import { NETTOP, NET_PER_PROCESS, resourcesSh, takeNettop, toResources } from './resources'

/** The dashboard's pane this tab draws in; set by `attach`. */
let PANE = 'syns-dashboard'
/** This tab's id in the dashboard's tab state. */
const MINE: DashTab = 'session'
const snapshot = atom({ plugin: 'syns-dashboard', key: 'sessionSnapshot' } as const, null)
const now = atom({ plugin: 'syns-dashboard', key: 'sessionNow' } as const, 0)
const resources = atom({ plugin: 'syns-dashboard', key: 'sessionResources' } as const, null)
const tab = atom({ plugin: 'syns-dashboard', key: 'tab' } as const, 'overview' as DashTab)

/** Whether the Session tab is the one on screen: every read waits for it. */
const isShown = () => shownTab() === MINE

// One hue per used category, in the order /context lists them.
export const PALETTE = ['#7aa2f7', '#bb9af7', '#7dcfff', '#9ece6a', '#e0af68', '#f7768e', '#ff9e64', '#2ac3de']
const DETAIL_ITEMS = 5

export const formatTokens = (n: number): string => {
  if (n >= 999_500) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${trim(n / 1_000)}k`
  return String(Math.round(n))
}

const trim = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''))

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

const top = (items: Item[]) => [...items].sort((a, b) => b.tokens - a.tokens).slice(0, DETAIL_ITEMS)

/** The breakdown as the band keeps it: used rows first, then free space, then the compaction buffer. */
export const toSnapshot = (b: SessionContextBreakdown): Snapshot => {
  const rows = b.categories.filter(c => c.kind !== 'deferred')
  const order = { used: 0, free: 1, buffer: 2, deferred: 3 }
  const segments: Segment[] = rows
    .map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind }))
    .sort((x, y) => order[x.kind] - order[y.kind])

  const servers = new Map<string, number>()
  for (const tool of b.mcpTools) {
    if (tool.isLoaded) servers.set(tool.serverName, (servers.get(tool.serverName) ?? 0) + tool.tokens)
  }

  return {
    model: b.model,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    percent: b.percentage,
    ...(b.isAutoCompactEnabled && b.autoCompactThreshold ? { compactAt: b.autoCompactThreshold } : {}),
    segments,
    memory: top(b.memoryFiles.map(f => ({ label: `${basename(f.path)} (${f.type})`, tokens: f.tokens }))),
    mcp: top([...servers].map(([label, tokens]) => ({ label, tokens }))),
    skills: top((b.skills?.skillFrontmatter ?? []).map(s => ({ label: s.name, tokens: s.tokens }))),
    agents: top(b.agents.map(a => ({ label: a.agentType, tokens: a.tokens }))),
  }
}

export const colorOf = (segments: Segment[], i: number): string | undefined => {
  const s = segments[i]
  if (!s || s.kind !== 'used') return undefined
  const used = segments.slice(0, i).filter(x => x.kind === 'used').length
  return PALETTE[used % PALETTE.length]
}

// ---- Git section ---------------------------------------------------------

const git = atom({ plugin: 'syns-dashboard', key: 'sessionGit' } as const, null)
const gh = atom({ plugin: 'syns-dashboard', key: 'sessionGh' } as const, null)
const GIT_FILES = 4

type Parsed = Omit<GitInfo, 'ok' | 'root' | 'repo' | 'worktree' | 'insertions' | 'deletions'>

const fileOf = (xy: string, path: string, renamed = false): GitFile => {
  const x = xy[0] ?? '.'
  const y = xy[1] ?? '.'
  const kind: GitFile['kind'] = renamed
    ? 'renamed'
    : x === 'A'
      ? 'added'
      : x === 'D' || y === 'D'
        ? 'deleted'
        : 'modified'
  return { path, kind, staged: x !== '.' && y === '.' }
}

/** `git status --porcelain=v2 --branch`, counted and listed. */
export const parseStatus = (text: string): Parsed => {
  const out: Parsed = {
    branch: '',
    detached: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    files: [],
    fileCount: 0,
  }
  let oid = ''
  for (const line of text.split('\n')) {
    if (!line) continue
    const parts = line.split(' ')
    if (line.startsWith('# branch.oid ')) oid = parts[2] ?? ''
    else if (line.startsWith('# branch.head ')) out.branch = parts.slice(2).join(' ')
    else if (line.startsWith('# branch.upstream ')) out.upstream = parts.slice(2).join(' ')
    else if (line.startsWith('# branch.ab ')) {
      out.ahead = Math.abs(Number(parts[2]) || 0)
      out.behind = Math.abs(Number(parts[3]) || 0)
    } else if (parts[0] === '1' || parts[0] === '2') {
      const xy = parts[1] ?? '..'
      if (xy[0] !== '.') out.staged++
      if (xy[1] !== '.') out.modified++
      const path = parts[0] === '1' ? parts.slice(8).join(' ') : (parts.slice(9).join(' ').split('\t')[0] ?? '')
      out.files.push(fileOf(xy, path, parts[0] === '2'))
    } else if (parts[0] === 'u') {
      out.conflicted++
      out.files.push({ path: parts.slice(10).join(' '), kind: 'conflict', staged: false })
    } else if (parts[0] === '?') {
      out.untracked++
      out.files.push({ path: parts.slice(1).join(' '), kind: 'untracked', staged: false })
    }
  }
  if (out.branch === '(detached)' || !out.branch) {
    out.detached = true
    out.branch = oid && oid !== '(initial)' ? oid.slice(0, 7) : 'detached'
  }
  // Conflicts first, then tracked changes, then untracked.
  const rank = { conflict: 0, added: 1, deleted: 1, renamed: 1, modified: 1, untracked: 2 }
  out.fileCount = out.files.length
  out.files = [...out.files].sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, GIT_FILES)
  return out
}

/** `git worktree list --porcelain`: each worktree's path, the main checkout first. */
export const parseWorktrees = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map(block => block.split('\n').find(l => l.startsWith('worktree '))?.slice('worktree '.length) ?? '')
    .filter(Boolean)

/** `git diff --shortstat`: insertions and deletions. */
export const parseShortstat = (text: string) => ({
  insertions: Number(/(\d+) insertion/.exec(text)?.[1] ?? 0),
  deletions: Number(/(\d+) deletion/.exec(text)?.[1] ?? 0),
})

type RollupItem = { name?: string; context?: string; status?: string; conclusion?: string; state?: string }

/** Check runs and commit statuses, counted as GitHub's PR page counts them. */
export const summarizeChecks = (rollup: RollupItem[] | null | undefined) => {
  const checks = { passed: 0, failed: 0, pending: 0 }
  const failing: string[] = []
  for (const c of rollup ?? []) {
    const outcome = (c.conclusion || c.state || '').toUpperCase()
    if (c.status !== undefined && c.status !== 'COMPLETED') checks.pending++
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(outcome)) checks.passed++
    else if (['PENDING', 'EXPECTED', ''].includes(outcome)) checks.pending++
    else {
      checks.failed++
      const name = c.name || c.context
      if (name && !failing.includes(name)) failing.push(name)
    }
  }
  return { checks, failing }
}

export const toGitPr = (json: any, branch: string): GitPr => ({
  number: Number(json.number),
  title: String(json.title ?? ''),
  url: String(json.url ?? ''),
  state: String(json.state ?? 'OPEN'),
  isDraft: Boolean(json.isDraft),
  review: String(json.reviewDecision ?? ''),
  ...summarizeChecks(json.statusCheckRollup),
  current: json.headRefName === branch,
  conflicting: json.mergeable === 'CONFLICTING',
})

/** A one-line reason from gh's stderr. */
export const ghNote = (stderr: string): string => {
  if (/auth login|not logged|authenticat/i.test(stderr)) return 'gh not authenticated (run gh auth login)'
  if (/no git remote|none of the git remotes|not a git/i.test(stderr)) return 'No GitHub remote for this repo'
  return (stderr.trim().split('\n')[0] || 'gh failed').slice(0, 120)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A git read: the repo, or why there's none. `lasting`: the answer itself (not a
 * repo), not a read that failed. `root`: the repo a failed read was for.
 */
type GitRead = GitInfo | (GitNote & { lasting?: boolean; root?: string })

/** When git and gh were last read good: the age a failed refresh shows. */
const goodAt = { git: 0, gh: 0, workspaces: 0 }

/**
 * What the git state becomes after a read: a good read as it is; a failed one
 * keeps the last-good figures of the same repo, marked with why and since when;
 * anything else is its note.
 */
const keepGit =(before: GitInfo | GitNote | null, fresh: GitRead, t: number): GitInfo | GitNote => {
  if (fresh.ok) {
    goodAt.git = t
    return fresh
  }
  if (!fresh.lasting && before?.ok && (fresh.root === undefined || fresh.root === before.root)) {
    return { ...before, failed: fresh.note, at: before.failed ? before.at : goodAt.git || undefined }
  }
  return { ok: false, note: fresh.note }
}

/** The same for gh: a failed read for the same repo keeps the last-good PRs. */
const keepGh =(before: GhInfo | null, fresh: GhInfo): GhInfo => {
  if (!fresh.note) {
    goodAt.gh = fresh.at
    return fresh
  }
  if (before && !before.note && before.root === fresh.root) {
    return { ...before, failed: fresh.note, at: before.failed ? before.at : goodAt.gh || before.at }
  }
  return fresh
}

const loadGit = async ($: EngineInterface): Promise<GitRead> => {
  const cwd = await $.session.cwd()
  // --no-optional-locks: a read never rewrites the index.
  const run = (args: string[]) => $.process.run(['git', '--no-optional-locks', ...args], { cwd, timeoutMs: 10_000 })
  let top: ProcessRunResult
  try {
    top = await run(['rev-parse', '--show-toplevel'])
  } catch {
    return { ok: false, note: 'git not found' }
  }
  if (top.exitCode !== 0) return { ok: false, note: 'Not a git repository', lasting: true }
  const root = top.stdout.trim()
  const [status, wt, diff] = await Promise.all([
    run(['status', '--porcelain=v2', '--branch']).catch(() => null),
    run(['worktree', 'list', '--porcelain']).catch(() => null),
    run(['diff', '--shortstat', 'HEAD']).catch(() => null),
  ])
  if (!status || status.exitCode !== 0) {
    return { ok: false, note: (status?.stderr || 'git status failed').trim().split('\n')[0] || 'git status failed', root }
  }
  const trees = wt && wt.exitCode === 0 ? parseWorktrees(wt.stdout) : []
  const main = trees[0] ?? root
  return {
    ok: true,
    root,
    repo: basename(main).replace(/\.git$/, ''),
    ...parseStatus(status.stdout),
    worktree: { name: basename(root), path: root, linked: trees.length > 0 && root !== main, count: trees.length },
    ...(diff && diff.exitCode === 0 ? parseShortstat(diff.stdout) : { insertions: 0, deletions: 0 }),
  }
}

const GH_FIELDS = 'number,title,state,isDraft,reviewDecision,statusCheckRollup,url,headRefName,mergeable'

const loadGh = async ($: EngineInterface, info: GitInfo): Promise<GhInfo> => {
  const at = Date.now()
  const run = (args: string[]) => $.process.run(['gh', ...args], { cwd: info.root, timeoutMs: 20_000 })
  let list: ProcessRunResult
  let here: ProcessRunResult | null
  try {
    ;[list, here] = await Promise.all([
      run(['pr', 'list', '--author', '@me', '--state', 'open', '--limit', '5', '--json', GH_FIELDS]),
      // The current branch's PR, whoever opened it; exits 1 when there is none.
      info.detached ? Promise.resolve(null) : run(['pr', 'view', '--json', GH_FIELDS]),
    ])
  } catch {
    return { root: info.root, prs: [], note: 'gh not installed', at }
  }
  if (list.exitCode !== 0) return { root: info.root, prs: [], note: ghNote(list.stderr), at }
  const prs: GitPr[] = []
  try {
    if (here && here.exitCode === 0) prs.push({ ...toGitPr(JSON.parse(here.stdout), info.branch), current: true })
    for (const json of JSON.parse(list.stdout) as any[]) {
      if (!prs.some(p => p.number === json.number)) prs.push(toGitPr(json, info.branch))
    }
  } catch {
    return { root: info.root, prs: [], note: 'Could not read gh output', at }
  }
  prs.sort((a, b) => Number(b.current) - Number(a.current) || b.number - a.number)
  return { root: info.root, prs, at }
}

let gitBusy = false
let gitAgain = false
let ghBusy = false

/** Re-read git; a call made while one runs queues one more run after it. */
const refreshGit = async ($: EngineInterface): Promise<void> => {
  if (gitBusy) {
    gitAgain = true
    return
  }
  gitBusy = true
  try {
    do {
      gitAgain = false
      const before = await read($, git)
      const fresh = keepGit(before, await loadGit($), Date.now())
      if (!same(before, fresh)) await update($, git, () => fresh)
      const cached = await read($, gh)
      // A new repo (the session cd'd) shouldn't show the old repo's PRs.
      if (fresh.ok && cached?.root !== fresh.root) stale.gh = true
    } while (gitAgain)
  } finally {
    gitBusy = false
  }
}

// ---- Branches the session works on ----------------------------------------------

const tracked = atom({ plugin: 'syns-dashboard', key: 'sessionTracked' } as const, [])
const hidden = atom({ plugin: 'syns-dashboard', key: 'sessionHidden' } as const, [])
const branches = atom({ plugin: 'syns-dashboard', key: 'sessionBranches' } as const, [])
const creating = atom({ plugin: 'syns-dashboard', key: 'sessionCreating' } as const, null)
const workspacesGh = atom({ plugin: 'syns-dashboard', key: 'sessionWorkspacesGh' } as const, null)
const MAX_BRANCHES = 6

/** Adds a branch to the tracked list once; a path relative to `cwd` is resolved. */
const track = async ($: EngineInterface, branch: string, path: string, cwd: string) => {
  const full = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}`
  await update($, tracked, list => (list.some(t => t.branch === branch) ? list : [...list, { branch, path: full, at: Date.now() }]))
}

/** One tracked branch's git state against the default branch. */
const loadBranch = async ($: EngineInterface, t: Tracked, base: string, prs: Map<string, GitPr>, root: string): Promise<BranchView> => {
  // A worktree removed after its PR merged leaves the branch in the repository:
  // read it from the session's checkout then, rather than calling it deleted.
  const probe = await $.process.run(['git', 'rev-parse', '--git-dir'], { cwd: t.path, timeoutMs: 10_000 }).catch(() => null)
  const cwd = probe?.exitCode === 0 ? t.path : root
  const run = (args: string[]) => $.process.run(['git', '--no-optional-locks', ...args], { cwd, timeoutMs: 10_000 }).catch(() => null)
  const [head, exists, lr, committed, status, remote, top] = await Promise.all([
    run(['rev-parse', '--abbrev-ref', 'HEAD']),
    run(['rev-parse', '--verify', '--quiet', `refs/heads/${t.branch}`]),
    run(['rev-list', '--left-right', '--count', `${base}...${t.branch}`]),
    run(['diff', '--shortstat', `${base}...${t.branch}`]),
    run(['status', '--porcelain=v2']),
    run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${t.branch}`]),
    run(['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir']),
  ])
  const checkedOut = head?.exitCode === 0 && head.stdout.trim() === t.branch
  const counts = checkedOut && status?.exitCode === 0 ? parseStatus(status.stdout) : null
  // Uncommitted lines count too while the branch is checked out, as the app counts them.
  const working = checkedOut ? await run(['diff', '--shortstat', 'HEAD']) : null
  const lines = parseShortstat(committed?.exitCode === 0 ? committed.stdout : '')
  const extra = parseShortstat(working?.exitCode === 0 ? working.stdout : '')
  // A linked worktree's git dir differs from the repository's common one.
  const [toplevel = t.path, gitDir = '.git', common = '.git'] = top?.exitCode === 0 ? top.stdout.trim().split('\n') : []
  return {
    branch: t.branch,
    path: t.path,
    place: basename(toplevel),
    worktree: gitDir !== common,
    exists: exists?.exitCode === 0,
    checkedOut,
    ...(lr?.exitCode === 0 ? parseLeftRight(lr.stdout) : { ahead: 0, behind: 0 }),
    insertions: lines.insertions + extra.insertions,
    deletions: lines.deletions + extra.deletions,
    staged: counts?.staged ?? 0,
    modified: counts?.modified ?? 0,
    untracked: counts?.untracked ?? 0,
    conflicted: counts?.conflicted ?? 0,
    pushed: remote?.exitCode === 0,
    pr: prs.get(t.branch) ?? null,
  }
}

let branchesBusy = false

/** PRs by head branch, from the last gh read; gh runs on its own slower cadence. */
let prCache = new Map<string, GitPr>()
let baseCache: string | null = null
/** Whether a shown workspace has an open PR, as of the last read: gh is then read more often. */
let openPrs = false

/** Re-reads every shown tracked branch; with `withGh`, all their PRs too, in one gh call. */
const refreshBranches = async ($: EngineInterface, withGh = false): Promise<void> => {
  if (branchesBusy) {
    // A gh read skipped now would otherwise wait out the whole interval: try again soon.
    if (withGh) stale.gh = true
    return
  }
  branchesBusy = true
  try {
    const info = await read($, git)
    if (!info?.ok) return
    const run = (cmd: string[]) => $.process.run(cmd, { cwd: info.root, timeoutMs: 20_000 }).catch(() => null)
    if (baseCache === null) {
      const ref = await run(['git', 'rev-parse', '--abbrev-ref', 'origin/HEAD'])
      baseCache = ref?.exitCode === 0 ? ref.stdout.trim() : 'origin/main'
    }
    // The default branch is what the others merge into, not a workspace of its own
    // (it would offer "Create PR" against itself), even when the session sits on it.
    const base = baseCache.replace(/^origin\//, '')
    // The session's own branch counts as started here.
    if (!info.detached && info.branch !== base) await track($, info.branch, info.root, info.root)
    const off = await read($, hidden)
    const list = (await read($, tracked))
      .filter(t => !off.includes(t.branch) && t.branch !== base)
      .slice(-MAX_BRANCHES)
      .reverse()
    if (withGh) {
      const prList = await run(['gh', 'pr', 'list', '--state', 'all', '--limit', '40', '--json', GH_FIELDS])
      let failed: string | undefined = !prList ? 'gh not installed' : prList.exitCode !== 0 ? ghNote(prList.stderr) : undefined
      if (prList?.exitCode === 0) {
        try {
          // Newest first from gh, so the first PR per branch is its latest.
          const prs = new Map<string, GitPr>()
          for (const json of JSON.parse(prList.stdout) as any[]) if (!prs.has(json.headRefName)) prs.set(json.headRefName, toGitPr(json, json.headRefName))
          prCache = prs
        } catch {
          failed = 'Could not read gh output'
        }
      }
      // A failed read keeps the last PRs (prCache), marked with why and since when.
      const before = await read($, workspacesGh)
      if (!failed) goodAt.workspaces = Date.now()
      const next: WorkspacesGh = failed ? { failed, at: before?.failed ? before.at : goodAt.workspaces } : { at: goodAt.workspaces }
      // A good read after a good read changes nothing drawn: no write, no redraw.
      if (failed ? !same(before, next) : !before || before.failed) await update($, workspacesGh, () => next)
    }
    const loaded = await Promise.all(list.map(t => loadBranch($, t, baseCache!, prCache, info.root)))
    // git and gh took a while: a branch hidden since `off` was read must not come
    // back. `hiding` is checked again inside the write, which retries on a miss.
    openPrs = loaded.some(b => b.pr?.state === 'OPEN')
    const offNow = await read($, hidden)
    const shown = () => loaded.filter(b => !offNow.includes(b.branch) && !hiding.has(b.branch))
    if (!same(await read($, branches), shown())) await update($, branches, shown)
  } finally {
    branchesBusy = false
  }
}

/**
 * Branches hidden in this process, set before any await: a refresh already
 * running read `hidden` before the press, and filters by this when it writes.
 */
const hiding = new Set<string>()

/** The ✕ on a branch: stop showing it. */
const hideBranch = async ($: EngineInterface, branch: string) => {
  hiding.add(branch)
  await update($, hidden, list => (list.includes(branch) ? list : [...list, branch]))
  await update($, branches, list => list.filter(b => b.branch !== branch))
}

/**
 * Create PR, as the desktop app's own button does it: hand it to the session as a
 * prompt, so Claude writes the description, opens the PR and starts watching it
 * (auto-merge and Auto-fix, per the person's instructions). Runs as a turn of its
 * own once the session is idle.
 */
const createPr = async ($: EngineInterface, branch: string) => {
  if (await read($, creating)) return
  const view = (await read($, branches)).find(b => b.branch === branch)
  if (!view) return
  await update($, creating, () => branch)
  try {
    await $.prompt.submit({
      text:
        `Create a pull request for the \`${branch}\` branch (checked out at ${view.path}). ` +
        'Push it if needed, write the title and body from its commits, open it, and start watching it.',
      asUser: true,
    })
  } catch {
    $.ui.toast('Create PR: could not send the request to the session')
  } finally {
    await update($, creating, () => null)
  }
}

const refreshGh = async ($: EngineInterface): Promise<void> => {
  if (ghBusy) return
  const info = await read($, git)
  if (!info?.ok) return
  ghBusy = true
  try {
    const before = await read($, gh)
    const fresh = keepGh(before, await loadGh($, info))
    // Keep the old timestamp when nothing changed, so the pane doesn't redraw for nothing.
    if (!before || !same({ ...before, at: 0 }, { ...fresh, at: 0 })) await update($, gh, () => fresh)
  } finally {
    ghBusy = false
  }
}

const FILE_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']

// ---- Account limits --------------------------------------------------------

const limits = atom({ plugin: 'syns-dashboard', key: 'sessionLimits' } as const, null)

const KNOWN_WINDOWS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', spend_limit: 'Spend' }

const prettify = (s: string) => {
  const t = s.replace(/[_-]+/g, ' ').trim()
  return t ? t[0]!.toUpperCase() + t.slice(1) : s
}

/** A window's name for people: `five_hour` -> 5-hour, `seven_day_opus` -> Weekly opus. */
export const limitLabel = (kind: string): string => {
  const known = KNOWN_WINDOWS[kind]
  if (known) return known
  for (const [prefix, label] of Object.entries(KNOWN_WINDOWS)) {
    if (kind.startsWith(`${prefix}_`)) return `${label} ${kind.slice(prefix.length + 1).replace(/[_-]+/g, ' ')}`
  }
  return prettify(kind)
}

export const toLimits = (list: SessionRateLimit[]): Limit[] =>
  list.map(l => ({ kind: l.kind, percent: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) }))

/** "resets in 2h 14m", "resets in 3d 4h", or "" when the time is unknown. */
export const resetIn = (resetsAt: string | undefined, at: number): string => {
  if (!resetsAt) return ''
  const t = Date.parse(resetsAt)
  if (Number.isNaN(t)) return ''
  const m = Math.ceil((t - at) / 60_000)
  if (m <= 0) return 'resets now'
  const d = Math.floor(m / 1_440)
  const h = Math.floor((m % 1_440) / 60)
  if (d > 0) return `resets in ${d}d ${h}h`
  if (h > 0) return `resets in ${h}h ${m % 60}m`
  return `resets in ${m}m`
}

const storeLimits = async ($: EngineInterface, list: SessionRateLimit[]) => {
  const fresh = toLimits(list)
  if (!same(await read($, limits), fresh)) await update($, limits, () => fresh)
}

// ---- Session activity --------------------------------------------------------

const activity = atom({ plugin: 'syns-dashboard', key: 'sessionActivity' } as const, {
  turns: 0,
  tools: {},
  files: [],
  turnLog: [],
  contextLog: [],
})
const TURN_LOG = 40
const CONTEXT_LOG = 60
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

/** The path an editing tool's arguments name, if any. */
export const editedPath = (tool: string, args: { file_path?: unknown; notebook_path?: unknown }): string | undefined => {
  if (!EDIT_TOOLS.includes(tool)) return undefined
  const path = args.file_path ?? args.notebook_path
  return typeof path === 'string' && path ? path : undefined
}

/** The activity with one more tool call. */
export const countTool = (a: SessionActivity, tool: string, isError: boolean, path?: string): SessionActivity => {
  const old = a.tools[tool] ?? { n: 0, err: 0 }
  const tools = { ...a.tools, [tool]: { n: old.n + 1, err: old.err + (isError ? 1 : 0) } }
  const files = path && !a.files.includes(path) ? [...a.files, path] : a.files
  const turnTools = { ...a.turnTools, [tool]: (a.turnTools?.[tool] ?? 0) + 1 }
  return { ...a, tools, files, callsThisTurn: (a.callsThisTurn ?? 0) + 1, turnTools }
}

/** The activity with one more main-loop turn, the log cut to its last TURN_LOG. */
export const countTurn = (a: SessionActivity, ms: number, usage: ModelUsage | undefined): SessionActivity => {
  const point: TurnPoint = {
    ms,
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
    calls: a.callsThisTurn ?? 0,
    tools: a.turnTools ?? {},
  }
  return { ...a, turns: a.turns + 1, callsThisTurn: 0, turnTools: {}, turnLog: [...a.turnLog, point].slice(-TURN_LOG) }
}

export const refresh = async ($: EngineInterface) => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (b) {
    const fresh = toSnapshot(b)
    if (!same(await read($, snapshot), fresh)) await update($, snapshot, () => fresh)
  }
  await storeLimits($, usage.rateLimits ?? [])
  const percent = b?.percentage ?? usage.context.percent
  await update($, activity, a => {
    const log =
      percent === undefined || a.contextLog.at(-1) === percent ? a.contextLog : [...a.contextLog, percent].slice(-CONTEXT_LOG)
    const next: SessionActivity = { ...a, startedAt: usage.startedAt, contextLog: log }
    if (usage.cost) next.cost = usage.cost.usd
    return same(a, next) ? a : next
  })
}

// ---- When to work ------------------------------------------------------------
// Nothing runs while the tab isn't shown: events only mark what went stale,
// and one timer (started on the tab's first draw) reads it again, at most so
// often, while the tab is on screen.

const stale = { usage: true, git: true, gh: true }
const last = { usage: 0, git: 0, gh: 0, clock: 0, resources: 0 }
const RESOURCES_EVERY = 10_000
let nettopBusy = false

/** One sample of the session's share of the machine; see resources.ts. */
const sampleResources = async ($: EngineInterface) => {
  const run = await $.process.run(resourcesSh(), { timeoutMs: 5_000 })
  if (run.exitCode !== 0) return null
  if (NET_PER_PROCESS && !nettopBusy) {
    nettopBusy = true
    $.process
      .run(NETTOP, { timeoutMs: 10_000 })
      .then(r => (r.exitCode === 0 ? takeNettop(r.stdout, Date.now()) : undefined))
      .catch(() => undefined)
      .finally(() => (nettopBusy = false))
  }
  return toResources(run.stdout, Date.now())
}
// Even with nothing marked stale, read again this often while shown.
const EVERY = { usage: 60_000, git: 60_000, gh: 180_000, clock: 60_000 }
// And never more often than this, however much happens.
const AT_MOST = { usage: 3_000, git: 3_000, gh: 20_000 }
let worker: Timer | undefined

// While a workspace has an open PR, GitHub moves it with nothing happening here
// (checks finish, auto-merge lands), so gh is read this often instead.
const GH_WHILE_OPEN = 30_000

export const due = (kind: 'usage' | 'git' | 'gh', t: number) =>
  t - last[kind] >= (stale[kind] ? AT_MOST[kind] : kind === 'gh' && openPrs ? GH_WHILE_OPEN : EVERY[kind])

const tick = async ($: EngineInterface) => {
  if (!isShown()) return
  const t = Date.now()
  if (due('usage', t)) {
    stale.usage = false
    last.usage = t
    await perf.time('usage', () => refresh($))
  }
  if (due('git', t)) {
    stale.git = false
    last.git = t
    await perf.time('git', () => refreshGit($))
    if (!due('gh', t)) await perf.time('branches', () => refreshBranches($))
  }
  if (due('gh', t)) {
    stale.gh = false
    last.gh = t
    await perf.time('gh', () => refreshGh($))
    await perf.time('branches', () => refreshBranches($, true))
  }
  // The session's share of the machine: a few shell commands, every 10 s while shown.
  if (t - last.resources >= RESOURCES_EVERY) {
    last.resources = t
    const res = await perf.time('resources', () => sampleResources($)).catch(() => null)
    if (res && !same(await read($, resources), res)) await update($, resources, () => res)
  }
  // The session's elapsed time moves even when nothing else does.
  if (t - last.clock >= EVERY.clock) {
    last.clock = t
    await update($, now, () => t)
  }
}

const HELPERS: Helpers = { colorOf, limitLabel, resetIn }
const TERM_HELPERS: TermHelpers = { limitLabel, resetIn }

/** What this tab costs, drawn in its debug footer. */
export const perf = createPerf()

/** The app mode's sections the person folded; kept for the session. */
const collapsed = atom({ plugin: 'syns-dashboard', key: 'sessionCollapsed' } as const, [])
/** Whether a wide app pane flows its sections into columns; the footer's switch flips it. */
const columns = atom({ plugin: 'syns-dashboard', key: 'sessionColumns' } as const, true)

/** Has the next tick read everything, rather than each read when it falls due. */
const readAll = () => {
  stale.usage = stale.git = stale.gh = true
  last.usage = last.git = last.gh = 0
}

let started = false

/**
 * The tab just drew, so it's on screen. Its first draw starts the timer, on a
 * timer of its own since a drawing writes nothing; each tick then reads only
 * while the tab is the one shown.
 */
const drawn = ($: EngineInterface) => {
  if (started) return
  started = true
  $.clock.after(0, () => {
    worker?.cancel()
    worker = $.clock.every(3_000, () => void perf.time('tick', () => tick($)).catch(() => undefined))
    void perf.time('tick', () => tick($)).catch(() => undefined)
  })
}

/**
 * The Session tab's hooks, drawn in the dashboard's `pane`. The dashboard calls
 * this after its own render hook for the pane, so its render (the tab row) is the
 * outer one and `next(e)` reaches this tab's render, with `e.props.scroll.bodyRows`
 * less the tab row. Returns `/overview`, which the dashboard registers as the
 * session starts (a plugin has one `session.start`).
 */
export const attach = (on: Parameters<Register>[0], _options: Parameters<Register>[1], pane: string): void => {
  PANE = pane

  // A tool that may have changed files (or pushed, or opened a PR) marks git stale;
  // a gh or push command marks the PRs stale too. Counting calls is watching, not
  // reading, so it runs while the tab is off screen too. Matched (any tool): the
  // dashboard has the plugin's one unmatched tool.call.
  on('tool.call', { tool: /./ }, async ($, e, next) => {
    const ran = await next(e)
    if (!('deny' in ran && ran.deny)) {
      const path = editedPath(e.tool, e as { file_path?: unknown; notebook_path?: unknown })
      void perf.time('tool.call', () => update($, activity, a => countTool(a, e.tool, Boolean(ran.isError), path))).catch(() => undefined)
    }
    // A command that starts a branch or a worktree: track it.
    if (e.tool === 'Bash') {
      const started = startedBy(e.command)
      if (started.length) {
        void (async () => {
          const cwd = await $.session.cwd()
          for (const s of started) await track($, s.branch, s.path ?? cwd, cwd)
          stale.gh = true
        })().catch(() => undefined)
      }
    }
    if (FILE_TOOLS.includes(e.tool)) {
      stale.git = true
      if (e.tool === 'Bash' && /\bgh pr\b|\bgit (push|commit|checkout|switch)\b/.test(e.command)) stale.gh = true
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Each main-loop turn's end carries its duration and usage; a subagent's turns aren't counted.
  // Matched (any turn), so the plugin keeps turn.complete free of an unmatched hook.
  on('turn.complete', { turnId: /./ }, async ($, e, next) => {
    const done = await next(e)
    stale.git = true
    if (!e.agentId) void update($, activity, a => countTurn(a, e.durationMs, e.usage)).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // `/overview`: the dashboard on this tab, everything read again now.
  on('command.run', { command: 'syn-overview' }, async $ => {
    readAll()
    await update($, tab, () => MINE)
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($).catch(() => undefined)

    return { text: 'syn dashboard opened on its Session tab.' }
  })

  // The limits come with the measure, no read; the breakdown is worked out on the
  // next tick, if the tab is shown. Matched (any change): the dashboard has the
  // plugin's one unmatched session.measure.
  on('session.measure', { changed: /./ }, async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('rateLimits')) await storeLimits($, e.rateLimits)
    stale.usage = true

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!isShown()) return next(e)
    drawn($)
    // Read so the tab redraws as the session's elapsed time moves.
    await read($, now)
    const data: DesktopData = {
      snap: await read($, snapshot),
      limits: await read($, limits),
      git: await read($, git),
      gh: await read($, gh),
      activity: await read($, activity),
      collapsed: await read($, collapsed),
      resources: await read($, resources),
      branches: await read($, branches),
      creating: await read($, creating),
      workspacesGh: await read($, workspacesGh),
      focused: e.props.isFocused,
      hideBranch: (branch: string) => void hideBranch($, branch).catch(err => $.ui.toast(`Hide ${branch}: ${err?.message ?? err}`)),
      // Merge, like Create PR: the session does it, and reports back.
      mergePr: (pr: GitPr) =>
        void $.prompt
          .submit({ text: `Merge PR #${pr.number} (${pr.url}) once its checks pass: turn on auto-merge, or merge it now if it's already green.`, asUser: true })
          .catch(() => $.ui.toast('Merge: could not send the request to the session')),
      createPr: (branch: string) => void createPr($, branch).catch(() => undefined),
      toggle: (id: string) =>
        void update($, collapsed, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])).catch(() => undefined),
      columnsOn: await read($, columns),
      toggleColumns: () => void update($, columns, was => !was).catch(() => undefined),
      columns: e.props.bodyColumns,
      rows: e.props.scroll?.bodyRows,
      at: Date.now(),
      perf: perf.snapshot(),
    }
    // The terminal draws the same inspector in cells; the app surfaces as boxes.
    // Buttons keep their press handles across redraws, so a click made just before one still lands;
    // a scope of its own, as the dashboard's render holds its own Buttons under the render's.
    const els = holdButtons($.ui.resolve(e), `${PANE}\u0000session\u0000${e.surface}`)
    if (e.surface === 'terminal') {
      return perf.time('render', () => renderTerminal(els as unknown as TermElements, data, TERM_HELPERS))
    }
    return perf.time('render', () => renderDesktop(els as unknown as AppElements, data, HELPERS))
  })

}

/** `/overview`: the dashboard registers it as the session starts. */
export const COMMANDS: Command[] = [{ name: 'syn-overview', description: 'Open the syn dashboard on its Session tab: context, limits, cost, turns, tools, git and the machine' }]
