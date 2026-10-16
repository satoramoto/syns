// Changed in this fork (awesome-claude) for the desktop version: the desktop surface draws hooks/desktop.tsx.
// The terminal draws in the kit's terminal design system: a section header, TREE
// connectors, the kit's status colours as theme keys, and its note lines.
//
// Another mod can draw the tree in a tab of its own pane: it calls `attach` (see
// there). syns' dashboard does, copying this folder. Every function that takes `$`
// stays in this file: the engine follows `$` within one file only.
import { type BuiltinToolResults, type Elements, type EngineInterface, type Hook, type Register, type RenderElement, type RenderInput, type Timer, update } from 'claude-code'
import { LINUX_LAUNCH, openCommand, openWithCommand } from './open'

import { ago, middle } from '../../kit/format'
import { C, MUTED, termInk, treePrefix } from '../../kit/tokens'
import { type Hint, holdButtons, kit, MARK } from '../../kit/ui'

import type { Activity, FileNode, FileTree } from '../../types'
import { renderDesktop, statusColor, toneColor } from './desktop'
import type { DesktopElements } from './desktop'
import { BRANCH_ICON, chainOf, type GitAction, gitActions, readOnly, readTargets, resolve, TONES } from './git'
import type { RowSpec, RowsProps, Seg } from './rows'
import { fileIcon } from './icons'
import {
  ancestorsOf,
  type Change,
  dirname,
  emptyTree,
  formatSize,
  inside,
  isAbsolute,
  join,
  mapper,
  parseGit,
  parseNumstat,
  posix,
  relative,
  remoteHost,
  remoteName,
  HOST_MARK,
  hostKind,
  dropBelow,
  useDrives,
  rollCounts,
  replaceChildren,
  rollUp,
  toNodes,
  underAny,
  visibleRows,
} from './tree'

const TREE = { plugin: 'syns-dashboard', key: 'filesTree' } as const
const ACTIVITY = { plugin: 'syns-dashboard', key: 'filesActivity' } as const
/** The pane the tree draws in: its own, or a host's (see `attach`). */
let PANE = 'filetree'
/** The tab's name. The folder is the section header's title, so the tab doesn't repeat it. */
const TAB = 'Files'
/** Each activity tone's terminal colour: the kit's meaning for it (desktop's toneColor), as a theme key. */
const SHIMMER: Record<string, string> = Object.fromEntries(TONES.map(k => [k, termInk(toneColor(k)).color ?? '']))
/** The terminal's key hints while the pane has the keyboard, the most used first. */
const TREE_HINTS: Hint[] = [
  { key: '↑↓', label: 'move' },
  { key: '⏎', label: 'open' },
  { key: '←→', label: 'fold' },
  { key: 'y', label: 'copy path' },
]
const PREVIEW_HINTS: Hint[] = [
  { key: '↑↓', label: 'scroll' },
  { key: '←', label: 'back' },
]
const BRANCH_ROW = '#branch'
const FLASH_MS = 2700
const RUNNING_MAX_MS = 600_000
const NO_REPO_DEPTH = 4
const DOUBLE_MS = 450
const FIND_LIMIT = 200
const READ_REVEAL_LIMIT = 12
const SEARCH_REVEAL_LIMIT = 60
const ACTIVITY_TTL_MS = 45_000
const FONT_SCRIPT =
  'if command -v fc-list >/dev/null 2>&1; then f=$(fc-list ":charset=$1" file | head -n1 | cut -d: -f1); ' +
  'else f=$(ls "$HOME"/Library/Fonts/*Nerd* /Library/Fonts/*Nerd* 2>/dev/null | head -n1); fi; ' +
  '[ -n "$f" ] || { echo missing; exit 0; }; m=$(stat -c %Z "$f" 2>/dev/null || stat -f %c "$f"); p=$PPID; ' +
  'while [ -n "$p" ] && [ "$p" -gt 1 ]; do c=$(ps -o comm= -p "$p" 2>/dev/null); c=$(basename "$c" 2>/dev/null | tr -d " "); case "$c" in ' +
  'ghostty|kitty|alacritty|Alacritty|foot|footclient|wezterm-gui|konsole|gnome-terminal-|xterm|urxvt|st|Terminal|iTerm2) ' +
  'e=$(ps -o etime= -p "$p" 2>/dev/null | awk -F\'[-:]\' \'{n=NF; s=$n+60*$(n-1); if (n>2) s+=3600*$(n-2); if (n>3) s+=86400*$(n-3); print s}\'); [ -n "$e" ] && [ $(( $(date +%s) - e )) -lt "$m" ] && echo stale || echo ok; exit 0;; esac; ' +
  'p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); done; echo ok'
const PRUNE = ['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next']
const HOME_PRUNE = ['Library', 'AppData', '.Trash']
const SIZE_TIMEOUT_MS = 15_000
const SIZE_JOBS = 2
const SIZE_WALK_LIMIT = 50_000
const ROW_SCROLL_MS = 100

let blink: Timer | null = null
let generation = 0
let lastPress = { key: '', at: 0 }
let noNerd = false
let glyphSetting = 'auto'
let openWithSetting = ''
let previewed: { path: string; text: string; note: string } | null = null
let previewRows = 20
let follow = true
let followClaude = true
let scanning: Promise<void> | null = null
let scanJobs: Job[] = []
let gitRun: Promise<void> | null = null
let gitNext: Promise<void> | null = null
let queuedReads: string[] = []
let showReads = true
let showWrites = true
let searchIndex: { root: string; paths: Promise<string[]> } | null = null
let activityId = 0
let pointer = true
let view = { from: 0, max: 0 }
let nativeScroll = false
let lastSync = 0
// The pane opens only when asked for (/filetree), never by itself at session start.
let noDock = true
let home = ''
let platform: Promise<'linux' | 'darwin' | 'win32'> | null = null
let dirty: { root: string; files: Record<string, Change> } = { root: '', files: {} }
let markId = 0
let listSeq = 0
let lastRoot = ''
let sizeDefault = false
let sizeEpoch = 0
let sizeActive = 0
let sizeQueue: string[] = []
const sizing = new Set<string>()
const listLatest = new Map<string, number>()
const unreadable = new Set<string>()
const background = new Map<string, Background>()

function osName($: EngineInterface): Promise<'linux' | 'darwin' | 'win32'> {
  platform ??= (async () => {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
    try {
      return (await $.process.run(['uname', '-s'], { timeoutMs: 3_000 })).stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
    } catch {
      return 'linux'
    }
  })()
  return platform
}

async function cwdOf($: EngineInterface): Promise<string> {
  return posix(await $.session.cwd())
}

function clean(segs: Seg[]): Seg[] {
  for (const seg of segs) for (const k of Object.keys(seg) as (keyof Seg)[]) if (seg[k] === undefined) delete seg[k]
  return segs
}

async function get($: EngineInterface): Promise<FileTree> {
  return { ...emptyTree(''), ...(await $.state.get(TREE)).value }
}

async function put($: EngineInterface, fn: (t: FileTree) => FileTree): Promise<void> {
  await update($, TREE, cur => fn({ ...emptyTree(''), ...cur }))
}

function patch($: EngineInterface, fn: (t: FileTree) => Partial<FileTree>) {
  return put($, t => ({ ...t, ...fn(t) }))
}

async function activities($: EngineInterface): Promise<Activity[]> {
  return (await $.state.get(ACTIVITY)).value ?? []
}

async function setActivities($: EngineInterface, fn: (list: Activity[]) => Activity[]): Promise<void> {
  await update($, ACTIVITY, cur => fn(cur ?? []).slice(-6))
}

