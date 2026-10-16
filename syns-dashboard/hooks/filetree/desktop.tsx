// New in this fork (awesome-claude): the desktop version of the pane, drawn with the shared kit.
import type { Elements, RenderElement } from 'claude-code'

import { ago } from '../../kit/format'
import { C, FILE_TYPE, GLYPH, GRAY, TRACK } from '../../kit/tokens'
import type { FileType } from '../../kit/tokens'
import { EDGE, SPACE, kit } from '../../kit/ui'

import type { Activity, FileTree } from '../../types'
import { dirname, formatSize, HOST_ICON, hostKind, remoteName, type Row, underAny } from './tree'

/*
 * The desktop's file tree, as the other mods' desktop panes draw: a header line
 * with the folder and its actions as icons, the branch line, the search field,
 * then one row per file or folder (indent, fold arrow, Octicon, name, figures on
 * the right), and a footer with the selection and git activity.
 *
 * The rows are drawn here, not by the `Client` the terminal uses (rows.tsx): a
 * surface module can't draw `Svg`, and the rows' icons are Octicons. A press on
 * a row's name selects it and opens a folder, twice opens it, as a click does in
 * the terminal; Claude's reads and writes light their rows for as long as the
 * terminal's shimmer runs.
 */

export type DesktopElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Input' | 'Svg'>

/** What the desktop pane draws from, besides the tree itself. */
export type DesktopView = {
  t: FileTree
  rows: Row[]
  /** The git activity shown in the footer: the running one, else the latest. */
  latest: Activity | undefined
  /** Whether the tree follows the session's cwd (the home button lit). */
  follow: boolean
  now: number
  columns: number
  /** The pane's height in rows, so the footer sits on its bottom edge. */
  bodyRows: number
  /** A path relative to the tree's root, or shortened under home. */
  shown: (path: string) => string
  /** The id the branch line flashes under. */
  branchRow: string
}

/** What the pane's controls do; register.tsx runs them with its `$`. */
export type DesktopActions = {
  up: () => void
  home: () => void
  refresh: () => void
  hidden: () => void
  sizes: () => void
  collapse: () => void
  unselect: () => void
  press: (id: string) => void
  open: (id: string) => void
  search: (query: string) => void
  jump: (query: string) => void
}

/** The branch name's least width in cells, however many figures share its line. */
const HEAD_MIN = 6

/** An icon button's label: two Braille blanks, about the icon's two cells, drawn as nothing. */
export const BLANK = '⠀⠀'

/** The most rows drawn: a tree past it would outgrow what the desktop takes in one drawing. */
export const MAX_ROWS = 1500

const CODE = new Set(
  'ts tsx mts cts js jsx mjs cjs py rs go rb java kt kts swift c h cc cpp hpp cs php sh bash zsh fish lua sql html htm css scss sass less vue svelte zig ex exs erl hs ml scala dart r jl pl ps1 nix'.split(' '),
)

/** A file's Octicon: code for source files, a page for anything else. */
export const fileIcon = (name: string, kind: string, open: boolean) => {
  if (kind === 'dir') return open ? 'folder-open' : 'folder'
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  return CODE.has(ext) ? 'file-code' : 'file'
}

/** Extensions by the file type IntelliJ's New UI draws them as (its `fileTypes` icons). */
const TYPE_BY_EXT = new Map<string, FileType>()
for (const [type, exts] of Object.entries({
  typescript: 'ts tsx mts cts',
  javascript: 'js jsx mjs cjs',
  json: 'json jsonc json5',
  markdown: 'md mdx markdown',
  yaml: 'yml yaml',
  config: 'toml ini cfg conf properties env editorconfig',
  style: 'css scss sass less',
  html: 'html htm xhtml',
  xml: 'xml xsd xsl plist',
  data: 'csv tsv',
  sql: 'sql',
  image: 'png jpg jpeg gif webp ico bmp svg avif',
  archive: 'zip tar gz tgz bz2 xz 7z rar jar',
} satisfies Partial<Record<FileType, string>>))
  for (const ext of exts.split(' ')) TYPE_BY_EXT.set(ext, type as FileType)

