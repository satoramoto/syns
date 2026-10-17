import type { Elements, RenderElement } from 'claude-code'

import { ago, basename, money, tokens } from '../../kit/format'
import { C, GLYPH, MUTED, TRACK, levelColor } from '../../kit/tokens'
import type { StatusKind } from '../../kit/tokens'
import { MEASURE, kit } from '../../kit/ui'
import type { Kit } from '../../kit/ui'

import type { BranchView, GitFile, GitInfo, GitPr } from '../../types'
import { activityChart, compact, contextParts, machine, prColor, shortTool } from './desktop'
import type { DesktopData } from './desktop'

/*
 * The terminal mode: the same instrument inspector as the desktop, in cells.
 * Same sections in the same order (Context, Limits, Activity, Workspaces,
 * Accounting), plus the session's own checkout and its pull requests (Git),
 * which the terminal has always shown. Every row is drawn with the kit's
 * terminal primitives, sized from the pane's `bodyColumns`.
 */

/** The elements the terminal draws with. */
export type TermElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the terminal mode borrows from register.tsx, passed in so this file has no cycle back. */
export type TermHelpers = {
  limitLabel: (kind: string) => string
  resetIn: (resetsAt: string | undefined, at: number) => string
}

/** The most pull requests the Git section lists. */
const GIT_PRS = 3


/** A PR's icon key: its state, as GitHub draws it. */
const prIcon = (pr: GitPr) => (pr.state === 'MERGED' ? 'pr-merged' : pr.state === 'CLOSED' ? 'pr-closed' : pr.isDraft ? 'pr-draft' : 'pr-open')

/** A PR's checks as one status and word, or null when there's nothing to say. */
const prChecks = (pr: GitPr, conflicted = 0): [StatusKind, string] | null => {
  if (pr.state === 'MERGED') return ['merged', 'merged']
  if (pr.state === 'CLOSED') return ['stopped', 'closed']
  if (conflicted) return ['failed', `${conflicted} conflict${conflicted === 1 ? '' : 's'}`]
  if (pr.conflicting) return ['failed', 'conflicts']
  if (pr.checks.failed) return ['failed', `${pr.checks.failed} failing`]
  if (pr.checks.pending) return ['pending', `${pr.checks.pending} pending`]
  if (pr.checks.passed) return ['done', 'passing']
  return null
}

/** A changed file's colour: conflicts and deletions red, additions and staged green, edits amber, untracked grey. */
const fileColor = (f: GitFile) =>
  f.kind === 'conflict' || f.kind === 'deleted' ? C.bad : f.kind === 'added' || f.staged ? C.ok : f.kind === 'untracked' ? MUTED : C.warn

/** The folder a path sits in, or '' at the top. */
const dirOf = (path: string) => path.split(/[\\/]/).slice(0, -1).join('/')

/** How old last-good figures are, for a header's stale state: 40s, 5m, 3h; nothing when unknown. */
const since = (at: number | undefined, now: number) => {
  if (!at) return undefined
  const ms = Math.max(0, now - at)
  return ms < 60_000 ? `${Math.floor(ms / 1_000)}s` : ago(ms)
}

/** Tokens a turn added: its input, output and cache writes (cache reads restate the context, which Context shows). */
const turnTokens = (p: { input: number; output: number; cacheWrite: number }) => p.input + p.output + p.cacheWrite