async function list($: EngineInterface, dir: string): Promise<FileNode[] | null> {
  try {
    const entries = await $.fs.list(dir)
    const resolved = await Promise.all(
      entries.map(async e => {
        if (!e.isLink) return { name: e.name, kind: e.kind, mtimeMs: e.mtimeMs, size: e.size, isLink: false }
        try {
          const target = await $.fs.stat(join(dir, e.name))
          return target.kind === 'dir'
            ? { name: e.name, kind: 'dir' as const, mtimeMs: target.mtimeMs, size: 0, isLink: false }
            : { name: e.name, kind: 'file' as const, mtimeMs: target.mtimeMs, size: target.size, isLink: true }
        } catch {
          return { name: e.name, kind: 'other' as const, mtimeMs: 0, size: 0, isLink: true }
        }
      }),
    )
    unreadable.delete(dir)
    return toNodes(dir, resolved)
  } catch (err) {
    if (!(await exists($, dir))) return []
    if (!unreadable.has(dir)) {
      unreadable.add(dir)
      $.ui.toast(`could not list ${shortPath(dir)}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return null
  }
}

async function loadDirs($: EngineInterface, dirs: string[]): Promise<Map<string, FileNode[]>> {
  const root = (await get($)).root
  const seq = ++listSeq
  for (const dir of dirs) listLatest.set(dir, seq)
  const results = await Promise.all(dirs.map(async dir => [dir, await list($, dir)] as const))
  const listed = new Map<string, FileNode[]>()
  for (const [dir, kids] of results) {
    if (listLatest.get(dir) !== seq) continue
    listLatest.delete(dir)
    if (kids) listed.set(dir, kids)
  }
  await patch($, t => (t.root === root ? { nodes: replaceChildren(t.nodes, listed) } : {}))
  return listed
}

async function git($: EngineInterface, cwd: string, args: string[], timeoutMs = 20_000) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args], { timeoutMs, env: { GIT_OPTIONAL_LOCKS: '0' } })
}

async function detectRepo($: EngineInterface): Promise<void> {
  const t = await get($)
  if (!t.root) return
  let top = ''
  let prefix = ''
  try {
    const run = await git($, t.root, ['rev-parse', '--show-prefix', '--show-toplevel'], 5_000)
    const [p = '', tl = ''] = run.exitCode === 0 ? run.stdout.split('\n') : []
    prefix = p.trim()
    top = tl.trim()
  } catch {
    top = ''
  }
  await patch($, cur => (cur.root === t.root ? { top, prefix } : {}))
}

async function readGit($: EngineInterface): Promise<void> {
  const t = await get($)
  if (!t.root || !t.top) return
  const root = t.root
  try {
    const status = await git($, root, ['status', '--porcelain=v1', '-b', '-z', '--ignored=traditional', '--untracked-files=normal', '--', '.'])
    if (status.exitCode !== 0) return
    const parsed = parseGit(status.stdout, root, t.prefix)
    const diff: Record<string, [number, number]> = {}
    const head = await git($, root, ['diff', 'HEAD', '--numstat', '-z', '--', '.'])
    if (head.exitCode === 0) parseNumstat(head.stdout, root, t.prefix, diff)
    const files = { ...parsed.files }
    if (parsed.untrackedDirs.length) {
      const others = await git($, root, ['ls-files', '-o', '--exclude-standard', '-z', '--', ...parsed.untrackedDirs.map(d => d.slice(root.length + 1) || '.')])
      if (others.exitCode === 0) for (const rel of others.stdout.split('\0').filter(Boolean)) files[join(root, rel)] = 'new'
    }
    for (const path of Object.keys(diff)) if (files[path] === 'new') delete diff[path]
    const branch = parsed.branch ? { ...parsed.branch, host: await hostOf($, t.top, remoteName(parsed.branch.upstream)) } : null
    dirty = { root, files }
    await patch($, cur =>
      cur.root === root
        ? {
            git: parsed.git,
            ignored: parsed.ignored,
            untrackedDirs: parsed.untrackedDirs,
            branch,
            counts: rollCounts(files, root),
            diff: rollUp(diff, root),
          }
        : {},
    )
  } catch {
    return
  }
}

/** Each repo's remotes' hosts, by `top` and remote name: a remote's URL rarely changes, so it's read once a load. */
const hosts = new Map<string, string>()

/** The host of `remote`'s URL in the repo at `top` (`github.com`), or '' for none. */
async function hostOf($: EngineInterface, top: string, remote: string): Promise<string> {
  if (!remote) return ''
  const id = `${top}\u0000${remote}`
  const known = hosts.get(id)
  if (known !== undefined) return known
  try {
    const run = await git($, top, ['remote', 'get-url', remote], 5_000)
    if (run.exitCode !== 0) return ''
    // Only a successful lookup is cached: a timeout or failure is retried on a later refresh.
    const host = remoteHost(run.stdout)
    hosts.set(id, host)
    return host
  } catch {
    return ''
  }
}

function refreshGit($: EngineInterface): Promise<void> {
  if (!gitRun) {
    gitRun = readGit($).finally(() => {
      gitRun = null
    })
    return gitRun
  }
  const rerun = () => {
    gitNext = null
    return refreshGit($)
  }
  gitNext ??= gitRun.then(rerun, rerun)
  return gitNext
}

async function reset($: EngineInterface, root: string, focus = false): Promise<void> {
  const prev = await get($)
  generation += 1
  blink?.cancel()
  blink = null
  lastRoot = root
  searchIndex = null
  sizeEpoch += 1
  sizeQueue = []
  await put($, () => ({ ...emptyTree(root), showHidden: prev.showHidden, showSize: prev.root ? prev.showSize : sizeDefault }))
  if (focus) await $.ui.open({ id: PANE, title: TAB, focus: true })
  else if (!noDock) await $.ui.open({ id: PANE, title: TAB })
  await loadDirs($, [root])
  await detectRepo($)
  await refreshGit($)
}

async function revealPaths($: EngineInterface, paths: string[]): Promise<void> {
  const tried = new Set<string>()
  for (let pass = 0; pass < 32; pass++) {
    const t = await get($)
    const loaded = new Set(t.nodes.filter(n => n.loaded).map(n => n.id))
    if (t.nodes.some(n => n.parent === t.root)) loaded.add(t.root)
    const need = new Set<string>()
    for (const p of paths) {
      for (const dir of [t.root, ...ancestorsOf(p, t.root).reverse()]) {
        if (!loaded.has(dir)) {
          if (!tried.has(dir)) need.add(dir)
          break
        }
      }
    }
    if (need.size === 0) return
    for (const dir of need) tried.add(dir)
    await loadDirs($, [...need])
  }
}

function pruneArgs(root: string, ignored: string[] = []): string[] {
  const names = broad(root) ? [...PRUNE, ...HOME_PRUNE] : PRUNE
  return ['(', ...names.flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name])), ...ignored.flatMap(p => ['-o', '-path', p]), ')', '-prune', '-o']
}

async function newer($: EngineInterface, paths: string[], sinceMs: number): Promise<string[]> {
  const stats = await Promise.all(
    paths.map(async p => {
      try {
        return (await $.fs.stat(p)).mtimeMs > sinceMs ? p : ''
      } catch {
        return ''
      }
    }),
  )
  return stats.filter(Boolean)
}

function broad(root: string): boolean {
  return root === home || root === '/' || /^[A-Za-z]:\/$/.test(root)
}

function rootOfDisk(root: string): boolean {
  return root === '/' || /^[A-Za-z]:\/$/.test(root)
}

async function changedSince($: EngineInterface, root: string, since: Since, depth: number, ignored: string[] = []): Promise<string[]> {
  if (rootOfDisk(root)) return []
  const test = since.mark ? ['-newer', since.mark] : ['-newermt', `@${(since.ms / 1000).toFixed(3)}`]
  try {
    const run = await $.process.run(['find', '-H', root, '-xdev', ...(depth ? ['-maxdepth', String(depth)] : []), ...pruneArgs(root, ignored.filter(p => inside(root, p)).slice(0, 40)), ...test, '-print0'], { timeoutMs: 8_000 })
    return run.stdout.split('\0').filter(p => p && p !== root)
  } catch {
    return []
  }
}

async function changedInRepo($: EngineInterface, root: string, since: Since, before: Record<string, Change>, ignored: string[]): Promise<{ hits: string[]; gone: string[] }> {
  if (since.os !== 'win32') return { hits: await changedSince($, root, since, 0, ignored), gone: [] }
  if (dirty.root !== root) return { hits: [], gone: [] }
  const entries = Object.entries(dirty.files)
  const gone = entries.filter(([p, c]) => c === 'del' && before[p] !== 'del').map(([p]) => p)
  const live = entries.filter(([, c]) => c !== 'del').map(([p]) => p)
  return { hits: await newer($, live.slice(0, 4_000), since.ms), gone }
}

type Since = { ms: number; mark: string; os: 'linux' | 'darwin' | 'win32' }

async function sinceNow($: EngineInterface, writes: boolean): Promise<Since> {
  const ms = await $.clock.now()
  const os = await osName($)
  if (os !== 'darwin' || !writes) return { ms, mark: '', os }
  const mark = `${((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')}/filetree-${await $.session.id()}-${++markId}.mark`
  try {
    await $.process.run(['touch', mark], { timeoutMs: 3_000 })
    return { ms, mark, os }
  } catch {
    return { ms, mark: '', os }
  }
}

async function walkSize($: EngineInterface, dir: string): Promise<number> {
  let total = 0
  let seen = 0
  let level = [dir]
  while (level.length) {
    const next: string[] = []
    for (const d of level) {
      let entries
      try {
        entries = await $.fs.list(d)
      } catch {
        continue
      }
      for (const e of entries) {
        if (++seen > SIZE_WALK_LIMIT) return -1
        if (e.kind === 'dir' && !e.isLink) next.push(join(d, e.name))
        else if (e.kind === 'file') total += e.size
      }
    }
    level = next
  }
  return total
}

async function dirSize($: EngineInterface, dir: string): Promise<number> {
  if (rootOfDisk(dir)) return -1
  if ((await osName($)) === 'win32') return walkSize($, dir)
  try {
    const run = await $.process.run(['du', '-skxH', dir], { timeoutMs: SIZE_TIMEOUT_MS })
    const kb = Number(run.stdout.trim().split(/\s/)[0] || NaN)
    return Number.isFinite(kb) ? kb * 1024 : -1
  } catch {
    return -1
  }
}

function pumpSizes($: EngineInterface): void {
  while (sizeActive < SIZE_JOBS && sizeQueue.length) {
    const dir = sizeQueue.shift() ?? ''
    const epoch = sizeEpoch
    sizing.add(dir)
    sizeActive += 1
    void dirSize($, dir)
      .then(async bytes => {
        if (epoch === sizeEpoch) return patch($, cur => (inside(cur.root, dir) ? { dirSizes: { ...cur.dirSizes, [dir]: bytes } } : {}))
        const cur = await get($)
        if (cur.showSize && inside(cur.root, dir) && !(dir in cur.dirSizes) && !sizeQueue.includes(dir)) sizeQueue.push(dir)
      })
      .catch(() => undefined)
      .finally(() => {
        sizing.delete(dir)
        sizeActive -= 1
        pumpSizes($)
      })
  }
}

function wantSizes($: EngineInterface, dirs: string[]): void {
  for (const dir of dirs) if (!sizing.has(dir) && !sizeQueue.includes(dir)) sizeQueue.push(dir)
  pumpSizes($)
}

async function staleSizes($: EngineInterface, paths?: string[]): Promise<void> {
  sizeEpoch += 1
  sizeQueue = []
  await patch($, cur => {
    if (!paths) return { dirSizes: {} }
    const keep: Record<string, number> = {}
    for (const [dir, bytes] of Object.entries(cur.dirSizes)) if (!paths.some(p => inside(dir, p))) keep[dir] = bytes
    return { dirSizes: keep }
  })
}

function openDirs(t: FileTree): string[] {
  const open = new Set(t.expanded)
  return t.nodes.filter(n => n.kind === 'dir' && n.loaded && open.has(n.id)).map(n => n.id)
}

function keepTop(cur: FileTree, expanded: string[]): Partial<FileTree> {
  if (followClaude) return { scroll: null }
  const top = visibleRows(cur)[cur.scroll ?? view.from]?.node.id
  const at = top ? visibleRows({ ...cur, expanded }).findIndex(r => r.node.id === top) : -1
  return at < 0 ? {} : { scroll: at }
}

async function flash($: EngineInterface, tones: Record<string, string>): Promise<void> {
  const unique = Object.keys(tones)
  if (unique.length === 0) return
  const mine = ++generation
  const root = (await get($)).root
  blink?.cancel()
  blink = null
  await patch($, cur => {
    if (cur.root !== root) return {}
    const open = new Set(cur.expanded)
    const bright = new Set([...(cur.flashOn ? cur.flash.filter(id => !unique.includes(id)) : []), ...unique])
    const dim = new Set<string>()
    const all: Record<string, string> = cur.flashOn ? { ...cur.flashTones } : {}
    if (cur.flashOn) {
      for (const id of cur.flashDim) dim.add(id)
    }
    for (const id of unique) {
      const tone = tones[id] ?? 'orange'
      all[id] = tone
      if (id === BRANCH_ROW) continue
      const chain = ancestorsOf(id, cur.root)
      if (!chain.some(a => !open.has(a))) continue
      for (const a of chain) {
        if (!open.has(a)) {
          dim.add(a)
          all[a] = all[a] ?? tone
        }
        open.add(a)
      }
    }
    for (const id of bright) dim.delete(id)
    return {
      flash: [...bright],
      flashDim: [...dim],
      flashOn: true,
      flashTones: all,
      expanded: [...open],
      ...keepTop(cur, [...open]),
    }
  })
  if (generation !== mine) return
  // The desktop scrolls the pane itself, so following Claude there means asking it to show the row.
  if (followClaude) scrollToRow($, [...unique].reverse().find(id => id !== BRANCH_ROW) ?? '')
  blink = $.clock.after(FLASH_MS, () => {
    if (generation !== mine) return
    blink = null
    void patch($, cur => (generation === mine ? { flash: [], flashDim: [], flashOn: false, flashTones: {} } : {}))
  })
}

/** On the desktop, brings a row into the pane's view once it's drawn; the terminal scrolls by `scroll`. */
function scrollToRow($: EngineInterface, id: string): void {
  if (!nativeScroll || !id) return
  $.clock.after(ROW_SCROLL_MS, () => void $.ui.scroll({ to: { key: id }, in: PANE }).catch(() => undefined))
}

async function goUp($: EngineInterface): Promise<void> {
  follow = false
  await reset($, dirname((await get($)).root))
}

async function goHome($: EngineInterface): Promise<void> {
  follow = true
  await reset($, await cwdOf($))
}

async function refreshAll($: EngineInterface): Promise<void> {
  const cur = await get($)
  searchIndex = null
  await staleSizes($)
  await loadDirs($, [cur.root, ...cur.expanded])
  await detectRepo($)
  await refreshGit($)
  if (cur.query.trim()) await search($, cur.query)
}

function collapseAll($: EngineInterface): Promise<void> {
  return patch($, cur => ({ expanded: [], nodes: dropBelow(cur.nodes, cur.nodes.filter(x => x.parent === cur.root && x.kind === 'dir').map(x => x.id)) }))
}

async function followCwd($: EngineInterface): Promise<boolean> {
  if (!follow) return false
  const cwd = await cwdOf($)
  const t = await get($)
  if (t.root === cwd) return false
  await reset($, cwd)
  return true
}

type Pending = { actions: GitAction[]; ids: number[]; command: string; head: string }
type Job = { actions: GitAction[]; since: Since; initRepo: boolean; readOnly: boolean }
type Background = { p: Pending | null; job: Job; reads: string[] }
type GitOperation = NonNullable<BuiltinToolResults['Bash']['gitOperation']>
type Outcome = { state: 'done' | 'failed'; label: string; detail: string }

const PROOF: Record<string, (op: GitOperation) => boolean> = {
  push: op => Boolean(op.push),
  merge: op => op.branch?.action === 'merged',
  rebase: op => op.branch?.action === 'rebased',
  'pr create': op => op.pr?.action === 'created',
  'pr merge': op => op.pr?.action === 'merged',
  'pr comment': op => op.pr?.action === 'commented',
}

async function startGit($: EngineInterface, actions: GitAction[]): Promise<number[]> {
  const now = await $.clock.now()
  const ids = actions.map(() => ++activityId)
  await setActivities($, cur => [
    ...cur.filter(a => a.state === 'running' || now - a.at < ACTIVITY_TTL_MS),
    ...actions.map((a, i) => ({
      id: ids[i] ?? 0,
      kind: a.kind,
      label: a.running,
      state: 'running' as const,
      detail: '',
      at: now,
      tone: a.tone,
      nerd: a.icon.nerd,
      plain: a.icon.plain,
    })),
  ])
  return ids
}

async function headOf($: EngineInterface, cwd: string): Promise<string> {
  try {
    const run = await git($, cwd, ['rev-parse', 'HEAD'], 5_000)
    return run.exitCode === 0 ? run.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function outcomes($: EngineInterface, p: Pending, ok: boolean, op: GitOperation | undefined): Promise<Outcome[]> {
  const chain = chainOf(p.command)
  const after = p.actions.some(a => a.verb === 'commit') && !op?.commit ? await headOf($, (await get($)).root || (await cwdOf($))) : ''
  return p.actions.map(a => {
    if (a.verb === 'commit') {
      const sha = op?.commit?.sha || (after && after !== p.head ? after : '')
      return sha ? { state: 'done', label: a.done, detail: sha.slice(0, 7) } : { state: 'failed', label: `${a.verb} failed`, detail: '' }
    }
    if ((op && PROOF[a.verb]?.(op)) || (ok && chain.and)) return { state: 'done', label: a.done, detail: '' }
    if (!ok && chain.and && chain.size === 1) return { state: 'failed', label: `${a.verb} failed`, detail: '' }
    return { state: 'done', label: `ran ${a.kind}`, detail: '' }
  })
}

async function finishGit($: EngineInterface, p: Pending, results: Outcome[]): Promise<void> {
  const now = await $.clock.now()
  await setActivities($, cur =>
    cur.map(a => {
      const i = p.ids.indexOf(a.id)
      const result = i < 0 ? undefined : results[i]
      return result ? { ...a, ...result, at: now } : a
    }),
  )
  $.clock.after(ACTIVITY_TTL_MS + 500, () => void setActivities($, cur => cur.filter(a => a.state === 'running' || a.at > now)))
}

function failAll(p: Pending): Outcome[] {
  return p.actions.map(a => ({ state: 'failed', label: `${a.verb} failed`, detail: '' }))
}

function proven(p: Pending | null, results: Outcome[]): GitAction[] {
  return p ? p.actions.filter((_, i) => results[i]?.state !== 'failed') : []
}

function taskEnds(text: string): [string, string][] {
  return [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].flatMap(m => {
    const id = /<task-id>([^<]*)<\/task-id>/.exec(m[1] ?? '')?.[1]?.trim()
    const status = /<status>([^<]*)<\/status>/.exec(m[1] ?? '')?.[1]?.trim()
    return id && status ? [[id, status] as [string, string]] : []
  })
}

async function settleBackground($: EngineInterface, text: string): Promise<void> {
  if (background.size === 0 || !text.includes('<task-notification>')) return
  for (const [id, status] of taskEnds(text)) {
    const task = background.get(id)
    if (!task) continue
    background.delete(id)
    const ok = status === 'completed'
    const results = task.p ? await outcomes($, task.p, ok, undefined) : []
    if (task.p) await finishGit($, task.p, results)
    if (showReads) queuedReads.push(...task.reads)
    scheduleScan($, { ...task.job, actions: proven(task.p, results) })
  }
}

async function gitPaths($: EngineInterface, root: string, prefix: string, committed: boolean): Promise<string[]> {
  const map = mapper(root, prefix)
  try {
    const run = committed
      ? await git($, root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'], 5_000)
      : await git($, root, ['diff', '--cached', '--name-only', '-z'], 5_000)
    return run.exitCode === 0 ? run.stdout.split('\0').filter(Boolean).flatMap(rel => map(rel) ?? []) : []
  } catch {
    return []
  }
}

async function gitDir($: EngineInterface, cwd: string): Promise<string> {
  for (let dir = cwd, i = 0; i < 64; i++) {
    try {
      const dot = join(dir, '.git')
      const st = await $.fs.stat(dot)
      if (st.kind === 'dir') return dot
      const ref = /^gitdir:\s*(.+)$/m.exec(String(await $.fs.read(dot)))?.[1]?.trim()
      if (ref) return resolve(dir, ref, home)
    } catch {
      const up = dirname(dir)
      if (up === dir) return ''
      dir = up
      continue
    }
    return ''
  }
  return ''
}

async function sync($: EngineInterface, force = false): Promise<void> {
  const now = await $.clock.now()
  if (!force && now - lastSync < 2_000) return
  lastSync = now
  searchIndex = null
  const t = await get($)
  if (!t.root) return
  await loadDirs($, [t.root, ...openDirs(t)])
  if (t.top) await refreshGit($)
}

async function copyPath($: EngineInterface, id: string, absolute: boolean, surface?: string): Promise<void> {
  const t = await get($)
  const text = !absolute && id !== t.root && inside(t.root, id) ? id.slice(t.root.endsWith('/') ? t.root.length : t.root.length + 1) : id
  const done = await $.ui.copy({ text, ...(surface ? { surface: surface as 'terminal' } : {}) })
  $.ui.toast(done.isCopied ? `Copied ${text}` : 'Could not copy the path')
}

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function afterBash($: EngineInterface, jobs: Job[]): Promise<void> {
  const reads = queuedReads
  queuedReads = []
  if (await followCwd($)) return
  const t = await get($)
  if (!t.root) return
  const actions = jobs.flatMap(j => j.actions)
  const writers = jobs.filter(j => !j.readOnly)
  const since = (writers.length ? writers : jobs).reduce((a, j) => (j.since.ms < a.ms ? j.since : a), (writers[0] ?? jobs[0])?.since ?? { ms: 0, mark: '', os: 'linux' as const })
  const writes = !jobs.every(j => j.readOnly)
  const before = dirty.root === t.root ? dirty.files : {}
  if (jobs.some(j => j.initRepo)) await detectRepo($)
  else if (!t.top && (await exists($, join(t.root, '.git')))) await detectRepo($)
  const probed = await get($)
  if (probed.top && (writes || probed.top !== t.top)) await refreshGit($)
  if (writes) {
    searchIndex = null
    await staleSizes($)
  }
  const fresh = await get($)
  const ignored = new Set(fresh.ignored)
  const tones: Record<string, string> = {}
  if (writes) {
    const found = fresh.top
      ? await changedInRepo($, t.root, since, before, fresh.ignored)
      : { hits: since.os === 'win32' ? [] : await changedSince($, t.root, since, NO_REPO_DEPTH), gone: [] }
    const hits = found.hits.filter(x => inside(t.root, x) && !underAny(x, ignored, t.root)).slice(0, FIND_LIMIT)
    await revealPaths($, hits)
    const loaded = await get($)
    const dirs = [...new Set([loaded.root, ...openDirs(loaded), ...hits.map(dirname), ...found.gone.map(dirname)])].filter(d => inside(loaded.root, d))
    const listed = await loadDirs($, dirs)
    if (!fresh.top && since.os === 'win32')
      for (const kids of listed.values()) for (const n of kids) if (n.mtime > since.ms && hits.length < FIND_LIMIT) hits.push(n.id)
    await patch($, cur => {
      const ids = new Set(cur.nodes.map(n => n.id))
      return { expanded: cur.expanded.filter(id => ids.has(id)) }
    })
    const present = new Set((await get($)).nodes.map(n => n.id))
    const touchTone = actions.find(a => !['commit', 'push', 'add'].includes(a.verb))?.tone ?? 'orange'
    if (showWrites) for (const id of hits) if (present.has(id)) tones[id] = touchTone
  }
  if (showReads) {
    const found: string[] = []
    for (const r of reads) {
      if (found.length >= READ_REVEAL_LIMIT) break
      if (r !== t.root && inside(t.root, r) && !underAny(r, ignored, t.root) && (await exists($, r))) found.push(r)
    }
    if (found.length) {
      await revealPaths($, found)
      const shown = new Set((await get($)).nodes.map(n => n.id))
      for (const r of found) if (shown.has(r) && !tones[r]) tones[r] = 'purple'
    }
  }
  if (showWrites && actions.length) {
    const final = await get($)
    const committed = actions.some(a => a.verb === 'commit')
    if ((committed || actions.some(a => a.verb === 'add')) && final.top) {
      const paths = (await gitPaths($, final.root, final.prefix, committed)).filter(x => !underAny(x, ignored, final.root)).slice(0, READ_REVEAL_LIMIT)
      await revealPaths($, paths)
      const shown = new Set((await get($)).nodes.map(n => n.id))
      for (const x of paths) if (shown.has(x)) tones[x] = 'green'
    }
    const pushLike = actions.find(a => ['push', 'pull', 'fetch', 'checkout', 'switch', 'branch', 'merge', 'rebase', 'tag'].includes(a.verb) || a.kind.startsWith('gh '))
    if (pushLike) tones[BRANCH_ROW] = pushLike.tone
    else if (committed) tones[BRANCH_ROW] = 'green'
  }
  await flash($, tones)
}

function scheduleScan($: EngineInterface, job: Job): void {
  scanJobs.push(job)
  if (scanning) return
  scanning = (async () => {
    while (scanJobs.length) {
      const jobs = scanJobs
      scanJobs = []
      try {
        await afterBash($, jobs)
      } finally {
        const marks = jobs.map(j => j.since.mark).filter(Boolean)
        if (marks.length) await $.process.run(['rm', '-f', ...marks], { timeoutMs: 3_000 }).catch(() => undefined)
      }
    }
  })().finally(() => {
    scanning = null
  })
}

async function touched($: EngineInterface, paths: string[], tone: string, show: boolean): Promise<void> {
  if (tone !== 'purple' && previewed && paths.map(posix).includes(previewed.path)) previewed = null
  if (await followCwd($)) return
  const t = await get($)
  if (!t.root) return
  const within = paths.map(posix).filter(p => inside(t.root, p))
  if (within.length === 0) return
  if (tone !== 'purple') {
    searchIndex = null
    await staleSizes($, within)
    await revealPaths($, within.map(dirname))
    await loadDirs($, [...new Set(within.map(dirname))].filter(d => inside(t.root, d)))
    await refreshGit($)
  } else await revealPaths($, within)
  if (!show) return
  const tones: Record<string, string> = {}
  for (const p of within) tones[p] = tone
  await flash($, tones)
}

async function reveal($: EngineInterface, paths: string[]): Promise<void> {
  if (await followCwd($)) return
  await revealPaths($, paths)
  await patch($, cur => {
    const open = new Set(cur.expanded)
    for (const p of paths) for (const a of ancestorsOf(p, cur.root)) open.add(a)
    return { expanded: [...open], cursor: paths[paths.length - 1] ?? cur.cursor, scroll: null }
  })
  scrollToRow($, paths[paths.length - 1] ?? '')
}

async function walk($: EngineInterface, root: string, depth: number, limit: number): Promise<string[]> {
  const out: string[] = []
  let level = [root]
  for (let d = 0; d < depth && level.length && out.length < limit; d++) {
    const next: string[] = []
    for (const dir of level) {
      for (const n of (await list($, dir)) ?? []) {
        if (n.kind === 'dir') {
          if (!PRUNE.includes(n.name)) next.push(n.id)
        } else out.push(n.id)
      }
      if (out.length >= limit) break
    }
    level = next
  }
  return out
}

async function listAll($: EngineInterface, t: FileTree): Promise<string[] | null> {
  try {
    if (!t.top && (await osName($)) === 'win32') return await walk($, t.root, rootOfDisk(t.root) ? 3 : 6, 20_000)
    const run = t.top
      ? await git($, t.root, ['ls-files', '-co', '--exclude-standard', '-z'], 10_000)
      : await $.process.run(['find', '-H', t.root, '-xdev', '-maxdepth', rootOfDisk(t.root) ? '3' : '6', ...pruneArgs(t.root), '-type', 'f', '-print0'], { timeoutMs: 10_000 })
    if (t.top && run.exitCode !== 0) return null
    const paths = run.stdout.split('\0').filter(Boolean)
    if (run.isStdoutTruncated) paths.pop()
    return paths.map(p => (isAbsolute(p) ? p : join(t.root, p)))
  } catch {
    return null
  }
}

function indexPaths($: EngineInterface, t: FileTree): Promise<string[]> {
  if (searchIndex?.root !== t.root) {
    const index: { root: string; paths: Promise<string[]> } = {
      root: t.root,
      paths: listAll($, t).then(paths => {
        if (paths === null && searchIndex === index) searchIndex = null
        return paths ?? []
      }),
    }
    searchIndex = index
  }
  return searchIndex.paths
}

async function search($: EngineInterface, query: string): Promise<string[]> {
  if (!(await get($)).query.trim()) searchIndex = null
  await patch($, () => ({ query }))
  const q = query.trim().toLowerCase()
  if (!q) return []
  const t = await get($)
  const hits = (await indexPaths($, t)).filter(p => relative(t.root, p).toLowerCase().includes(q)).slice(0, SEARCH_REVEAL_LIMIT)
  if ((await get($)).query !== query) return []
  await revealPaths($, hits)
  const shown = await get($)
  const ids = new Set(shown.nodes.map(n => n.id))
  const stale = [...new Set(hits.filter(p => !ids.has(p)).map(dirname))].filter(d => inside(shown.root, d))
  if (stale.length) await loadDirs($, stale)
  return hits
}

async function jump($: EngineInterface, query: string): Promise<void> {
  const hits = (await search($, query)).slice(0, 10)
  await patch($, cur => {
    const open = new Set(cur.expanded)
    for (const p of hits) for (const a of ancestorsOf(p, cur.root)) open.add(a)
    return { query: '', expanded: [...open], cursor: hits[0] ?? cur.cursor, scroll: null }
  })
  scrollToRow($, hits[0] ?? '')
}

async function fontState($: EngineInterface, charset: string): Promise<'ok' | 'stale' | 'missing'> {
  try {
    const out = (await $.process.run(['sh', '-c', FONT_SCRIPT, 'sh', charset], { timeoutMs: 5_000 })).stdout.trim()
    return out === 'stale' || out === 'missing' ? out : 'ok'
  } catch {
    return 'missing'
  }
}

async function finePointerOk($: EngineInterface): Promise<boolean> {
  if (!(await $.env.get('HERDR_ENV'))) return true
  try {
    const out = (await $.process.run([(await $.env.get('HERDR_BIN_PATH')) || 'herdr', '--version'], { timeoutMs: 3_000 })).stdout
    const [major = 0, minor = 0, fix = 0] = (/(\d+)\.(\d+)\.(\d+)/.exec(out) ?? []).slice(1).map(Number)
    return major * 1e6 + minor * 1e3 + fix >= 9_001
  } catch {
    return false
  }
}

const PREVIEW_CHARS = 90_000
const PREVIEW_LINE = 2_000

function fitSerialized(lines: string[], max: number): string[] {
  let size = 0
  for (let i = 0; i < lines.length; i++) {
    size += JSON.stringify(lines[i]).length
    if (size > max) return lines.slice(0, i)
  }
  return lines
}

async function loadPreview($: EngineInterface, path: string): Promise<void> {
  let text = ''
  let note = ''
  try {
    const stat = await $.fs.stat(path)
    if (stat.size > 4_000_000) note = `${formatSize(stat.size)}, too large to preview`
    else {
      text = await $.fs.read(path)
      if (text.slice(0, 8000).includes('\0')) {
        text = ''
        note = `binary file, ${formatSize(stat.size)}`
      }
    }
  } catch (err) {
    note = `could not read: ${String((err as Error)?.message ?? err).split('\n')[0]}`
  }
  const total = text.length
  let lines = text.slice(0, PREVIEW_CHARS).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split('\n')
  if (total > PREVIEW_CHARS && lines.length > 1) lines.pop()
  lines = lines.map(l => (l.length > PREVIEW_LINE ? `${l.slice(0, PREVIEW_LINE)}…` : l))
  const fit = fitSerialized(lines, PREVIEW_CHARS)
  if (total > PREVIEW_CHARS || fit.length < lines.length) note = `first ${fit.length.toLocaleString('en')} lines of ${total.toLocaleString('en')} characters`
  previewed = { path, text: fit.join('\n'), note }
}

async function showPreview($: EngineInterface, path: string): Promise<void> {
  await loadPreview($, path)
  await patch($, () => ({ preview: path, previewTop: 0, selected: path }))
}

async function closePreview($: EngineInterface): Promise<void> {
  await patch($, () => ({ preview: '', previewTop: 0 }))
}

async function scrollPreview($: EngineInterface, by: number): Promise<void> {
  const t = await get($)
  const last = Math.max(0, (previewed?.text.split('\n').length ?? 1) - previewRows)
  const top = Math.max(0, Math.min(last, t.previewTop + by))
  if (top !== t.previewTop) await patch($, () => ({ previewTop: top }))
}

function previewLines(text: string, top: number, rows: number, markdown: boolean): { text: string; top: number } {
  const lines = text.split('\n')
  const from = Math.max(0, Math.min(top, lines.length - 1))
  let shown = lines.slice(from, from + rows)
  if (markdown) {
    // Reopen a code fence the window starts inside, so the rest is not read as prose.
    let fence = ''
    let opener = ''
    for (const line of lines.slice(0, from)) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (!m) continue
      const mark = m[1] ?? ''
      if (!fence) {
        fence = mark
        opener = line.trimStart()
      } else if (mark[0] === fence[0] && mark.length >= fence.length && !(m[2] ?? '').trim()) fence = ''
    }
    if (fence) shown = [opener, ...shown]
  }
  return { text: shown.join('\n'), top: from }
}

async function openFile($: EngineInterface, path: string, external = false): Promise<void> {
  if (!external && openWithSetting.trim() === 'preview') return showPreview($, path)
  const os = await osName($)
  const native = (p: string) => (os === 'win32' ? p.replace(/\//g, '\\') : p)
  const custom = external ? null : openWithCommand(openWithSetting, native(path), native(dirname(path)))
  const { argv, init } = custom ? { argv: os === 'linux' ? ['sh', '-c', LINUX_LAUNCH, 'sh', ...custom] : custom, init: { timeoutMs: 10_000 } } : openCommand(os, path)
  try {
    const run = await $.process.run(argv, init)
    if (run.exitCode !== 0) $.ui.toast(`could not open ${path} with ${custom?.[0] ?? argv[0]}: ${run.stderr.trim().split('\n')[0] || `exit ${run.exitCode}`}`)
  } catch {
    $.ui.toast(`could not open ${path} with ${custom?.[0] ?? argv[0]}`)
  }
}

async function toggle($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir' && !(await get($)).expanded.includes(n.id)) await loadDirs($, [n.id])
  await patch($, t => {
    const open = new Set(t.expanded)
    if (n.kind === 'dir') open.has(n.id) ? open.delete(n.id) : open.add(n.id)
    return { expanded: [...open], cursor: n.id, selected: n.kind === 'dir' ? t.selected : n.id }
  })
}

async function press($: EngineInterface, n: FileNode): Promise<void> {
  const now = await $.clock.now()
  const isDouble = lastPress.key === n.id && now - lastPress.at < DOUBLE_MS
  lastPress = { key: isDouble ? '' : n.id, at: now }
  if (!isDouble) {
    await toggle($, n)
    return
  }
  await openNode($, n)
}

async function openNode($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir') {
    follow = false
    await reset($, n.id)
  } else await openFile($, n.id)
}

function shortPath(path: string): string {
  return home && inside(home, path) ? `~${path.slice(home.length)}` : path
}

/**
 * The tree's first look in a session: whether the pointer is fine, whether a Nerd
 * Font is there, and what the last session left (a flash, a preview, git steps
 * still running) cleared.
 */
async function firstLook($: EngineInterface): Promise<void> {
  pointer = await finePointerOk($)
  try {
    const remote = Boolean((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY')))
    noNerd = !remote && ((await $.env.get('OS')) === 'Windows_NT' || (await fontState($, 'f04eb')) !== 'ok')
  } catch {
    noNerd = true
  }
  const t = await get($)
  if (t.flashOn) await patch($, () => ({ flash: [], flashDim: [], flashOn: false, flashTones: {} }))
  if (t.preview) await patch($, () => ({ preview: '', previewTop: 0 }))
  await setActivities($, cur => cur.map(a => (a.state === 'running' ? { ...a, state: 'failed', label: `${a.kind} interrupted` } : a)))
}

/** The pane of a mod that draws the tree in its own pane (a tab of it) rather than filetree's; null in filetree's own. */
let host: string | null = null
/** Whether a host's tree is on screen: set as it draws, cleared by `hideTree`. */
let onScreen = false
/** Whether a host's tree has caught up since it came on screen. */
let caughtUp = false
/** Whether a host's tree has made the session's reads and its first look. */
let looked = false
/** A host's pinned folder (`pinTree`); null, the tree follows the cwd. */
let pinned: string | null = null

/** The reads every session needs before the tree reads anything: the OS, home, the last activity's id. */
async function sessionReads($: EngineInterface): Promise<void> {
  useDrives((await $.env.get('OS')) === 'Windows_NT')
  home = posix(((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/[\\/]+$/, ''))
  activityId = Math.max(activityId, ...(await activities($)).map(a => a.id))
}

/**
 * A host's tree just drew, so it's on screen. The first draw since it came on
 * screen catches up, on a timer since a drawing writes nothing: the session's
 * reads and the first look the first time, then the folder listed (the cwd, or
 * the pinned one) when the tree isn't on it, or what changed while it was off.
 */
function drawnInHost($: EngineInterface): void {
  onScreen = true
  if (caughtUp) return
  caughtUp = true
  $.clock.after(0, () => void catchUp($).catch(() => undefined))
}

async function catchUp($: EngineInterface): Promise<void> {
  if (!looked) {
    looked = true
    await sessionReads($)
    await firstLook($)
  }
  const cwd = await cwdOf($)
  follow = pinned === null
  const want = pinned === null ? cwd : resolve(cwd, pinned, home)
  const t = await get($)
  if (t.root !== want || t.nodes.length === 0) await reset($, want)
  else await sync($)
}

/** For a host: the tree went off screen (another tab, the pane hidden); its hooks pass through until it draws again. */
export function hideTree(): void {
  onScreen = false
  caughtUp = false
}

/** For a host: the folder the tree shows from its next draw (`root`, pinned), or the cwd, followed (null). */
export function pinTree(root: string | null): void {
  pinned = root
  caughtUp = false
}

/** In a host's pane while the tree is off screen: every hook then passes straight through. */
function hidden(): boolean {
  return host !== null && !onScreen
}

/** The tree's watch on Claude's edits, writes and Bash commands (git steps, files changed, reads). */
const watchTool: Hook<'tool.call'> = async ($, e, next) => {
  {
    if (hidden()) return next(e)
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit' && e.tool !== 'Bash') return next(e)
    const command = e.tool === 'Bash' ? e.command : ''
    const cwd = e.tool === 'Bash' ? await cwdOf($) : ''
    const actions = gitActions(command)
    const quiet = !actions.length && readOnly(command)
    const since = await sinceNow($, e.tool === 'Bash' && !quiet)
    const before = actions.some(a => a.verb === 'commit') ? await get($) : null
    const head = before?.top ? await headOf($, before.root) : ''
    const pending: Pending | null = actions.length ? { actions, ids: await startGit($, actions), command, head } : null
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (err) {
      if (pending) await finishGit($, pending, failAll(pending))
      if (since.mark) void $.process.run(['rm', '-f', since.mark], { timeoutMs: 3_000 }).catch(() => undefined)
      throw err
    }
    if (pending && result.deny) {
      const ids = pending.ids
      void setActivities($, cur => cur.filter(a => !ids.includes(a.id)))
    }
    if (result.deny || (result.isError && e.tool !== 'Bash')) {
      if (since.mark) void $.process.run(['rm', '-f', since.mark], { timeoutMs: 3_000 }).catch(() => undefined)
      return result
    }
    if (e.tool === 'Bash') {
      const out: Partial<BuiltinToolResults['Bash']> = !result.isError && result.result && typeof result.result === 'object' ? result.result : {}
      const reads = showReads ? readTargets(command, cwd, typeof out.stdout === 'string' ? out.stdout : '', home) : []
      const job: Job = { actions: [], since, initRepo: actions.some(a => a.init), readOnly: quiet || result.isReadOnly === true }
      if (out.backgroundTaskId) background.set(out.backgroundTaskId, { p: pending, job, reads })
      else void (async () => {
        const results = pending ? await outcomes($, pending, !result.isError, out.gitOperation) : []
        if (pending) await finishGit($, pending, results)
        queuedReads.push(...reads)
        scheduleScan($, { ...job, actions: proven(pending, results) })
      })()
      if (follow && /(^|[;&|\s])(cd|pushd|popd)(\s|$)/.test(command)) $.clock.after(400, () => void followCwd($))
    } else {
      const file =
        'file_path' in e && typeof e.file_path === 'string'
          ? e.file_path
          : 'notebook_path' in e && typeof e.notebook_path === 'string'
            ? e.notebook_path
            : ''
      if (file) void touched($, [file], 'orange', showWrites)
    }
    return result
  }
}

/** filetree's own pane: `/filetree` opens it, and the tree reads its folder as the session starts. */
export const register: Register = (on, options) => {
  attach(on, options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'filetree', description: 'Show the file tree; args: [path] (no path = cwd)' })
    await sessionReads($)
    void (async () => {
      await firstLook($)
      const t = await get($)
      const cwd = await cwdOf($)
      if (!t.root || t.nodes.length === 0 || (follow && t.root !== cwd)) await reset($, cwd)
      else if (!noDock) await $.ui.open({ id: PANE, title: TAB })
    })()
    return next(e)
  })

  on('command.run', { command: 'filetree' }, async ($, e) => {
    // The layout checks are the terminal's: the desktop app docks the pane itself and
    // reports no fullscreen layout, so a session no terminal draws skips them.
    const terminal = await $.session.surfaces().then(s => s.includes('terminal'), () => true)
    if (terminal && !e.presentation.isFullscreen) return { text: 'filetree shows in the sidebar, which needs the fullscreen layout. Run /tui fullscreen, then /filetree.' }
    if (terminal && e.presentation.columns < 110) return { text: 'filetree shows in the sidebar, which needs a terminal at least 110 columns wide. Widen it, then run /filetree.' }
    noDock = false
    const arg = (e.args ?? '').trim()
    const cwd = await cwdOf($)
    follow = !arg
    const root = arg ? resolve(cwd, arg, home) : cwd
    await reset($, root, true)
    return { text: `File tree on ${shortPath(root)}${follow ? ' (follows the cwd)' : ''}.` }
  })
}

/**
 * Every hook of the tree but filetree's own pane's (its session start and
 * `/filetree`, in `register`). A host, a mod that draws the tree in a tab of its
 * own pane (syns' dashboard copies this folder), calls it with that `pane` and
 * after its own render hook for the pane, so its render is the outer one: it
 * draws its tabs and, for the tree's tab, `next(e)` draws the tree (with
 * `e.props.scroll.bodyRows` less its own rows). The tree then reads nothing until
 * it first draws, and the host calls `hideTree` when it goes off screen; while
 * off screen every hook passes straight through, so nothing is read or watched.
 */
export const attach = (on: Parameters<Register>[0], options: Parameters<Register>[1], pane?: string) => {
  host = pane ?? null
  if (host) PANE = host
  glyphSetting = typeof options?.glyphs === 'string' ? options.glyphs : 'auto'
  const activity = typeof options?.activity === 'string' ? options.activity : 'reads and writes'
  showReads = activity.includes('reads')
  showWrites = activity.includes('writes')
  followClaude = options?.follow !== 'off'
  sizeDefault = options?.column === 'size'
  openWithSetting = typeof options?.open === 'string' ? options.open : ''

  // Matched, as a host may have an unmatched tool.call hook of its own, and a plugin takes one.
  on('tool.call', { tool: /^(Edit|Write|NotebookEdit|Bash)$/ }, watchTool)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (!host && e.surface === 'terminal' && e.props.placement === 'inline') {
      noDock = true
      void $.ui.close({ id: PANE }).catch(() => undefined)
      const { Box: Empty } = $.ui.resolve(e)
      return <Empty />
    }
    if (host) drawnInHost($)
    const t = await get($)
    // One table for the whole render, its Buttons keeping their press handles across
    // redraws, so a click made just before one still lands. In a host's pane, a scope
    // of its own: the host's render holds its own Buttons under the render's.
    return drawTree($, e, holdButtons($.ui.resolve(e), host ? `${PANE}\u0000tree\u0000${e.surface}` : e), t)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (hidden()) return next(e)
    const result = await next(e)
    if (result.deny || result.isError || e.tool !== 'Read' || !showReads) return result
    void touched($, [posix(e.file_path)], 'purple', true)
    return result
  })

  on('ui.message', async ($, e, next) => {
    if (hidden()) return next(e)
    if (e.requestId !== PANE || e.element !== 'rows' || !e.data || typeof e.data !== 'object') return next(e)
    const data = e.data as { press?: unknown; key?: unknown; ctrl?: unknown; shift?: unknown; scrollTo?: unknown; copy?: unknown }
    void sync($)
    const t = await get($)
    if (typeof data.copy === 'string') {
      await copyPath($, data.copy, Boolean(data.shift), e.surface)
      return {}
    }
    if (typeof data.scrollTo === 'number') {
      const to = Math.round(Math.max(0, Math.min(1, data.scrollTo)) * view.max)
      if (to !== t.scroll) await patch($, () => ({ scroll: to }))
      return {}
    }
    if (typeof data.press === 'string') {
      const n = t.nodes.find(x => x.id === data.press)
      if (!n) return {}
      if (t.scroll === null) await patch($, () => ({ scroll: view.from }))
      if (data.ctrl || data.shift) await openNode($, n)
      else await press($, n)
      return {}
    }
    if (typeof data.key !== 'string') return {}
    if (t.preview) {
      const page = Math.max(1, previewRows - 2)
      const by: Record<string, number> = { up: -1, k: -1, down: 1, j: 1, pageup: -page, pagedown: page, home: -Infinity, end: Infinity }
      if (data.key === 'left' || data.key === 'h') await closePreview($)
      else if (data.key in by) await scrollPreview($, by[data.key] ?? 0)
      return {}
    }
    const rows = visibleRows(t)
    const at = rows.findIndex(r => r.node.id === t.cursor)
    const cur = rows[at]?.node
    const move = (d: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + d))]
      return target ? patch($, () => ({ cursor: target.node.id, scroll: null })) : Promise.resolve()
    }
    if (data.key === 'up' || data.key === 'k') await move(-1)
    else if (data.key === 'down' || data.key === 'j') await move(1)
    else if (data.key === 'pageup') await move(-10)
    else if (data.key === 'pagedown') await move(10)
    else if (data.key === 'home') await move(-rows.length)
    else if (data.key === 'end') await move(rows.length)
    else if (cur && (data.key === 'y' || data.key === 'Y')) await copyPath($, cur.id, data.key === 'Y' || Boolean(data.shift), e.surface)
    else if (cur && (data.key === 'right' || data.key === 'l') && cur.kind === 'dir' && !t.expanded.includes(cur.id)) await toggle($, cur)
    else if (cur && (data.key === 'left' || data.key === 'h')) {
      if (cur.kind === 'dir' && t.expanded.includes(cur.id)) await toggle($, cur)
      else if (cur.parent !== t.root) await patch($, () => ({ cursor: cur.parent }))
    } else if (cur && data.key === 'return') await (cur.kind !== 'dir' ? openNode($, cur) : toggle($, cur))
    else if (cur && data.key === ' ') await toggle($, cur)
    return {}
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (hidden()) return next(e)
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      void (async () => {
        const root = follow || !lastRoot ? await cwdOf($) : lastRoot
        const t = await get($)
        if (t.root !== root || t.nodes.length === 0) await reset($, root)
      })()
    }
    const gd = await gitDir($, posix(e.cwd))
    return gd ? { ...result, watchPaths: [...(result.watchPaths ?? []), join(gd, 'index'), join(gd, 'HEAD')] } : result
  })

  on('classic.CwdChanged', async ($, e, next) => {
    if (hidden()) return next(e)
    const result = await next(e)
    void followCwd($)
    return result
  })

  on('classic.FileChanged', async ($, e, next) => {
    if (hidden()) return next(e)
    const result = await next(e)
    if (/[\\/]\.git[\\/]|[\\/](index|HEAD)$/.test(e.file_path)) $.clock.after(300, () => void sync($, true))
    return result
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (hidden()) return next(e)
    const result = await next(e)
    void sync($)
    return result
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (nativeScroll || hidden()) return next(e)
    const t = await get($)
    if (t.preview) {
      await scrollPreview($, Math.sign(e.by) * Math.max(3, Math.abs(e.by)))
      return {}
    }
    const to = Math.max(0, Math.min(view.max, (t.scroll ?? view.from) + Math.sign(e.by) * Math.max(3, Math.abs(e.by))))
    if (to !== t.scroll) await patch($, () => ({ scroll: to }))
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    if (hidden()) return next(e)
    void settleBackground($, e.text)
    if (!(await followCwd($))) void sync($)
    const t = await get($)
    const context = [...(e.context ?? [])]
    if (t.selected && (await exists($, t.selected))) context.push(`The user has this file selected in the file tree; "this" or "it" in the prompt likely refers to it: ${t.selected}`)
    const mentions = [...e.text.matchAll(/@([^\s"'`]+)/g)]
      .map(m => (m[1] ?? '').replace(/[.,;:!?)]+$/, ''))
      .filter(Boolean)
      .map(p => resolve(t.root, p, home))
      .filter(p => inside(t.root, p))
    if (mentions.length) {
      void (async () => {
        const found: string[] = []
        for (const p of mentions) {
          try {
            await $.fs.stat(p)
            found.push(p.replace(/\/$/, ''))
          } catch {
            continue
          }
        }
        if (found.length) await reveal($, found)
      })()
    }
    return next(context.length ? { ...e, context } : e)
  })

  on('prompt.attachment', async ($, e, next) => {
    if (hidden()) return next(e)
    void settleBackground($, e.text)
    return next(e)
  })
}

/** The tree, drawn for one render of its pane: `els` is that render's table (through `holdButtons`), `t` the tree as read at its start. */
async function drawTree($: EngineInterface, e: RenderInput<'Pane', 'terminal' | 'desktop'>, els: Elements['terminal'] | Elements['desktop'], t: FileTree): Promise<RenderElement> {
  // (A block, so the drawing keeps the indent it had inside the render hook.)
  {
    const unicode = glyphSetting === 'plain' || (glyphSetting === 'auto' && (noNerd || e.surface === 'desktop'))
    const { Box, Text, Button, Input, Client } = els
    const terminal = e.surface === 'terminal'
    const width = Math.max(24, e.props.bodyColumns)
    // The kit, told whether the pane has the keyboard: key hints show only then, and
    // the cursor row's mark is dim without it. No background or text hex reaches the
    // terminal: the pane draws on the terminal's own background in theme keys.
    const k = kit(els, terminal ? 'terminal' : 'desktop', width, { focused: e.props.isFocused })
    const focused = k.focused
    // The desktop tab never hands the wheel or the scrollbar drag to the pane, so
    // there it draws every row and lets the engine scroll the body.
    nativeScroll = e.surface === 'desktop'
    if (t.preview) {
      if (previewed?.path !== t.preview) await loadPreview($, t.preview)
      const p = previewed
      const markdown = /\.(md|markdown|mdx)$/i.test(t.preview)
      const all = (p?.text ?? '').split('\n').length
      const hints = k.hints('keys', PREVIEW_HINTS)
      // The header, the note, the blank row the terminal's section leaves under it, and the hints.
      previewRows = nativeScroll ? all : Math.max(4, (e.props.scroll?.bodyRows ?? 40) - (p?.note ? 2 : 1) - (terminal ? 1 : 0) - (hints ? 1 : 0))
      const win = previewLines(p?.text ?? '', nativeScroll ? 0 : Math.min(t.previewTop, Math.max(0, all - previewRows)), previewRows, markdown)
      const name = t.preview !== t.root && inside(t.root, t.preview) ? relative(t.root, t.preview) : shortPath(t.preview)
      const back = unicode ? '← files' : '\u{f004d} files'
      const rows = (
        <Client
          key="rows"
          module="./rows.tsx"
          props={{ rows: [], active: '', mark: MARK.selected, focused, tones: SHIMMER, pointer: false, preview: { text: win.text, path: t.preview, startLine: win.top + 1, markdown } } satisfies RowsProps}
        />
      )
      if (terminal) {
        // The file as a section of its own: its path the bold title, cut in the middle to
        // what the actions leave it, a dim rule, then open-outside and back, both quiet.
        // The note (binary, too large, the first lines only) is a dim line under it.
        const external = unicode ? '↗' : '\u{f08e}'
        const right = k.actions('preview', [
          { key: 'external', label: external, quiet: true, onPress: () => void openFile($, t.preview, true) },
          { key: 'back', label: back, quiet: true, onPress: () => void closePreview($) },
        ])
        // The arrow column, the gap and the shortest rule before the actions, the actions and their gap.
        const room = width - k.edge.left - k.edge.right - k.space.item * 2 - 1 - [...external].length - k.space.group - [...back].length
        return (
          <Box flexDirection="column" minHeight={Math.max(1, e.props.scroll?.bodyRows ?? 1)}>
            {k.section({
              id: 'preview',
              title: middle(name, Math.max(6, room)),
              right,
              keepRight: true,
              children: [p?.note ? k.note('note', p.note) : null, rows],
            })}
            {hints ? <Box flexGrow={1} /> : null}
            {hints ? (
              <Box key="hints" paddingLeft={k.edge.left}>
                {hints}
              </Box>
            ) : null}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" minHeight={Math.max(1, e.props.scroll?.bodyRows ?? 1)}>
          <Box flexDirection="row">
            <Button key="back" plain label={back} onPress={() => void closePreview($)} />
            <Text> </Text>
            <Box flexShrink={1} flexGrow={1} minWidth={0}>
              <Text bold wrap="truncate-start">
                {name}
              </Text>
            </Box>
            <Button key="external" plain dimColor label={unicode ? '↗' : '\u{f08e}'} onPress={() => void openFile($, t.preview, true)} />
          </Box>
          {p?.note ? <Text dimColor>{p.note}</Text> : null}
          {rows}
          {hints ? <Box flexGrow={1} /> : null}
          {hints}
        </Box>
      )
    }
    const now = await $.clock.now()
    const live = (await activities($)).filter(a => now - a.at < (a.state === 'running' ? RUNNING_MAX_MS : ACTIVITY_TTL_MS))
    const latest = [...live].reverse().find(a => a.state === 'running') ?? live[live.length - 1]
    const bright = new Set(t.flashOn ? t.flash : [])
    const dimmed = new Set(t.flashOn ? t.flashDim : [])
    const ignored = new Set(t.ignored)
    const untracked = new Set(t.untrackedDirs)
    const rows = visibleRows(t)
    // In the rows' text column, one cell in from the section body.
    const hints = k.hints('keys', TREE_HINTS, { width: k.width - 1 })
    // The terminal's rows around the tree: the search line and the blank row under it,
    // the header and the blank row an open section leaves under its body, the branch
    // line (or the no-repo note), the empty note, the footer and the key hints.
    const fixed = 4 + (t.top ? (t.branch ? 1 : 0) : 1) + (rows.length === 0 ? 1 : 0) + (t.selected || latest ? 1 : 0) + (hints ? 1 : 0)
    const room = nativeScroll ? Math.max(1, rows.length) : Math.max(5, (e.props.scroll?.bodyRows ?? 40) - fixed)
    const isLit = (id: string) => bright.has(id) || dimmed.has(id)
    const focus = followClaude && t.flashOn ? ([...t.flash].reverse().find(id => id !== BRANCH_ROW) ?? t.cursor) : t.cursor
    const at = Math.max(0, rows.findIndex(r => r.node.id === focus))
    const lit = followClaude && t.flashOn ? rows.findIndex(r => isLit(r.node.id)) : -1
    const cap = Math.max(1, Math.floor(room / 3))
    let from = Math.max(0, Math.min(lit >= 0 && at - lit < room - 2 ? Math.max(0, lit - 1) : at - Math.floor(room / 2), rows.length - room))
    let pinned = !nativeScroll && followClaude && t.flashOn ? rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap) : []
    if (pinned.length) {
      const rest = Math.max(3, room - pinned.length)
      from = Math.max(0, Math.min(at - Math.floor(rest / 2), rows.length - rest))
      pinned = rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap)
    }
    const max = Math.max(0, rows.length - room)
    if (t.scroll !== null) {
      from = Math.max(0, Math.min(t.scroll, max))
      pinned = []
    }
    view = { from, max }
    const shown = rows.slice(from, from + room - pinned.length)
    if (t.showSize) wantSizes($, [...pinned, ...shown].filter(r => r.node.kind === 'dir' && !(r.node.id in t.dirSizes)).map(r => r.node.id))
    if (e.surface === 'desktop') {
      return renderDesktop(
        // The desktop's table, resolved above before the surface narrowed.
        els as DesktopElements,
        {
          t,
          rows,
          latest,
          follow,
          now,
          columns: width,
          bodyRows: e.props.scroll?.bodyRows ?? 1,
          shown: p => (p !== t.root && inside(t.root, p) ? relative(t.root, p) : shortPath(p)),
          branchRow: BRANCH_ROW,
        },
        {
          up: () => void goUp($),
          home: () => void goHome($),
          refresh: () => void refreshAll($),
          hidden: () => void patch($, cur => ({ showHidden: !cur.showHidden })),
          sizes: () => void patch($, cur => ({ showSize: !cur.showSize })),
          collapse: () => void collapseAll($),
          unselect: () => void patch($, () => ({ selected: '' })),
          press: id =>
            void (async () => {
              void sync($)
              const n = (await get($)).nodes.find(x => x.id === id)
              if (n) await press($, n)
            })(),
          open: id =>
            void (async () => {
              const n = (await get($)).nodes.find(x => x.id === id)
              if (n) await openNode($, n)
            })(),
          search: q => void search($, q),
          jump: q => void jump($, q),
        },
      )
    }
    // The terminal, in the kit's terminal design system: the folder as a section
    // header with its actions on the right, and in its body (two cells in) the branch
    // line, the search field and the tree, each row `[gutter][TREE connector][icon]
    // name … figures status`; icons share one column, names the next. No measure: a
    // tree wants every cell for its names. Colour is only on what says a state: a
    // name's git state, the branch line's totals, the context file's icon, Claude's
    // activity; the figures after a name are dim. The cursor
    // row is the kit's selected list row: `▌` in the gutter and the name bold (the
    // mark dim and the weight plain while the pane hasn't the keyboard).
    /** A kit colour's terminal ink as a row run's fields. */
    const ink = (color?: string): Pick<Seg, 'c' | 'dc'> => {
      const i = termInk(color)
      return { c: i.color, dc: i.dimColor }
    }
    const cells = (segs: Seg[]) => segs.reduce((sum, s) => sum + [...s.t].length, 0)
    const totals: [number, number] = t.top ? (t.diff[t.root] ?? [0, 0]) : [0, 0]
    /** A folder's file counts: the letter, the figure, its colour (the branch line's). */
    const countParts = (c: [number, number, number] | undefined): [string, number, string][] =>
      c
        ? ([
            ['?', c[0], C.ok],
            ['M', c[1], C.warn],
            ['D', c[2], C.bad],
          ] as [string, number, string][]).filter(([, n]) => n > 0)
        : []
    /** On a folder's row, dim as the rest of a row's meta. */
    const countSegs = (c: [number, number, number] | undefined): Seg[] => countParts(c).map(([letter, n]) => ({ t: ` ${letter}${n}`, ...ink(MUTED) }))
    const header = t.top ? [t.top.split('/').pop() ?? t.top, t.prefix.replace(/\/$/, '')].filter(Boolean).join('/') : t.root.split('/').pop() || t.root

    // Each row's connector, from the whole list so it holds while the view scrolls:
    // walking up from the bottom, `more[d]` says whether a later row sits at depth d
    // under the same parent (a pipe above it, a tee rather than an elbow). The top
    // level has none (the kit's `treePrefix` at depth 0), so its icons stand in the
    // column of the branch line's and the search line's, and a child's connector
    // starts under its folder's icon.
    const prefixes = new Map<string, string>()
    const more: boolean[] = []
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!
      more.length = Math.min(more.length, r.depth + 1)
      prefixes.set(r.node.id, treePrefix(Array.from({ length: Math.max(0, r.depth - 1) }, (_, j) => Boolean(more[j + 1])), !more[r.depth], r.depth))
      more[r.depth] = true
    }
    const scrolls = !nativeScroll && rows.length > shown.length + pinned.length

    const rowSpec = (r: (typeof rows)[number]): RowSpec => {
      const n = r.node
      const own = t.git[n.id]
      const status = own ?? (underAny(dirname(n.id), untracked, t.root) ? '?' : undefined)
      const isIgnored = !status && underAny(n.id, ignored, t.root)
      const isBright = bright.has(n.id)
      const isDim = !isBright && dimmed.has(n.id)
      const tone = t.flashTones[n.id] ?? 'orange'
      const loc = t.diff[n.id]
      const meta = t.showSize
        ? n.kind === 'dir'
          ? n.id in t.dirSizes
            ? formatSize(t.dirSizes[n.id] ?? -1)
            : '…'
          : n.kind === 'file' || (n.kind === 'link' && n.size > 0)
            ? formatSize(n.size)
            : ''
        : loc || n.kind !== 'file' || !n.mtime
          ? ''
          : ago(now - n.mtime)
      // Everything after the name is meta, dim: the name's colour says the file's git
      // state, and the letter, the lines changed and a folder's counts say it in words,
      // without a second and third colour on the row.
      const right: Seg[] = []
      if (meta) right.push({ t: ` ${meta}`, ...ink(MUTED) })
      if (loc && loc[0] > 0) right.push({ t: ` +${loc[0]}`, ...ink(MUTED) })
      if (loc && loc[1] > 0) right.push({ t: ` −${loc[1]}`, ...ink(MUTED) })
      const dirCounts = n.kind === 'dir' ? countSegs(t.counts[n.id]) : []
      right.push(...dirCounts)
      // The status letter's column, kept when empty so the figures line up.
      if (!dirCounts.length) {
        right.push(status ? { t: ` ${status}`, ...ink(MUTED) } : isIgnored ? { t: unicode ? ' ⊘' : ' \u{f05e}', ...ink(MUTED) } : { t: '  ' })
      }
      const tree = prefixes.get(n.id) ?? ''
      // The name gets what the gutter, the connector, the icon, the figures, a cell's gap and the scrollbar (a gap and its thumb) leave.
      const room = Math.max(4, k.width - 1 - [...tree].length - 2 - cells(right) - 1 - (scrolls ? 2 : 0))
      const name = [...n.name].length > room ? [...n.name].slice(0, room - 1).join('') + '…' : n.name
      // Plain glyphs: the kit's folder (its fold arrow, as TERM_GLYPH draws it) and file.
      const glyph = unicode ? (n.kind === 'dir' ? (r.open ? '▾' : '▸') : '□') : fileIcon(n, r.open, n.kind === 'dir' && n.id === t.top)
      const lit = isBright || isDim
      // A folder's git state is only its files' rolled up: its dim counts say it, and its
      // name stays plain unless the folder itself is new (untracked as a whole).
      const rolledUp = n.kind === 'dir' && status !== undefined && !untracked.has(n.id) && !underAny(dirname(n.id), untracked, t.root)
      const nameInk = isIgnored || n.hidden ? ink(MUTED) : status && !rolledUp ? ink(statusColor(status)) : {}
      // The cursor row's name is bold while the pane has the keyboard (the kit's selected row);
      // the file selected as Claude's context has its icon in blue, what's live.
      const bold = n.id === t.cursor && focused ? true : undefined
      const left: Seg[] = [
        { t: tree, ...ink(MUTED) },
        lit ? { t: glyph + ' ', sh: tone, dim: isDim, one: true } : { t: glyph + ' ', ...ink(n.id === t.selected ? C.blue : MUTED) },
        lit ? { t: name, sh: tone, dim: isDim, b: isBright || bold } : { t: name, ...nameInk, b: bold, s: status === 'D' && n.kind !== 'dir' },
      ]
      return { id: n.id, left: clean(left), right: clean(right) }
    }

    const specs: RowSpec[] = [
      ...pinned.map(rowSpec),
      ...(pinned.length > 0 ? [{ id: '', left: [{ t: '⋮', dc: true }], right: [] }] : []),
      ...shown.map(rowSpec),
    ]
    const barSize = Math.max(1, Math.round((specs.length * shown.length) / Math.max(1, rows.length)))
    const bar = scrolls ? { pos: max ? Math.round((from / max) * (specs.length - barSize)) : 0, size: barSize } : undefined

    // The branch: its name, then ahead, behind and the upstream's host mark dim (none
    // when the branch tracks nothing); on the right the lines and files
    // changed, or "clean". It sits one cell in, as the tree's rows sit after their
    // cursor gutter, so its icon and name share their columns. The note is left out
    // when the name wouldn't fit beside it, so the name is cut once, in the middle,
    // never again at its end; the file counts give way before the lines changed.
    // Outside a repo, a note says so.
    const branchLine = () => {
      if (!t.top)
        return (
          <Box key="norepo" paddingLeft={1}>
            {k.note('norepo', 'no git repo · git status starts after git init', 'empty', { width: k.width - 1 })}
          </Box>
        )
      if (!t.branch) return null
      const b = t.branch
      const flash = bright.has(BRANCH_ROW) ? toneColor(t.flashTones[BRANCH_ROW] ?? 'teal', true) : undefined
      const figure = (key: string, text: string, color: string, drop?: number) => ({ part: <Text key={key} {...termInk(color)}>{text}</Text>, cells: [...text].length, ...(drop ? { drop } : {}) })
      const changed = [
        ...(totals[0] > 0 ? [figure('add', `+${totals[0]}`, C.ok, 1)] : []),
        ...(totals[1] > 0 ? [figure('del', `−${totals[1]}`, C.bad, 1)] : []),
        ...countParts(t.counts[t.root]).map(([letter, n, color]) => figure(`n-${letter}`, `${letter}${n}`, color, 2)),
      ]
      // The upstream as its host's mark (gh, gl, fj, ⇅), not its name: the terminal has no glyph for the hosts.
      const mark = b.upstream ? HOST_MARK[hostKind(b.host)] : ''
      const note = [b.ahead > 0 ? `↑${b.ahead}` : '', b.behind > 0 ? `↓${b.behind}` : '', mark].filter(Boolean).join(' ')
      // What the row leaves the name: the indent, the icon's column, and the figures.
      const avail = k.width - 1 - 2
      const cluster = (parts: { cells: number }[]) => parts.reduce((n, p) => n + p.cells + k.space.item, 0)
      const head = [...b.head].length
      // The file counts only while the name fits whole beside them; then the note likewise.
      // (Untracked files alone have no lines to show, so their count stays.)
      const lines = changed.filter(p => p.drop !== 2)
      const shown = head + cluster(changed) <= avail || !lines.length ? changed : lines
      const right = shown.length ? shown : [{ part: 'clean', cells: 5 }]
      const fits = head + 2 + [...note].length <= avail - cluster(right)
      return k.item('branch', {
        lead: <Text {...(flash ? termInk(flash) : { dimColor: true })}>{unicode ? BRANCH_ICON.plain : BRANCH_ICON.nerd}</Text>,
        text: b.head,
        textColor: flash,
        path: true,
        indent: 1,
        ...(note && fits ? { note } : {}),
        right,
      })
    }

    // Git's latest step: its icon and word in the kit's status colour (running blue,
    // failed red, done green with the word plain), a commit's hash dim.
    const chip = (a: Activity) => {
      const color = a.state === 'failed' ? C.bad : a.state === 'running' ? C.blue : C.ok
      const hash = a.state === 'done' && a.kind === 'git commit' ? (a.detail.split(' ')[0] ?? '') : ''
      return (
        <Box key="chip" flexDirection="row" flexShrink={0} gap={k.space.pair}>
          <Text {...termInk(color)}>{unicode ? a.plain : a.nerd}</Text>
          <Text {...(a.state === 'done' ? {} : termInk(color))}>{a.state === 'running' ? `${a.label}…` : a.label}</Text>
          {hash ? <Text dimColor>{hash}</Text> : null}
        </Box>
      )
    }

    const actions = k.actions('head', [
      { key: 'up', label: unicode ? '↑' : '\u{f005d}', quiet: true, onPress: () => void goUp($) },
      { key: 'cwd', label: unicode ? '⌂' : '\u{f02dc}', quiet: !follow, onPress: () => void goHome($) },
      { key: 'refresh', label: unicode ? '↻' : '\u{f0450}', quiet: true, onPress: () => void refreshAll($) },
      {
        key: 'hidden',
        label: unicode ? (t.showHidden ? '◉' : '○') : t.showHidden ? '\u{f0208}' : '\u{f0209}',
        quiet: !t.showHidden,
        onPress: () => void patch($, cur => ({ showHidden: !cur.showHidden })),
      },
      { key: 'size', label: unicode ? 'Σ' : '\u{f02ca}', quiet: !t.showSize, onPress: () => void patch($, cur => ({ showSize: !cur.showSize })) },
      { key: 'collapse', label: unicode ? '⊟' : '\u{eac5}', quiet: true, onPress: () => void collapseAll($) },
    ])

    // The search field, the pane's first row, above the folder's header (as on the
    // desktop): a dim search glyph in the header's arrow column, then the field; one
    // blank row parts it from the header, as a head line is parted from the sections.
    const searchLine = (
      <Box key="search" flexDirection="row" paddingLeft={k.edge.left} paddingRight={k.edge.right} marginBottom={k.space.block}>
        <Box width={2} flexShrink={0}>
          <Text dimColor>{unicode ? '⌕' : '\u{f0349}'}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} marginRight={t.query ? k.space.item : 0}>
          <Input
            key="q"
            placeholder="search"
            submitLabel="jump"
            autoFocus
            value={t.query}
            onInput={(v: string) => void search($, v)}
            onSubmit={(v: string) => void jump($, v)}
          />
        </Box>
        {t.query ? <Button key="clear" plain dimColor label={unicode ? '×' : '\u{f0156}'} onPress={() => void search($, '')} /> : null}
      </Box>
    )

    // The footer, in the rows' text column: the file selected as Claude's context (its
    // label dim, the path plain, cut in the middle to what the rest leaves it) with the
    // button that clears it right after it, then git's latest step on the right.
    const chipCells = (a: Activity) =>
      [...(unicode ? a.plain : a.nerd)].length + k.space.pair + [...a.label].length + (a.state === 'running' ? 1 : 0) + (a.state === 'done' && a.kind === 'git commit' ? k.space.pair + (a.detail.split(' ')[0] ?? '').length : 0)
    const selectedLabel = 'selected'
    const unselect = unicode ? '×' : '\u{f0156}'
    const selectedPath = t.selected ? (t.selected !== t.root && inside(t.root, t.selected) ? t.selected.slice(t.root.endsWith('/') ? t.root.length : t.root.length + 1) : shortPath(t.selected)) : ''
    const pathRoom = k.width - 1 - selectedLabel.length - k.space.item * 2 - [...unselect].length - (latest ? chipCells(latest) + k.space.group : 0)
    const footer =
      t.selected || latest ? (
        <Box key="foot" flexDirection="row" gap={k.space.group} paddingLeft={k.edge.left + 1} paddingRight={k.edge.right}>
          {t.selected ? (
            <Box flexDirection="row" flexShrink={1} minWidth={0} gap={k.space.item}>
              <Box flexShrink={1} minWidth={0}>
                <Text wrap="truncate">
                  <Text dimColor>{selectedLabel} </Text>
                  {middle(selectedPath, Math.max(1, pathRoom))}
                </Text>
              </Box>
              <Button key="unselect" plain dimColor label={unselect} onPress={() => void patch($, () => ({ selected: '' }))} />
            </Box>
          ) : null}
          <Box flexGrow={1} />
          {latest ? chip(latest) : null}
        </Box>
      ) : null

    return (
      <Box flexDirection="column" minHeight={Math.max(1, e.props.scroll?.bodyRows ?? 1)}>
        {searchLine}
        {k.section({
          id: 'files',
          title: header,
          right: actions,
          // Every action shows at any width; a long folder name is cut instead.
          keepRight: true,
          children: [
            branchLine(),
            rows.length === 0 ? (
              <Box key="empty" paddingLeft={1}>
                {k.note('empty', t.query ? 'no match' : 'empty', 'empty', { width: k.width - 1 })}
              </Box>
            ) : null,
            <Client
              key="rows"
              module="./rows.tsx"
              props={{ rows: specs, active: t.cursor, mark: MARK.selected, markColor: termInk(C.blue).color, focused, tones: SHIMMER, pointer, ...(bar ? { bar } : {}) } satisfies RowsProps}
            />,
          ],
        })}
        <Box flexGrow={1} />
        {footer}
        {hints ? (
          <Box key="hints" paddingLeft={k.edge.left + 1}>
            {hints}
          </Box>
        ) : null}
      </Box>
    )
  }
}