/** Names IntelliJ draws as config whatever their extension. */
const CONFIG_NAMES = new Set(['dockerfile', '.editorconfig', '.env', '.npmrc', '.nvmrc'])

/**
 * A row's file type, for its icon's colour (`FILE_TYPE`): a folder git ignores is
 * excluded (node_modules, build output), any other folder grey, a file by its
 * extension; lockfiles (`bun.lock`, `yarn.lock`) and anything unknown are text.
 */
export const fileType = (name: string, kind: string, excluded = false): FileType => {
  if (kind === 'dir') return excluded ? 'excluded' : 'folder'
  const lower = name.toLowerCase()
  if (CONFIG_NAMES.has(lower) || lower.startsWith('.env.')) return 'config'
  const ext = lower.includes('.') ? (lower.split('.').pop() ?? '') : ''
  return TYPE_BY_EXT.get(ext) ?? 'text'
}

/**
 * A git status letter's colour, in the kit's meanings: modified amber, new
 * green, deleted or conflicted red, renamed or copied blue.
 */
export const statusColor = (status: string | undefined): string | undefined => {
  if (!status) return undefined
  if (status === 'D' || status === 'U') return C.bad
  if (status === 'A' || status === '?') return C.ok
  if (status === 'M' || status === 'T') return C.warn
  if (status === 'R' || status === 'C') return C.blue
  return GRAY.mid
}

/**
 * The colour Claude's activity lights a row in. On a row: reads blue (live),
 * writes amber (changed, as git marks a modified file), commits green, failures
 * red. On the branch line purple is a merge, as everywhere in the kit.
 */
export const toneColor = (tone: string, branch = false): string => {
  if (tone === 'green') return C.ok
  if (tone === 'red') return C.bad
  if (tone === 'orange') return C.warn
  if (tone === 'purple') return branch ? C.purple : C.blue
  return C.blue
}

/** An activity's Octicon, by what git or gh did. */
export const activityIcon = (a: Activity) => {
  const kind = a.kind
  if (/\bcommit\b/.test(kind)) return 'git-commit'
  if (/\bpush\b/.test(kind)) return 'repo-push'
  if (/\b(pull|fetch|clone)\b/.test(kind)) return 'sync'
  if (/\b(merge|rebase|cherry-pick)\b/.test(kind)) return 'pr-merged'
  if (/^gh pr\b/.test(kind)) return 'pr-open'
  if (/^gh issue\b/.test(kind)) return 'issue-opened'
  if (/\b(reset|restore|revert|rm)\b/.test(kind)) return 'alert'
  return GLYPH.branch
}

const activityColor = (a: Activity) => (a.state === 'failed' ? C.bad : a.state === 'running' ? C.blue : C.ok)

