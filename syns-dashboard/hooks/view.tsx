import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { C, GRAY, MUTED } from '../kit/tokens'
import { EDGE, MEASURE, SPACE, kit } from '../kit/ui'
import type { FlowSwitch } from '../kit/ui'
import type { StatusKind } from '../kit/tokens'
import type { AgentRow, BrainView, Ignored, PrCi, PrRow } from '../types'
import { daysAgo } from './brain'

export type Els = Pick<Elements['desktop'], 'Box' | 'Text' | 'Svg'> & Partial<Pick<Elements['desktop'], 'Button' | 'Link'>>

/** A PR's CI as the row's lead (a status kind) and the word after it. */
const CI_MARK: Record<PrCi, { lead: StatusKind | null; word: string }> = {
  passing: { lead: 'done', word: 'passing' },
  failing: { lead: 'failed', word: 'failing' },
  pending: { lead: 'pending', word: 'pending' },
  conflicting: { lead: 'warn', word: 'conflicting' },
  '': { lead: null, word: '' },
}

export type DashData = {
  brain: BrainView | null
  prs: PrRow[]
  agents: AgentRow[]
  doing: Record<string, string>
  collapsed: string[]
  /** Whether Pull requests lists what's ignored (its header's "N ignored" pressed). */
  ignoredOpen: boolean
  /** The engine's clock (ms since epoch). */
  now: number
}

export type DashActions = {
  toggle: (id: string) => void
  /** Runs `/syn:inbox`. */
  inbox: () => void
  /** Runs `/syn:back`. */
  back: () => void
  /** Runs `/syn:standup`. */
  standup: () => void
  /** Ignores (`ignore`) or stops ignoring a repo (`owner/name`) or PR (`owner/repo#n`): brain.json's `ignored`. */
  ignore: (list: 'repos' | 'prs', value: string, ignore: boolean) => void
  /** Folds or unfolds Pull requests' list of what's ignored. */
  showIgnored: () => void
  flow?: FlowSwitch
}

const LIVE = new Set(['running', 'pending', 'waiting'])

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/*
 * The desktop's list grid, on the kit's scale (the kit's `item` keeps its lead in a
 * fixed 2-column box, too tight for a `P1` badge, so the pane draws its own):
 * - LEAD: the lead column (a status glyph or a priority badge) and the room after it;
 * - INSET: every row's inset from the body edge, a tile's own padding, so a plain
 *   row's lead and a tile's lead sit on one column;
 * - ROW_GAP between rows of a list, TILE_GAP between tiles, SECTION_GAP above a section,
 *   HEAD_GAP between a section's header and its first row.
 */
const LEAD = 2 + SPACE.pair
const INSET = SPACE.item
const ROW_GAP = SPACE.pair
const TILE_GAP = SPACE.block
const SECTION_GAP = SPACE.group
const HEAD_GAP = SPACE.pair

/**
 * The re-entry pane, on every surface: five sections in the kit's inspector
 * look (what we're doing, what you decided, what's running, what needs you,
 * next), then a footer with the full brief (`/syn:back`).
 */
