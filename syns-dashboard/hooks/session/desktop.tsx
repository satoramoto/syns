import type { Elements, RenderElement } from 'claude-code'

import { bytes, money, tokens } from '../../kit/format'
import type { PerfSnapshot } from '../../kit/perf'
import { C, GLYPH, GRAY, INK, MUTED, RAMP, TRACK, levelColor } from '../../kit/tokens'
import { SPACE, kit } from '../../kit/ui'

import type { BranchView, GhInfo, GitInfo, GitNote, GitPr, Limit, Resources, SessionActivity, Snapshot, WorkspacesGh } from '../../types'

/*
 * The app mode: a properties inspector for the session, drawn as an instrument.
 *
 * The rules it keeps (kit/tokens.ts and kit/ui.tsx hold the values):
 * - Colour: each hue one meaning (grey labels, slate quantity, blue live, amber
 *   near a limit, red failed, green done well, purple merged). Icons are muted.
 * - Type: values plain, labels and units dim, bold only for section titles and
 *   the context %, uppercase only for captions and a branch's state word.
 * - Spacing: the kit's SPACE scale and INSET; nothing else.
 * - Each fact once: calls and time in the header, cost in Accounting.
 */

/** The elements the app mode draws with: the desktop and VS Code have these. */
export type AppElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Link' | 'Button' | 'Svg'>

export type DesktopData = {
  snap: Snapshot | null
  limits: Limit[] | null
  git: GitInfo | GitNote | null
  gh: GhInfo | null
  activity: SessionActivity
  /** Section ids the person folded. */
  collapsed: string[]
  /** Folds or unfolds a section. */
  toggle: (id: string) => void
  /** The column view's switch: on, a wide pane flows its sections into columns. */
  columnsOn: boolean
  /** Flips the column view. */
  toggleColumns: () => void
  /** The pane's width in cells. */
  columns: number
  /** The pane's height in rows, so the footer can sit on its bottom edge. */
  rows?: number
  /** The session's share of the machine, for the footer. */
  resources: Resources | null
  /** The branches the session started, newest first. */
  branches: BranchView[]
  /** The branch a PR is being created for, if any. */
  creating: string | null
  /** Hide a branch. */
  hideBranch: (branch: string) => void
  /** Create PR on a branch without one. */
  createPr: (branch: string) => void
  /** Merge on an open PR. */
  mergePr: (pr: GitPr) => void
  /** What the mod cost, for the debug footer. */
  perf: PerfSnapshot
  /** The clock elapsed times and resets are drawn against. */
  at: number
  /** The workspaces' last `gh pr list`: whether it failed, and when it last read good (the terminal shows it). */
  workspacesGh?: WorkspacesGh | null
  /** Whether the pane has the keyboard (`e.props.isFocused`); the terminal's kit takes it. */
  focused?: boolean
}

/** What the app mode borrows from register.tsx, passed in so this file has no cycle back. */
export type Helpers = {
  colorOf: (segments: Snapshot['segments'], i: number) => string | undefined
  limitLabel: (kind: string) => string
  resetIn: (resetsAt: string | undefined, at: number) => string
}

/**
 * A context category's short name and colour: the fixed overhead in shades of
 * slate (it only says how much), messages in blue (the part that grows).
 */
// Grouped into four, so the legend is short: what the system brings, what MCP
// brings, what the person's setup brings (memory, skills, agents), and the conversation.
export const CATEGORY: Record<string, { name: string; color: string }> = {
  'System prompt': { name: 'System', color: RAMP.slate[0] },
  'System tools': { name: 'System', color: RAMP.slate[0] },
  'MCP tools': { name: 'MCP', color: RAMP.slate[1] },
  'MCP server instructions': { name: 'MCP', color: RAMP.slate[1] },
  'Custom agents': { name: 'Memory', color: RAMP.slate[2] },
  'Memory files': { name: 'Memory', color: RAMP.slate[2] },
  Skills: { name: 'Memory', color: RAMP.slate[2] },
  Messages: { name: 'Messages', color: C.blue },
}

/** Three letters for a context category: what the terminal layout's chips show. */
export const tagOf = (name: string): string => {
  const known: Record<string, string> = {
    'System prompt': 'sys',
    'System tools': 'tls',
    'MCP tools': 'mcp',
    'Custom agents': 'agt',
    'Memory files': 'mem',
    Skills: 'skl',
    Messages: 'msg',
  }
  return known[name] ?? name.slice(0, 3).toLowerCase()
}

/**
 * A PR's state as one colour: merged purple; closed or draft grey; an open one green,
 * red while it has conflicts (on GitHub or in the checkout), amber while CI fails.
 */