export const renderTerminal = (els: TermElements, d: DesktopData, fx: TermHelpers): RenderElement => {
  const { Box, Text } = els
  // A dashboard of readings: drawn to the kit's measure, so a wide pane doesn't spread them apart.
  const k = kit(els, 'terminal', d.columns, { focused: d.focused, measure: MEASURE })
  const a = d.activity
  const snap = d.snap
  const fold = (id: string) => ({ collapsed: d.collapsed.includes(id), onToggle: () => d.toggle(id) })

  // ---- context: one row: the used groups as the heavy line, then the free room and the
  // buffer past the compaction point as the light rail (dim, then amber); the legend under it ----
  const { parts, free, buffer } = contextParts(snap)
  const room = [
    ...(free > 0 ? [{ value: free, color: TRACK, label: 'Free', room: true }] : []),
    ...(buffer > 0 ? [{ value: buffer, color: C.warn, label: 'Buffer', room: true }] : []),
  ]
  const context = k.section({
    id: 'context',
    icon: GLYPH.context,
    title: 'Context',
    right: snap ? k.summary([[`${snap.percent}%`, `of ${tokens(snap.max)}`, levelColor(snap.percent)]]) : undefined,
    loading: !snap,
    ...fold('context'),
    children: snap
      ? [
          <Box key="meter">{k.bar([...parts, ...room], snap.max)}</Box>,
          // Keyed with the bar's own glyphs: ━ for what's used, ─ for the room.
          k.legend(
            'ctx',
            [...parts, ...room].map(p => ({ label: p.label, color: p.color, figure: tokens(p.value), room: 'room' in p })),
            undefined,
            { bar: true },
          ),
        ]
      : [k.note('ctx-reading', 'Reading context…', 'loading')],
  })

  // ---- limits ----
  const windows = d.limits ?? []
  // The header names the fullest window, so a folded section (or the narrow floor, which draws headers only) still says it.
  const fullest = windows.reduce<(typeof windows)[number] | null>((m, w) => (!m || w.percent > m.percent ? w : m), null)
  const limits = windows.length
    ? k.section({
        id: 'limits',
        icon: GLYPH.limits,
        title: 'Limits',
        right: fullest ? k.summary([[`${Math.round(fullest.percent)}%`, fx.limitLabel(fullest.kind).toLowerCase(), levelColor(fullest.percent)]]) : undefined,
        // The readings say it while the section is open.
        restated: true,
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

  // ---- activity: tool calls per turn ----
  const chart = activityChart(a)
  const toolCalls = Object.values(a.tools).reduce((n, t) => n + t.n, 0)
  // The chart's own width (whole cells per slot), so the turn numbers sit under their columns.
  const chartWidth = Math.max(1, Math.floor(k.width / chart.SLOTS)) * chart.SLOTS
  const activity =
    chart.log.length || toolCalls
      ? k.section({
          id: 'activity',
          icon: GLYPH.tools,
          title: 'Activity',
          right: k.summary([
            [String(chart.peak), 'peak'],
            // Narrow, the cache share goes first: the header would be cut.
            k.width >= 50 ? [`${chart.allIn ? Math.round((chart.cacheIn / chart.allIn) * 100) : 0}%`, 'cached'] : null,
          ]),
          ...fold('activity'),
          children: [
            <Box key="chart" flexDirection="column">
              {k.columns(chart.sliced, { slots: chart.SLOTS, height: 3 })}
              {k.axis(
                'act-axis',
                chart.ticks.map(i => ({ at: (i + 0.5) / chart.SLOTS, text: String(chart.first + i).padStart(2, '0') })),
                chartWidth,
              )}
            </Box>,
            // A chart taller than a row is its own block: its legend after one blank row.
            <Box key="legend" marginTop={k.space.block}>
              {k.legend('act', [
                ...chart.named.map(t => ({ label: shortTool(t.name), color: t.color, figure: String(a.tools[t.name]!.n) })),
                ...(chart.otherCount ? [{ label: 'Other', color: chart.OTHER, figure: String(chart.otherCount) }] : []),
              ])}
            </Box>,
          ],
        })
      : null

  // ---- accounting: the cost, the model, and the tokens each turn added as a sparkline ----
  // A spark rather than columns: one series over time with no parts to stack, and Braille's two
  // points a cell fit the whole turn log (40) in 20 cells, where columns show one turn a cell.
  const perTurn = a.turnLog.map(turnTokens)
  const SPARK_MIN = 4
  const accounting = k.section({
    id: 'accounting',
    icon: GLYPH.cost,
    title: 'Accounting',
    right: k.summary([[a.cost !== undefined ? money(a.cost) : '–']]),
    ...fold('accounting'),
    children: [
      k.prop('model', 'Model', snap ? snap.model : '–'),
      // The last turn's figure, then the spark on the same row, scaled to the log's peak; with
      // fewer than SPARK_MIN turns there's no shape to read, so the figure stands alone.
      perTurn.length
        ? k.prop(
            'turn-tokens',
            'Tokens',
            perTurn.length < SPARK_MIN ? (
              `${tokens(perTurn.at(-1)!)} last turn`
            ) : (
              <Box flexDirection="row" gap={k.space.group}>
                <Text wrap="truncate">{`${tokens(perTurn.at(-1)!)} last turn`}</Text>
                {k.spark(perTurn, { height: 1, width: Math.min(20, Math.ceil(perTurn.length / 2)) })}
              </Box>
            ),
          )
        : null,
    ],
  })

  return k.pinned(
    [context, limits, activity, ...workspaces(els, k, d, fold), gitSection(els, k, d, fold), accounting],
    k.perf(d.perf, { lead: machine(k, d.resources) }),
    d.rows,
  )
}

type Fold = (id: string) => { collapsed: boolean; onToggle: () => void }

/**
 * Workspaces: the branches the session started, two rows each: the PR's state as
 * its icon, the branch and its actions; then the PR's number and title, the
 * lines changed and CI.
 */
const workspaces = (els: TermElements, k: Kit, d: DesktopData, fold: Fold): RenderElement[] => {
  const { Box, Text } = els
  if (!d.branches.length) return []
  const entries = d.branches.map((b: BranchView, i) => {
    const pr = b.pr
    const open = pr?.state === 'OPEN'
    // A merged or closed PR's state is its icon (and the header's count): no word for it again.
    const ci = pr ? (open ? prChecks(pr, b.conflicted) : null) : b.conflicted ? (['failed', `${b.conflicted} conflicts`] as [StatusKind, string]) : null
    const main =
      !b.exists
        ? null
        : d.creating === b.branch
          ? null
          : !pr
            ? { key: `create-${b.branch}`, label: 'Create PR', onPress: () => d.createPr(b.branch) }
            : open && !pr.isDraft
              ? { key: `merge-${pr.number}`, label: 'Merge', onPress: () => d.mergePr(pr) }
              : null
    const where = b.worktree ? `${b.place} (worktree)` : b.place
    return (
      <Box key={`branch-${b.branch}`} flexDirection="column" marginTop={i === 0 ? 0 : k.space.block}>
        {k.item(`branch-${b.branch}-head`, {
          lead: pr ? prIcon(pr) : GLYPH.branch,
          leadColor: pr ? prColor(pr, b.conflicted > 0) : MUTED,
          text: b.branch,
          note: pr ? `#${pr.number}` : undefined,
          dim: !b.exists,
          // The actions sit beside the branch they act on, not alone on the far edge.
          after: k.actions(`branch-${b.branch}-actions`, [main, { key: `hide-${b.branch}`, label: 'hide', quiet: true, onPress: () => d.hideBranch(b.branch) }]),
          right: [d.creating === b.branch ? { part: 'creating PR…', drop: 1 } : null],
        })}
        {k.item(`branch-${b.branch}-pr`, {
          indent: k.edge.left,
          text: pr ? pr.title : where,
          dim: !pr,
          // Narrow, the lines changed go before CI.
          right: [
            b.insertions || b.deletions
              ? {
                  part: (
                    <Text key="diff">
                      <Text {...k.ink(C.ok)}>{`+${b.insertions}`}</Text>
                      <Text {...k.ink(C.bad)}>{` −${b.deletions}`}</Text>
                    </Text>
                  ),
                  drop: 1,
                }
              : null,
            ci ? k.status(ci[0], ci[1], 'ci') : null,
          ],
        })}
      </Box>
    )
  })
  const merged = d.branches.filter(b => b.pr?.state === 'MERGED').length
  const openPrs = d.branches.filter(b => b.pr?.state === 'OPEN').length
  return [
    k.section({
      id: 'workspaces',
      icon: GLYPH.branch,
      title: 'Workspaces',
      // A failed gh read keeps the last PRs: the header says so, and how old they are.
      right: k.summary([openPrs ? [String(openPrs), 'open', C.blue] : null, merged ? [String(merged), 'merged', C.purple] : null], {
        failed: Boolean(d.workspacesGh?.failed),
        age: d.workspacesGh?.failed ? since(d.workspacesGh.at, d.at) : undefined,
      }),
      ...fold('workspaces'),
      children: entries,
    }),
  ]
}

/**
 * Git: the session's own checkout (branch, upstream, worktree, what changed) and
 * the open pull requests it has, each a list row with its status.
 */
const gitSection = (els: TermElements, k: Kit, d: DesktopData, fold: Fold): RenderElement => {
  const { Box, Text } = els
  const repo = d.git
  const hub = d.gh
  const head = (right: RenderElement | null, children: (RenderElement | null)[], loading = false) =>
    k.section({ id: 'git', icon: GLYPH.branch, title: 'Git', right: right ?? undefined, loading, ...fold('git'), children })
  if (repo === null) return head(null, [k.note('git-reading', 'Reading git…', 'loading')], true)
  if (!repo.ok) return head(null, [k.note('git-note', repo.note)])
  const g: GitInfo = repo
  // A failed git or gh read keeps the last-good figures: the header says so, with the older one's age.
  const ghHere = hub && hub.root === g.root ? hub : null
  const failed = Boolean(g.failed || ghHere?.failed)
  const failedAt = [g.failed ? g.at : undefined, ghHere?.failed ? ghHere.at : undefined].filter((x): x is number => Boolean(x))
  const state = failed ? { failed, age: failedAt.length ? since(Math.min(...failedAt), d.at) : undefined } : {}

  // The branch row: where the checkout is against its upstream.
  const sync: (RenderElement | string | null)[] = g.detached
    ? [k.status('warn', 'detached', 'sync')]
    : !g.upstream
      ? ['no upstream']
      : g.ahead || g.behind
        ? [
            g.ahead ? <Text key="ahead">{`${GLYPH.up}${g.ahead}`}</Text> : null,
            g.behind ? <Text key="behind" {...k.ink(C.warn)}>{`${GLYPH.down}${g.behind}`}</Text> : null,
          ]
        : [k.status('done', 'synced', 'sync')]

  const changes =
    g.conflicted || g.staged || g.modified || g.untracked || g.insertions || g.deletions
      ? k.summary([
          g.conflicted ? [String(g.conflicted), 'conflicted', C.bad] : null,
          g.staged ? [String(g.staged), 'staged', C.ok] : null,
          g.modified ? [String(g.modified), 'modified', C.warn] : null,
          g.untracked ? [String(g.untracked), 'untracked'] : null,
          g.insertions ? [`+${g.insertions}`, undefined, C.ok] : null,
          g.deletions ? [`−${g.deletions}`, undefined, C.bad] : null,
        ])
      : k.status('done', 'working tree clean', 'clean')

  const files = g.files.map(f =>
    k.item(`file-${f.path}`, {
      lead: 'file',
      leadColor: fileColor(f),
      text: basename(f.path),
      note: dirOf(f.path) || undefined,
      right: [f.kind === 'conflict' ? 'conflict' : f.kind],
    }),
  )

  // ---- pull requests ----
  const prs: (RenderElement | null)[] = []
  if (hub === null || hub.root !== g.root) prs.push(k.note('prs-reading', 'Reading pull requests…', 'loading'))
  else if (hub.note) prs.push(k.note('prs-note', hub.note))
  else if (hub.prs.length === 0) prs.push(k.note('prs-none', 'No open pull requests'))
  else {
    // A PR Workspaces already lists isn't listed again here.
    const listed = new Set(d.branches.map(b => b.pr?.number).filter((n): n is number => n !== undefined))
    const rest = hub.prs.filter(pr => !listed.has(pr.number))
    for (const pr of rest.slice(0, GIT_PRS)) {
      const ci = prChecks(pr)
      prs.push(
        k.item(`pr-${pr.number}`, {
          lead: prIcon(pr),
          leadColor: prColor(pr, false),
          text: pr.title,
          bold: pr.current,
          // Narrow, the number goes before CI: the title already says which PR it is.
          right: [{ part: `#${pr.number}`, drop: 1 }, ci ? k.status(ci[0], ci[1], 'ci') : null],
        }),
      )
      // What else the PR is waiting on, dim, under its title: the failing checks, the review, whether it's this branch's.
      const more = [
        pr.state === 'OPEN' && pr.failing.length ? pr.failing.slice(0, 3).join(', ') : '',
        pr.state === 'OPEN' && pr.isDraft ? 'draft' : '',
        pr.state === 'OPEN' && pr.review === 'APPROVED' ? 'approved' : '',
        pr.state === 'OPEN' && pr.review === 'CHANGES_REQUESTED' ? 'changes requested' : '',
        pr.state === 'OPEN' && pr.review === 'REVIEW_REQUIRED' ? 'review required' : '',
        pr.current ? 'this branch' : '',
      ].filter(Boolean)
      if (more.length) {
        prs.push(
          <Box key={`pr-${pr.number}-more`} paddingLeft={k.edge.left} minWidth={0}>
            <Text dimColor wrap="truncate">
              {more.join(' · ')}
            </Text>
          </Box>,
        )
      }
    }
    if (rest.length > GIT_PRS) prs.push(k.note('prs-more', `… ${rest.length - GIT_PRS} more`))
  }

  return head(k.summary([[g.repo]], state), [
    k.item('git-branch', { lead: GLYPH.branch, text: g.branch, right: sync }),
    k.prop(
      'git-worktree',
      g.worktree.linked ? 'Worktree' : 'Checkout',
      g.worktree.linked ? `${g.worktree.name}, linked (${g.worktree.count} total)` : g.worktree.count > 1 ? `main (+${g.worktree.count - 1} worktrees)` : 'main',
    ),
    <Box key="git-changes" minWidth={0}>
      {changes}
    </Box>,
    ...files,
    g.fileCount > g.files.length ? k.note('git-files-more', `… ${g.fileCount - g.files.length} more`) : null,
    prs.length ? <Box key="git-gap" height={k.space.block} /> : null,
    ...prs,
  ])
}