export const render = (els: Els, surface: RenderSurface, columns: number, rows: number | undefined, d: DashData, act: DashActions, focused?: boolean): RenderElement => {
  const { Box, Text } = els
  const terminal = surface === 'terminal'
  const k = kit(els as any, surface, columns, { focused, flow: act.flow, ...(terminal ? { measure: MEASURE } : {}) })
  const b = d.brain
  const fold = (id: string) => ({ collapsed: d.collapsed.includes(id), onToggle: () => act.toggle(id) })
  /** A second row under an item, starting under its text (past the lead's column). */
  const under = (key: string, text: string) => (
    <Box key={key} paddingLeft={terminal ? 2 : SPACE.group} minWidth={0}>
      {k.item(`${key}-row`, { text, dim: true, ...(terminal ? { width: k.width - 2 } : {}) })}
    </Box>
  )
  const loading = !b
  const failed = b?.error

  // ---- The desktop's list pieces (the terminal keeps the kit's rows as they are) ----
  /**
   * A row with its lead in the LEAD column and its lines beside it, top-aligned, so a
   * lead sits on the first line and every following line starts under the text.
   * Outside a tile it takes the INSET a tile pads by.
   */
  const led = (key: string, lead: RenderElement | null, lines: (RenderElement | null)[], inTile = false) => (
    <Box key={key} flexDirection="row" alignItems="flex-start" width="100%" minWidth={0} paddingX={inTile ? 0 : INSET}>
      <Box width={LEAD} flexShrink={0} flexDirection="row">
        {lead}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} width={0} minWidth={0} rowGap={TILE_GAP / 2}>
        {lines}
      </Box>
    </Box>
  )
  /** A dim line that wraps inside its column (a thread's next step, a decision's question). */
  const wrapped = (key: string, text: string) => (
    <Text key={key} wrap="wrap" color={GRAY.mid}>
      {text}
    </Text>
  )
  /** A plain, full-width row at the inset: a note or an item with no lead. */
  const inset = (key: string, el: RenderElement) => (
    <Box key={key} flexDirection="column" width="100%" minWidth={0} paddingX={INSET}>
      {el}
    </Box>
  )
  /** A section body: its rows (or tiles) `gap` apart, a step below the header. */
  const list = (key: string, rows: (RenderElement | null)[], gap: number = ROW_GAP) => (
    <Box key={key} flexDirection="column" width="100%" minWidth={0} rowGap={gap} paddingTop={HEAD_GAP}>
      {rows}
    </Box>
  )

  // ---- What we're doing: the outcome, then the top threads, each its title and status, then its next step ----
  const doing = k.section({
    id: 'doing',
    icon: 'tasklist',
    title: 'Doing',
    right:
      b && !failed
        ? k.summary([
            [String(b.threads.filter(t => t.tier === 'priority').length), 'prioritised'],
            [String(b.threads.filter(t => t.tier === 'next').length + b.moreThreads), 'next'],
          ])
        : undefined,
    loading,
    ...fold('doing'),
    children: !b
      ? [k.note('doing-loading', 'Reading brain.json…', 'loading')]
      : failed
        ? [k.note('doing-error', `${failed} · run /syn:onboard to make one`, 'error', { lines: 2 })]
        : !terminal
          ? [
              list('doing-list', [
                b.outcome ? inset('outcome', k.note('outcome', b.outcome)) : null,
                // Prioritised threads, each a tile: its priority badge (P1, P2 alike, in blue) and title, its next step wrapping under the title.
                ...b.threads
                  .filter(t => t.tier === 'priority')
                  .map(t =>
                    k.tile(`thread-${t.id}`, [
                      led(
                        `thread-${t.id}-row`,
                        <Text key="p" bold {...k.ink(C.blue)}>
                          {`P${t.priority}`}
                        </Text>,
                        [k.item(`thread-${t.id}-head`, { text: t.title, note: t.about, bold: t.priority === 1 }), t.next ? wrapped(`thread-${t.id}-next`, `next: ${t.next}`) : null],
                        true,
                      ),
                    ]),
                  ),
                // Then the ones waiting their turn, one dim row each, their lead on the tiles' lead column.
                ...b.threads
                  .filter(t => t.tier === 'next')
                  .map(t => led(`thread-${t.id}`, k.status('pending'), [k.item(`thread-${t.id}-head`, { text: t.title, note: t.about, dim: true })])),
                b.moreThreads ? inset('more-threads', k.note('more-threads', `and ${plural(b.moreThreads, 'more next thread')}`)) : null,
                b.decidedThreads ? inset('decided-threads', k.note('decided-threads', `${plural(b.decidedThreads, 'decided thread')} not shown`)) : null,
                b.threads.length ? null : inset('no-threads', k.note('no-threads', 'No prioritised or next threads.')),
              ]),
            ]
          : [
            b.outcome ? k.note('outcome', b.outcome) : null,
            // Prioritised threads, in priority order, their priority as the lead (P1, P2) and their next step under them.
            ...b.threads
              .filter(t => t.tier === 'priority')
              .map(t => (
                <Box key={`thread-${t.id}`} flexDirection="column" marginTop={terminal ? 0 : SPACE.pair / 2}>
                  {k.item(`thread-${t.id}-head`, {
                    lead: (
                      <Text key="p" bold {...k.ink(t.priority === 1 ? C.blue : undefined)}>
                        {`P${t.priority}`}
                      </Text>
                    ),
                    text: t.title,
                    note: t.about,
                    bold: t.priority === 1,
                  })}
                  {t.next ? under(`thread-${t.id}-next`, `next: ${t.next}`) : null}
                </Box>
              )),
            // Then the ones waiting their turn, one dim row each.
            ...b.threads
              .filter(t => t.tier === 'next')
              .map(t => k.item(`thread-${t.id}-head`, { lead: 'pending', text: t.title, note: t.about, dim: true })),
            b.moreThreads ? k.note('more-threads', `and ${plural(b.moreThreads, 'more next thread')}`) : null,
            b.decidedThreads ? k.note('decided-threads', `${plural(b.decidedThreads, 'decided thread')} not shown`) : null,
            b.threads.length ? null : k.note('no-threads', 'No prioritised or next threads.'),
          ],
  })

  // ---- What you decided: answered inbox items, newest first ----
  const decided =
    b && !failed
      ? k.section({
          id: 'decided',
          icon: 'checklist',
          title: 'Decided',
          right: k.summary([[String(b.decided.length), 'recent']]),
          ...fold('decided'),
          children: !terminal
            ? [
                list(
                  'decided-list',
                  b.decided.length
                    ? // Each decision a tile: ✓, the answer and its age on the first line, the question wrapping under it.
                      b.decided.map(x =>
                        k.tile(`decided-${x.id}`, [
                          led(
                            `decided-${x.id}-row`,
                            k.status('done'),
                            [k.item(`decided-${x.id}-head`, { text: x.text, right: [daysAgo(x.at, d.now)] }), x.topic ? wrapped(`decided-${x.id}-q`, x.topic) : null],
                            true,
                          ),
                        ]),
                      )
                    : [inset('decided-none', k.note('decided-none', 'Nothing answered yet.'))],
                  TILE_GAP,
                ),
              ]
            : b.decided.length
            ? b.decided.map(x =>
                k.item(`decided-${x.id}`, {
                  lead: 'done',
                  text: x.text,
                  note: x.topic,
                  right: [{ part: daysAgo(x.at, d.now), drop: 1 }],
                }),
              )
            : [k.note('decided-none', 'Nothing answered yet.')],
        })
      : null

  // ---- Agents: the live agents, and what each is doing ----
  const { Link } = els
  const live = d.agents.filter(a => LIVE.has(a.status))
  const agents = k.section({
    id: 'agents',
    icon: 'hubot',
    title: 'Agents',
    right: k.summary([[String(live.length), 'running', live.length ? C.blue : undefined]]),
    ...fold('agents'),
    children: !terminal
      ? [
          list('agents-list', [
            ...live.map(a =>
              led(`agent-${a.id}`, k.status(a.status === 'running' ? 'running' : 'pending'), [
                k.item(`agent-${a.id}-head`, { text: a.description || a.type, note: a.description ? a.type : undefined, right: a.status === 'running' ? [] : [a.status] }),
                d.doing[a.id] ? wrapped(`agent-${a.id}-doing`, d.doing[a.id]!) : null,
              ]),
            ),
            live.length ? null : inset('agents-none', k.note('agents-none', 'No agents running.')),
          ]),
        ]
      : [
          ...live.map(a => (
            <Box key={`agent-${a.id}`} flexDirection="column">
              {k.item(`agent-${a.id}-head`, {
                lead: a.status === 'running' ? 'running' : 'pending',
                text: a.description || a.type,
                note: a.description ? a.type : undefined,
                right: a.status === 'running' ? [] : [{ part: a.status, drop: 1 }],
              })}
              {d.doing[a.id] ? under(`agent-${a.id}-doing`, d.doing[a.id]!) : null}
            </Box>
          )),
          live.length ? null : k.note('agents-none', 'No agents running.'),
        ],
  })

  // ---- Pull requests: Ryan's recent open PRs and any brain.json names, with CI, grouped by repo, less what brain.json's `ignored` names ----
  const repoOf = (ref: string) => ref.split('#')[0] ?? ref
  const numOf = (ref: string) => (ref.includes('#') ? `#${ref.split('#')[1]}` : ref)
  const ignored: Ignored = b?.ignored ?? { repos: [], prs: [] }
  const open = d.prs.filter(p => p.state === 'OPEN' || p.state === '')
  // An ignored repo covers its PRs, the ones opened later too.
  const isIgnored = (p: PrRow) => ignored.prs.includes(p.ref) || ignored.repos.includes(repoOf(p.ref))
  const prs = open.filter(p => !isIgnored(p))
  const ignoredCount = ignored.repos.length + ignored.prs.length
  // The repos in the order their first PR comes, each with its PRs.
  const groups: { repo: string; prs: PrRow[] }[] = []
  for (const p of prs) {
    const repo = repoOf(p.ref)
    const g = groups.find(x => x.repo === repo)
    if (g) g.prs.push(p)
    else groups.push({ repo, prs: [p] })
  }
  // A row's right side on the desktop: the status word and the number, each in a column as wide as its longest, so they line up row to row.
  const wordW = Math.max(0, ...prs.map(p => ((CI_MARK[p.ci] ?? CI_MARK['']).word || (p.state ? '' : 'state unknown')).length))
  const numW = Math.max(0, ...prs.map(p => numOf(p.ref).length))
  const quiet = (key: string, label: string, onPress: () => void) => k.actions(key, [{ key, label, onPress, quiet: true }])
  const prRow = (p: PrRow) => {
    const ci = CI_MARK[p.ci] ?? CI_MARK['']
    const word = ci.word || (p.state ? '' : 'state unknown')
    const num = numOf(p.ref)
    // The number is the row's link to the PR (where gh gave its address); the repo is the group's label.
    const link = p.url && Link ? <Link key={`pr-${p.ref}-link`} href={p.url} label={num} /> : <Text key={`pr-${p.ref}-num`} wrap="truncate">{num}</Text>
    const hide = quiet(`ignore-${p.ref}`, 'Ignore', () => act.ignore('prs', p.ref, true))
    if (terminal) {
      return k.item(`pr-${p.ref}`, {
        lead: ci.lead ?? 'pr-open',
        leadColor: ci.lead ? undefined : MUTED,
        text: p.title || p.ref,
        right: [word ? { part: word, drop: 1 } : null, link, { part: hide, drop: 2 }],
      })
    }
    return led(`pr-${p.ref}`, ci.lead ? k.status(ci.lead) : k.icon('pr-open', MUTED), [
      k.item(`pr-${p.ref}-head`, {
        text: p.title || p.ref,
        right: [
          wordW ? (
            <Box key={`pr-${p.ref}-word`} width={wordW} flexShrink={0} flexDirection="row">
              <Text wrap="truncate" color={GRAY.mid}>
                {word}
              </Text>
            </Box>
          ) : null,
          <Box key={`pr-${p.ref}-ref`} width={numW} flexShrink={0} flexDirection="row" overflow="hidden">
            {link}
          </Box>,
          hide,
        ],
      }),
    ])
  }
  /** A repo's label over its rows: the repo dim, its quiet Ignore repo action on the right. */
  const repoLabel = (repo: string) => {
    const label = k.item(`repo-${repo}`, { text: repo, dim: true, right: [quiet(`ignore-repo-${repo}`, 'Ignore repo', () => act.ignore('repos', repo, true))] })
    return terminal ? label : inset(`repo-${repo}-row`, label)
  }
  /** The ignored repos and PRs, each with Stop ignoring, while the header's "N ignored" is pressed. */
  const ignoredRows = (): RenderElement[] => {
    if (!d.ignoredOpen || !ignoredCount) return []
    const row = (key: string, text: string, note: string | undefined, stop: () => void) => {
      const el = k.item(key, { text, note, dim: true, right: [quiet(`stop-${key}`, 'Stop ignoring', stop)] })
      return terminal ? el : inset(`${key}-row`, el)
    }
    return [
      ...ignored.repos.map(r => row(`ignored-repo-${r}`, r, 'repo', () => act.ignore('repos', r, false))),
      ...ignored.prs.map(r => row(`ignored-pr-${r}`, r, d.prs.find(p => p.ref === r)?.title, () => act.ignore('prs', r, false))),
    ]
  }
  const pulls = k.section({
    id: 'prs',
    icon: 'pr-open',
    title: 'Pull requests',
    right: (
      <Box key="prs-right" flexDirection="row" alignItems="center" gap={k.space.item}>
        {k.summary([[String(prs.length), 'open']])}
        {ignoredCount ? quiet('ignored-toggle', `${ignoredCount} ignored`, act.showIgnored) : null}
      </Box>
    ),
    keepRight: true,
    ...fold('prs'),
    children: !terminal
      ? [
          list(
            'prs-list',
            [
              ...groups.map(g => (
                <Box key={`group-${g.repo}`} flexDirection="column" width="100%" minWidth={0} rowGap={ROW_GAP}>
                  {repoLabel(g.repo)}
                  {g.prs.map(prRow)}
                </Box>
              )),
              prs.length ? null : inset('prs-none', k.note('prs-none', ignoredCount && open.length ? 'Every open PR is ignored.' : 'No open PRs updated this week.')),
              ...ignoredRows(),
            ],
            TILE_GAP * 2,
          ),
        ]
      : [
          ...groups.flatMap(g => [repoLabel(g.repo), ...g.prs.map(prRow)]),
          prs.length ? null : k.note('prs-none', ignoredCount && open.length ? 'Every open PR is ignored.' : 'No open PRs updated this week.'),
          ...ignoredRows(),
        ],
  })

  // ---- What needs you: open approvals, then the count of open questions and the inbox button ----
  const needs =
    b && !failed
      ? k.section({
          id: 'needs',
          icon: 'comment',
          title: 'Needs you',
          right: k.summary([
            [String(b.approvals.length), b.approvals.length === 1 ? 'approval' : 'approvals'],
            [String(b.questions), b.questions === 1 ? 'question' : 'questions'],
          ]),
          ...fold('needs'),
          children: !terminal
            ? [
                list('needs-list', [
                  ...b.approvals.map(x => led(`approval-${x.id}`, k.status('pending'), [k.item(`approval-${x.id}-head`, { text: x.question, right: [`#${x.id}`] })])),
                  inset(
                    'inbox-row',
                    b.approvals.length || b.questions
                      ? k.item('inbox', {
                          text: b.questions ? `${plural(b.questions, 'open question')}, on recommendations till answered` : 'Approvals wait for you',
                          dim: true,
                          after: k.actions('inbox-actions', [{ key: 'inbox', label: 'Answer /syn:inbox', onPress: act.inbox }]),
                        })
                      : k.note('needs-none', 'Nothing needs you.'),
                  ),
                ]),
              ]
            : [
            ...b.approvals.map(x => k.item(`approval-${x.id}`, { lead: 'pending', text: x.question, right: [{ part: `#${x.id}`, drop: 1 }] })),
            b.approvals.length || b.questions
              ? k.item('inbox', {
                  text: b.questions ? `${plural(b.questions, 'open question')}, on recommendations till answered` : 'Approvals wait for you',
                  dim: true,
                  after: k.actions('inbox-actions', [{ key: 'inbox', label: 'Answer /syn:inbox', onPress: act.inbox }]),
                })
              : k.note('needs-none', 'Nothing needs you.'),
          ],
        })
      : null

  // ---- Next: the single next step ----
  const next =
    b && !failed && b.next
      ? k.section({
          id: 'next',
          icon: 'arrow-up',
          title: 'Next',
          ...fold('next'),
          children: terminal ? [k.item('next-step', { text: b.next })] : [list('next-list', [inset('next-row', k.item('next-step', { text: b.next }))])],
        })
      : null

  // Standup first and plain (the main action), the full re-entry brief quiet beside it.
  const back = k.actions('back', [
    { key: 'standup', label: 'Standup', onPress: act.standup },
    { key: 'back', label: 'Brief /syn:back', onPress: act.back, quiet: true },
  ])
  const toggle = k.flowToggle()
  const footer = (
    <Box key="footer" flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={terminal ? 0 : SPACE.block} paddingLeft={terminal ? 0 : EDGE.right} paddingRight={terminal ? 0 : EDGE.right} minWidth={0}>
      {back}
      {toggle}
    </Box>
  )
  // On the desktop each section takes SECTION_GAP more above it than the kit's one row, so sections read apart.
  const spaced = (id: string, s: RenderElement | null) =>
    s && !terminal ? (
      <Box key={`spaced-${id}`} flexDirection="column" width="100%" minWidth={0} marginTop={SECTION_GAP}>
        {s}
      </Box>
    ) : s
  const body = k.pinned(
    k.flow('sections', [spaced('doing', doing), spaced('decided', decided), spaced('agents', agents), spaced('prs', pulls), spaced('needs', needs), spaced('next', next)]),
    footer,
    rows,
  )
  if (terminal) return body
  // The sections sit on the pane's own background (a fill here stopped short of the pane's edges).
  return (
    <Box flexDirection="column" flexGrow={1}>
      {body}
    </Box>
  )
}