export const prColor = (pr: GitPr, conflicted: boolean) =>
  pr.state === 'MERGED'
    ? C.purple
    : pr.state === 'CLOSED' || pr.isDraft
      ? MUTED
      : conflicted || pr.conflicting
        ? C.bad
        : pr.checks.failed
          ? C.warn
          : C.ok

/** "2h18", "3d4h", from "resets in 2h 18m". */
export const compact = (s: string) => s.replace('resets in ', '').replace(/ /g, '')

/** The context bar's free room: a step brighter than the empty track. */
const FREE = 'rgba(128,128,128,0.34)'
/** The context bar's buffer past compaction: the compaction mark's amber, faint. */
const BUFFER = 'rgba(227,163,59,0.32)'

export const shortTool = (name: string) => (name.startsWith('mcp__') ? (name.split('__').pop() ?? name) : name)

/**
 * The footer's lead: the session's share of the machine, ours against the
 * system's, under muted three-letter labels; ours turns amber or red when it's a big share.
 */
export const machine = (k: ReturnType<typeof kit>, r: Resources | null): RenderElement[] => {
  if (!r) return []
  const hot = (part: number, whole: number) => (whole > 0 && part / whole > 0.5 ? C.bad : whole > 0 && part / whole > 0.25 ? C.warn : undefined)
  const pctOf = (n: number) => `${Math.round(n)}%`
  return [
    k.share('cpu', 'cpu', pctOf(r.cpu), pctOf(r.cpuAll), hot(r.cpu, r.cpuAll)),
    k.share('mem', 'mem', bytes(r.mem), bytes(r.memAll), hot(r.mem, r.memAll)),
    k.share('net', 'net', r.net === null ? '–' : bytes(r.net), bytes(r.netAll), r.net === null ? undefined : hot(r.net, r.netAll)),
  ]
}

/** The context window's used segments summed into their groups, in the groups' order; the free room up to compaction; the buffer past it. */
export const contextParts = (snap: Snapshot | null) => {
  const parts: { value: number; color: string; label: string }[] = []
  for (const s of snap?.segments ?? []) {
    if (s.kind !== 'used' || s.tokens <= 0) continue
    const c = CATEGORY[s.name] ?? { name: s.name, color: INK }
    const at = parts.find(p => p.label === c.name)
    if (at) at.value += s.tokens
    else parts.push({ value: s.tokens, color: c.color, label: c.name })
  }
  const free = snap ? Math.max(0, (snap.compactAt ?? snap.max) - snap.total) : 0
  const buffer = snap?.compactAt && snap.max > snap.compactAt ? snap.max - snap.compactAt : 0
  return { parts, free, buffer }
}

/**
 * The activity chart's data: tool calls per turn, each turn's column sliced by tool.
 * The busiest tools take shades of blue (one series, parts told apart), the rest one slate slice.
 */
export const activityChart = (a: SessionActivity) => {
  const allTools = Object.entries(a.tools).sort((x, y) => y[1].n - x[1].n)
  const named = allTools.slice(0, RAMP.blue.length).map(([name], i) => ({ name, color: RAMP.blue[i]! }))
  const OTHER = RAMP.slate[1]
  const SLOTS = 16
  const log = a.turnLog.slice(-SLOTS)
  const first = a.turns - log.length + 1
  const sliced = log.map(p => {
    const by = p.tools ?? {}
    const other = Object.entries(by).reduce((n, [name, c]) => n + (named.some(t => t.name === name) ? 0 : c), 0)
    // Stacked bottom up, the busiest tool at the base; a turn without calls keeps a sliver.
    const stack = [...named.map(t => ({ value: by[t.name] ?? 0, color: t.color })), { value: other, color: OTHER }].reverse()
    return stack.some(x => x.value > 0) ? stack : [{ value: 0.05, color: TRACK }]
  })
  const peak = Math.max(0, ...log.map(p => p.calls ?? 0))
  const otherCount = allTools.slice(named.length).reduce((n, [, t]) => n + t.n, 0)
  const cacheIn = a.turnLog.reduce((n, p) => n + p.cacheRead, 0)
  const allIn = a.turnLog.reduce((n, p) => n + p.cacheRead + p.cacheWrite + p.input, 0)
  // Turn numbers under the first, middle and last bar.
  const ticks = log.length ? [0, Math.floor((log.length - 1) / 2), log.length - 1].filter((v, i, xs) => xs.indexOf(v) === i) : []
  return { named, OTHER, SLOTS, log, first, sliced, peak, otherCount, cacheIn, allIn, ticks }
}