export const renderDesktop = (els: DesktopElements, v: DesktopView, act: DesktopActions): RenderElement => {
  const { Box, Text, Button, Input } = els
  const { t } = v
  const k = kit(els, 'desktop', v.columns)
  const bright = new Set(t.flashOn ? t.flash : [])
  const dimmed = new Set(t.flashOn ? t.flashDim : [])
  const ignored = new Set(t.ignored)
  const untracked = new Set(t.untrackedDirs)

  /** An icon in a fixed column, so every name starts at one x. */
  const lead = (key: string, icon: RenderElement) => (
    <Box key={key} width={2} flexShrink={0} flexDirection="row" alignItems="center">
      {icon}
    </Box>
  )

  /**
   * An action drawn as its icon. The desktop draws a Button as its label text and
   * no children, so the icon (an SVG, named by `label` as its alt) sits in a box
   * and a Button with a blank label the icon's size lies over it: a press anywhere
   * on the icon is a press of the Button, its key the action's address. The label
   * is two Braille blanks (U+2800): they draw nothing, as spaces do, but no
   * renderer trims or collapses them.
   */
  const iconButton = (key: string, label: string, icon: string, color: string, onPress: () => void) => (
    <Box key={`ib-${key}`} position="relative" width={2} height={1} flexShrink={0} flexDirection="row" alignItems="center" justifyContent="center">
      {k.icon(icon, color, undefined, { alt: label })}
      <Box position="absolute" top={0} left={0}>
        <Button key={key} plain label={BLANK} onPress={onPress} />
      </Box>
    </Box>
  )

  /** A row: the left side gives way (truncates), the right side keeps its figures. */
  const line = (key: string, left: (RenderElement | null)[], right: (RenderElement | null)[], extra: Record<string, unknown> = {}) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" gap={SPACE.item} width="100%" {...extra}>
      <Box flexDirection="row" alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
        {left}
      </Box>
      <Box flexDirection="row" alignItems="center" gap={SPACE.pair} flexShrink={0}>
        {right}
      </Box>
    </Box>
  )

  /** A folder's file counts: new, modified, deleted, each its letter dim and its figure in its colour. */
  const counts = (key: string, c: [number, number, number] | undefined): RenderElement[] => {
    if (!c) return []
    const parts: [string, number, string][] = [
      ['?', c[0], C.ok],
      ['M', c[1], C.warn],
      ['D', c[2], C.bad],
    ]
    return parts
      .filter(([, n]) => n > 0)
      .map(([letter, n, color]) => (
        <Text key={`${key}-${letter}`}>
          <Text color={GRAY.dark}>{letter}</Text>
          <Text color={color}>{String(n)}</Text>
        </Text>
      ))
  }

  const lines = (key: string, loc: [number, number] | undefined): RenderElement[] => [
    ...(loc && loc[0] > 0 ? [<Text key={`${key}-add`} color={C.ok}>{`+${loc[0]}`}</Text>] : []),
    ...(loc && loc[1] > 0 ? [<Text key={`${key}-del`} color={C.bad}>{`−${loc[1]}`}</Text>] : []),
  ]

  // The header: the folder, then its actions.
  const name = t.top ? [t.top.split('/').pop() ?? t.top, t.prefix.replace(/\/$/, '')].filter(Boolean).join('/') : t.root.split('/').pop() || t.root
  const header = line(
    'head',
    [
      lead('icon', k.icon('folder-open', GRAY.mid)),
      <Text key="name" bold wrap="truncate">
        {name}
      </Text>,
    ],
    [
      iconButton('up', 'Up a folder', 'arrow-up', GRAY.mid, act.up),
      iconButton('cwd', 'Follow the working directory', 'home', v.follow ? GRAY.light : GRAY.dark, act.home),
      iconButton('refresh', 'Refresh', 'sync', GRAY.mid, act.refresh),
      iconButton('hidden', t.showHidden ? 'Hide hidden files' : 'Show hidden files', 'eye', t.showHidden ? GRAY.light : GRAY.dark, act.hidden),
      iconButton('size', t.showSize ? 'Show dates' : 'Show sizes', GLYPH.context, t.showSize ? GRAY.light : GRAY.dark, act.sizes),
      iconButton('collapse', 'Collapse all', 'fold', GRAY.mid, act.collapse),
      t.selected ? iconButton('unselect', 'Clear the selection', GLYPH.failed, GRAY.mid, act.unselect) : null,
    ],
    { marginBottom: SPACE.block },
  )

  // The branch: its name, ahead and behind, then the lines and files changed.
  const branch = () => {
    if (!t.top) {
      return line('branch', [lead('icon', k.icon(GLYPH.branch, GRAY.dark)), <Text key="none" color={GRAY.mid} wrap="truncate">no git repo · git status starts after git init</Text>], [], { marginBottom: SPACE.block })
    }
    if (!t.branch) return null
    const b = t.branch
    const flashing = bright.has(v.branchRow)
    const tone = flashing ? toneColor(t.flashTones[v.branchRow] ?? 'teal', true) : undefined
    const totals = t.diff[t.root] ?? [0, 0]
    const rootCounts = counts('root', t.counts[t.root])
    const changed = [...lines('root', totals), ...rootCounts]
    return line(
      'branch',
      [
        lead('icon', k.icon(GLYPH.branch, tone ?? GRAY.mid)),
        // Never squeezed out: the figures on the right leave it a few letters (fewer when
        // the name is shorter, so a short name doesn't leave a gap after it).
        <Box key="head" flexShrink={1} minWidth={Math.min(HEAD_MIN, [...b.head].length)}>
          <Text color={tone} wrap="truncate">
            {b.head}
          </Text>
        </Box>,
        b.ahead > 0 ? <Text key="ahead" color={GRAY.mid}>{` ↑${b.ahead}`}</Text> : null,
        b.behind > 0 ? <Text key="behind" color={GRAY.mid}>{` ↓${b.behind}`}</Text> : null,
        // The upstream as its host's icon (GitHub, GitLab, Forgejo, else a remote), its
        // name the icon's tooltip; none when the branch tracks nothing.
        // A local upstream (`main...main`, no remote) has no host to show.
        b.upstream && remoteName(b.upstream) ? (
          <Box key="upstream" flexShrink={0} marginLeft={SPACE.pair} flexDirection="row" alignItems="center">
            {k.icon(HOST_ICON[hostKind(b.host)], GRAY.dark, undefined, { tooltip: b.upstream })}
          </Box>
        ) : null,
      ],
      changed.length ? changed : [<Text key="clean" color={GRAY.mid}>clean</Text>],
      { marginBottom: SPACE.block },
    )
  }

  // The search field, the pane's first row, as wide as the pane. Its submit ("jump":
  // Enter opens the first match and clears the field) is drawn by the desktop as a
  // button beside it: every Input has one there, labelled "submit" if not named.
  const search = (
    <Box key="search" flexDirection="row" alignItems="center" gap={SPACE.pair} width="100%" marginBottom={SPACE.block}>
      {Input ? (
        // A column, so the field stretches across the box.
        <Box key="field" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Input key="q" placeholder="Search files" submitLabel="jump" autoFocus value={t.query} onInput={(q: string) => act.search(q)} onSubmit={(q: string) => act.jump(q)} />
        </Box>
      ) : null}
      {t.query ? iconButton('clear', 'Clear the search', GLYPH.failed, GRAY.mid, () => act.search('')) : null}
    </Box>
  )

  // One file or folder.
  const row = (r: Row) => {
    const n = r.node
    const own = t.git[n.id]
    const status = own ?? (underAny(dirname(n.id), untracked, t.root) ? '?' : undefined)
    const isIgnored = !status && underAny(n.id, ignored, t.root)
    const isBright = bright.has(n.id)
    const isDim = !isBright && dimmed.has(n.id)
    const tone = isBright || isDim ? toneColor(t.flashTones[n.id] ?? 'orange') : undefined
    const muted = isIgnored || n.hidden
    // The icon in its file type's colour (IntelliJ's), a folder git ignores in the excluded tone;
    // Claude's activity lights it in the activity's colour instead.
    const iconColor = tone ?? FILE_TYPE[fileType(n.name, n.kind, isIgnored)]
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
        : ago(v.now - n.mtime)
    const dirCounts = n.kind === 'dir' ? counts(n.id, t.counts[n.id]) : []
    const isCursor = n.id === t.cursor
    // A Button sizes to its label, so the name is cut to the room left here, with an ellipsis,
    // rather than clipped mid-letter: the pane less the indent, arrow, icon, figures and badge.
    const c = n.kind === 'dir' ? t.counts[n.id] : undefined
    const figures = [meta, loc?.[0] ? `+${loc[0]}` : '', loc?.[1] ? `−${loc[1]}` : '', ...(c ?? []).filter(x => x > 0).map(x => `?${x}`)].filter(Boolean)
    const room = Math.floor(v.columns - EDGE.left - EDGE.right - r.depth * SPACE.item - SPACE.item * 2 - 2 - figures.join(' ').length - SPACE.pair)
    const label = n.name.length > Math.max(4, room) ? `${n.name.slice(0, Math.max(3, room - 1))}…` : n.name
    return (
      <Box key={`row-${n.id}`} flexDirection="row" alignItems="center" width="100%" backgroundColor={isCursor ? TRACK : undefined}>
        {/* A rail in the activity's colour while Claude reads or writes it. */}
        <Box width={0.25} height={1} flexShrink={0} backgroundColor={isBright ? tone : undefined} />
        <Box width={EDGE.left - 0.25 + r.depth * SPACE.item} flexShrink={0} />
        <Box width={SPACE.item} flexShrink={0}>
          <Text color={GRAY.dark}>{n.kind === 'dir' ? (r.open ? '▾' : '▸') : ' '}</Text>
        </Box>
        {lead('icon', k.icon(fileIcon(n.name, n.kind, r.open), iconColor))}
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          {/* The desktop draws a Button as its label, plain, never its children, so a name can't
              take its git colour or a weight here: it's dim when ignored or hidden, the git letter
              on the right says its state, the cursor's tint and the footer say what's selected. */}
          <Button key={n.id} plain label={label} {...(muted ? { dimColor: true } : {})} onPress={() => act.press(n.id)} />
        </Box>
        <Box flexDirection="row" alignItems="center" gap={SPACE.pair} flexShrink={0} marginLeft={SPACE.pair}>
          {meta ? <Text color={meta === '…' ? GRAY.dark : GRAY.mid}>{meta}</Text> : null}
          {lines(n.id, loc)}
          {dirCounts}
        </Box>
        <Box width={SPACE.item + EDGE.right} flexShrink={0} flexDirection="row" justifyContent="center">
          {dirCounts.length || !status ? null : <Text color={statusColor(status)}>{status}</Text>}
        </Box>
      </Box>
    )
  }

  const drawn = v.rows.slice(0, MAX_ROWS)
  const tree = (
    <Box key="tree" flexDirection="column" width="100%">
      {v.rows.length === 0 ? (
        <Box paddingLeft={EDGE.left}>
          <Text color={GRAY.mid}>{t.query ? 'no match' : 'empty'}</Text>
        </Box>
      ) : null}
      {drawn.map(row)}
      {v.rows.length > drawn.length ? (
        <Box paddingLeft={EDGE.left}>
          <Text color={GRAY.mid}>{`${v.rows.length - drawn.length} more; search to find them`}</Text>
        </Box>
      ) : null}
    </Box>
  )

  // The footer: what's selected (Claude sees it as context), and git's latest step.
  const chip = (a: Activity) => (
    <Box key="chip" flexDirection="row" alignItems="center" gap={SPACE.pair} flexShrink={0}>
      {k.icon(activityIcon(a), activityColor(a))}
      <Text color={a.state === 'running' ? C.blue : a.state === 'failed' ? C.bad : GRAY.light}>{a.state === 'running' ? `${a.label}…` : a.label}</Text>
      {a.state === 'done' && a.kind === 'git commit' && a.detail ? <Text color={GRAY.dark}>{a.detail.split(' ')[0] ?? ''}</Text> : null}
    </Box>
  )
  const selected = t.selected
  const footer =
    selected || v.latest
      ? line(
          'foot',
          selected
            ? [
                lead('icon', k.icon('file', GRAY.dark)),
                <Box key="path" flexShrink={1} minWidth={0}>
                  <Text color={GRAY.mid} wrap="truncate-start">
                    {v.shown(selected)}
                  </Text>
                </Box>,
                <Box key="open" flexShrink={0} marginLeft={SPACE.pair}>
                  <Button key="open" plain dimColor label="open" onPress={() => act.open(selected)} />
                </Box>,
              ]
            : [],
          [v.latest ? chip(v.latest) : null],
          { marginTop: SPACE.block },
        )
      : null

  return (
    <Box flexDirection="column" minHeight={Math.max(1, v.bodyRows)} paddingTop={SPACE.block}>
      <Box flexDirection="column" paddingLeft={EDGE.left} paddingRight={EDGE.right}>
        {search}
        {header}
        {branch()}
      </Box>
      {tree}
      <Box flexGrow={1} />
      {footer ? (
        <Box flexDirection="column" paddingLeft={EDGE.left} paddingRight={EDGE.right}>
          {footer}
        </Box>
      ) : null}
    </Box>
  )
}