export const renderDesktop = (els: AppElements, d: DesktopData, fx: Helpers): RenderElement => {
  const { Box, Text } = els
  const k = kit(els, 'desktop', d.columns, { flow: { on: d.columnsOn, toggle: d.toggleColumns } })
  const a = d.activity
  const snap = d.snap
  const fold = (id: string) => ({ collapsed: d.collapsed.includes(id), onToggle: () => d.toggle(id) })

  const toolCalls = Object.values(a.tools).reduce((n, t) => n + t.n, 0)

  // ---- context: the instrument's main meter ----
  const { parts, free, buffer } = contextParts(snap)
  // What's left, as two more shades of the same bar: the free room up to compaction,
  // then the buffer past it (amber, as the compaction mark is), with their own legend entries.
  const room = [...parts]
  if (snap) {
    if (free > 0) room.push({ value: free, color: FREE, label: 'Free' })
    if (buffer > 0) room.push({ value: buffer, color: BUFFER, label: 'Buffer' })
  }
  const context = k.section({
    id: 'context',
    icon: GLYPH.context,
    title: 'Context',
    right: snap ? (
      <Text>
        <Text bold color={levelColor(snap.percent)}>{`${snap.percent}%`}</Text>
        <Text color={GRAY.mid}>{` of ${tokens(snap.max)}`}</Text>
      </Text>
    ) : (
      <Text color={GRAY.mid}>measuring…</Text>
    ),
    ...fold('context'),
    children: snap
      ? [
          <Box key="meter" flexDirection="column">
            {k.bar(room, snap.max, { height: 0.5 })}
            {/* No compaction mark: the buffer's shade starts where it falls. */}
            {k.scale()}
            {k.axis(
              'ctx-axis',
              [0, 0.25, 0.5, 0.75, 1].map(f => ({ at: f, text: f === 0 ? '0' : tokens(snap.max * f) })),
            )}
          </Box>,
          <Box key="legend" marginTop={SPACE.block} width="100%">
            {k.legend(
              'ctx',
              room.map(p => ({ label: p.label, color: p.color, figure: tokens(p.value) })),
              2,
            )}
          </Box>,
        ]
      : null,
  })

  // ---- limits ----
  const windows = d.limits ?? []
  const limits = windows.length
    ? k.section({
        id: 'limits',
        icon: GLYPH.limits,
        title: 'Limits',
        ...fold('limits'),
        children: windows.map(w =>
          k.reading(`limit-${w.kind}`, {
            label: fx.limitLabel(w.kind),
            value: Math.min(100, Math.max(0, w.percent)),
            max: 100,
            color: levelColor(w.percent),
            figure: `${Math.round(w.percent)}%`,
            unit: w.resetsAt ? compact(fx.resetIn(w.resetsAt, d.at)) : undefined,
          }),
        ),
      })
    : null

  // ---- activity: tool calls per turn, each bar sliced by tool ----
  const { named, OTHER, SLOTS, log, first, sliced, peak, otherCount, cacheIn, allIn, ticks } = activityChart(a)
  const activity =
    log.length || toolCalls
      ? k.section({
          id: 'activity',
          icon: GLYPH.tools,
          title: 'Activity',
          right: k.summary([[String(peak), 'peak'], [`${allIn ? Math.round((cacheIn / allIn) * 100) : 0}%`, 'cached']]),
          ...fold('activity'),
          children: [
            <Box key="chart" flexDirection="column">
              {k.columns(sliced, { slots: SLOTS, height: 3.5 })}
              {k.axis(
                'act-axis',
                ticks.map(i => ({ at: (i + 0.5) / SLOTS, text: String(first + i).padStart(2, '0') })),
              )}
            </Box>,
            <Box key="legend" marginTop={SPACE.block} width="100%">
              {k.legend('act', [
                ...named.map(t => ({ label: shortTool(t.name), color: t.color, figure: String(a.tools[t.name]!.n) })),
                ...(otherCount ? [{ label: 'Other', color: OTHER, figure: String(otherCount) }] : []),
              ])}
            </Box>,
          ],
        })
      : null

  // ---- accounting: what the session cost, and on what ----
  const accounting = k.section({
    id: 'accounting',
    icon: GLYPH.cost,
    title: 'Accounting',
    right: k.summary([[a.cost !== undefined ? money(a.cost) : '–']]),
    ...fold('accounting'),
    children: [snap ? k.prop('model', 'Model', snap.model) : k.prop('model', 'Model', '–')],
  })

  return k.pinned(
    // In columns when the pane is wide; one stack at a sidebar's width.
    k.flow('sections', [context, limits, activity, ...renderBranches(els, k, d, fold), accounting]),
    k.perf(d.perf, { lead: machine(k, d.resources) }),
    d.rows,
  )
}

/**
 * Workspaces: the branches the session started, as the desktop app tracks them,
 * each in its own tile: the PR's state as an icon and a word, the PR's title on a
 * line of its own, then its number, where it lives, changes, CI and the actions.
 */
const renderBranches = (els: AppElements, k: ReturnType<typeof kit>, d: DesktopData, fold: (id: string) => { collapsed: boolean; onToggle: () => void }): RenderElement[] => {
  const { Box, Text, Link, Button } = els
  const entries = d.branches.map((b, i) => {
    const pr = b.pr
    const open = pr?.state === 'OPEN'
    const color = pr ? prColor(pr, b.conflicted > 0) : MUTED
    const ci: [string, string] | null = b.conflicted
      ? [`${b.conflicted} conflict${b.conflicted === 1 ? '' : 's'}`, C.bad]
      : !pr || !open
        ? null
        : pr.conflicting
          ? ['conflicts', C.bad]
          : pr.checks.failed
          ? [`${pr.checks.failed} failing`, C.warn]
          : pr.checks.pending
            ? [`${pr.checks.pending} pending`, C.blue]
            : pr.checks.passed
              ? ['passing', C.ok]
              : null
    const action =
      !Button || !b.exists
        ? null
        : d.creating === b.branch
          ? <Text color={GRAY.mid}>creating PR…</Text>
          : !pr
            ? <Button key={`create-${b.branch}`} plain label="Create PR" onPress={() => d.createPr(b.branch)} />
            : open && !pr.isDraft
              ? <Button key={`merge-${pr.number}`} plain label="Merge" onPress={() => d.mergePr(pr)} />
              : null
    // A tile per branch, three lines:
    //   [pr icon] branch                    hide
    //   A neater inspector, the PR's title, the full width
    //   #9  awesome-claude      +412 −96  1 failing  Merge
    // The PR's state is the icon's glyph and colour, no word; a deleted branch's name is struck through.
    const iconKey = !pr ? GLYPH.branch : pr.state === 'MERGED' ? 'pr-merged' : pr.state === 'CLOSED' ? 'pr-closed' : pr.isDraft ? 'pr-draft' : 'pr-open'
    const where = b.worktree ? `${b.place} (worktree)` : b.place
    const row = (key: string, l: RenderElement | (RenderElement | null)[], r: (RenderElement | null)[]) => (
      <Box key={key} flexDirection="row" justifyContent="space-between" gap={SPACE.item} width="100%">
        <Box flexDirection="row" alignItems="center" gap={SPACE.pair} flexShrink={1} minWidth={0} overflow="hidden">
          {l}
        </Box>
        <Box flexDirection="row" alignItems="center" gap={SPACE.item} flexShrink={0}>
          {r}
        </Box>
      </Box>
    )
    return (
      <Box key={`branch-${b.branch}`} width="100%" marginTop={i === 0 ? 0 : SPACE.block}>
        {k.tile(`tile-${b.branch}`, [
          row(
            'l1',
            [
              k.icon(iconKey, color),
              <Text key="b" wrap="truncate" strikethrough={!b.exists} dimColor={!b.exists}>
                {b.branch}
              </Text>,
            ],
            [
              Button ? (
                // dimColor, not a grey child Text: the desktop draws a Button's label alone.
                <Button key={`hide-${b.branch}`} plain dimColor label="hide" onPress={() => d.hideBranch(b.branch)} />
              ) : null,
            ],
          ),
          pr ? (
            <Text key="title" wrap="truncate">
              {pr.title}
            </Text>
          ) : null,
          row(
            'l3',
            [
              // The PR's number reads as a link by its blue alone, no underline.
              pr ? (
                <Link key="n" href={pr.url} label={`#${pr.number}`}>
                  <Text color={C.blue}>{`#${pr.number}`}</Text>
                </Link>
              ) : null,
              <Text key="p" color={GRAY.mid} wrap="truncate">
                {where}
              </Text>,
            ],
            [
              b.insertions || b.deletions ? (
                // Lines added green, removed red, as a diff colours them.
                <Text key="d">
                  <Text color={C.ok}>{`+${b.insertions}`}</Text>
                  <Text color={C.bad}>{` −${b.deletions}`}</Text>
                </Text>
              ) : null,
              ci ? <Text key="ci" color={ci[1]}>{ci[0]}</Text> : null,
              action,
            ],
          ),
        ])}
      </Box>
    )
  })
  if (!entries.length) return []
  const merged = d.branches.filter(b => b.pr?.state === 'MERGED').length
  const openPrs = d.branches.filter(b => b.pr?.state === 'OPEN').length
  return [
    k.section({
      id: 'workspaces',
      icon: GLYPH.branch,
      title: 'Workspaces',
      right: k.summary([openPrs ? [String(openPrs), 'open', C.blue] : null, merged ? [String(merged), 'merged', C.purple] : null]),
      ...fold('workspaces'),
      children: entries,
    }),
  ]
}
