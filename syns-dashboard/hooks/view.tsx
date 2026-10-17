import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { C, GRAY, GLYPH, MUTED, STATUS, TRACK } from '../kit/tokens'
import { EDGE, MEASURE, SPACE, kit } from '../kit/ui'
import type { FlowSwitch, Part } from '../kit/ui'
import type { StatusKind } from '../kit/tokens'
import type { AgentRow, BrainView, EpicRow, Ignored, PrCi, PrRow, PromiseRow } from '../types'
import { daysAgo } from './brain'

export type Els = Pick<Elements['desktop'], 'Box' | 'Text' | 'Svg'> & Partial<Pick<Elements['desktop'], 'Button' | 'Link'>>

/** A PR's CI as a coloured status mark (the PR's state has its own icon): pending is in progress, blue. */
const CI_MARK: Record<PrCi, StatusKind | null> = {
  passing: 'done',
  failing: 'failed',
  pending: 'running',
  conflicting: 'warn',
  '': null,
}

/** An epic's status as a status mark: in review waits on Ryan, approved or active is under way. */
const EPIC_MARK: Record<string, StatusKind> = {
  review: 'pending',
  approved: 'running',
  active: 'running',
  done: 'done',
  rejected: 'stopped',
  dropped: 'stopped',
  draft: 'idle',
}

export type DashData = {
  brain: BrainView | null
  prs: PrRow[]
  /** Every epic under `~/.syns/epics/`; null before the first read. */
  epics: EpicRow[] | null
  agents: AgentRow[]
  doing: Record<string, string>
  collapsed: string[]
  /** Whether Pull requests lists what's ignored. */
  ignoredOpen: boolean
  /** List items unfolded (`thread-<id>`, `decided-<id>`); folded by default. */
  unfolded: string[]
  /** The PR whose ⋮ menu is unfolded, if any. */
  prMenu: string | null
  /** The PR whose Merge asks to be confirmed, if any. */
  mergeConfirm: string | null
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
  /** Opens an epic's page (its first `page` evidence) in the browser. */
  openEpic: (p: EpicRow) => void
  /** Opens a promise's first proof: its page or PR in the browser, its file in its app. */
  openProof: (p: EpicRow, promise: PromiseRow) => void
  /** Runs `/syn:review <id>`. */
  review: (p: EpicRow) => void
  /** Ignores (`ignore`) or stops ignoring a repo (`owner/name`) or PR (`owner/repo#n`): brain.json's `ignored`. */
  ignore: (list: 'repos' | 'prs', value: string, ignore: boolean) => void
  /** Folds or unfolds Pull requests' list of what's ignored. */
  showIgnored: () => void
  /** Unfolds (or folds again) one PR's ⋮ menu, by `owner/repo#n`. */
  menu: (ref: string) => void
  /** Merge's first press (`confirm`), its second (`merge`), or auto-merge on (`auto`) or off (`disable-auto`). */
  merge: (p: PrRow, how: 'confirm' | 'merge' | 'auto' | 'disable-auto') => void
  /** Folds or unfolds one list item (`thread-<id>`, `decided-<id>`). */
  unfold: (id: string) => void
  flow?: FlowSwitch
}

const LIVE = new Set(['running', 'pending', 'waiting'])

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The re-entry pane, on every surface: its sections as the kit's collapsible lists
 * (what we're doing, what you decided, agents, pull requests, what needs you, next),
 * each item a list item, on the kit's contrast ladder (TEXT_ROLES: titles primary,
 * subtitles and links secondary, figures, ages, notes and actions meta, icons and
 * marks the quietest, colour for status only), then a footer with the standup and
 * the full brief.
 */
export const render = (els: Els, surface: RenderSurface, columns: number, rows: number | undefined, d: DashData, act: DashActions, focused?: boolean): RenderElement => {
  const { Box, Text, Button, Link } = els
  const terminal = surface === 'terminal'
  const k = kit(els as any, surface, columns, { focused, flow: act.flow, ...(terminal ? { measure: MEASURE } : {}) })
  const b = d.brain
  const fold = (id: string) => ({ collapsed: d.collapsed.includes(id), onToggle: () => act.toggle(id) })
  /** An item's own fold: open while its id is unfolded. */
  const itemFold = (id: string) => ({ open: d.unfolded.includes(id), onToggle: () => act.unfold(id) })
  /** A dim line that wraps, for what an item's fold holds. */
  const wrapped = (key: string, text: string) => (
    <Text key={key} wrap="wrap" {...(terminal ? { dimColor: true } : { color: GRAY.mid })}>
      {text}
    </Text>
  )
  const quiet = (key: string, label: string, onPress: () => void) => k.actions(key, [{ key, label, onPress, quiet: true }])
  /** A waiting item's lead: ◌ as a mark (L3), not a status blue. */
  const waiting = (
    <Text key="waiting" {...k.role('mark')}>
      {GLYPH.pending}
    </Text>
  )
  const loading = !b
  const failed = b?.error

  // ---- Doing: the threads, each its priority badge (or ◌ waiting), title and next step; what it's about behind its fold ----
  const doing = k.collapsibleList({
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
    items: !b
      ? [k.note('doing-loading', 'Reading brain.json…', 'loading')]
      : failed
        ? [k.note('doing-error', `${failed} · run /syn:onboard to make one`, 'error', { lines: 2 })]
        : [
            ...b.threads.map(t =>
              k.listItem(`thread-${t.id}`, {
                // The badge is primary text (no hue: colour is for status), bold for P1; a waiting thread's ◌ is a mark,
                // its title secondary and its next step meta, a step quieter than the prioritised ones.
                lead:
                  t.tier === 'priority' ? (
                    <Text key="p" bold={t.priority === 1}>
                      {`P${t.priority}`}
                    </Text>
                  ) : (
                    waiting
                  ),
                title: t.title,
                bold: t.tier === 'priority' && t.priority === 1,
                dim: t.tier === 'next',
                subtitleRole: t.tier === 'next' ? 'meta' : 'secondary',
                subtitle: t.next ? `next: ${t.next}` : undefined,
                subtitleWrap: true,
                ...(t.about ? { ...itemFold(`thread-${t.id}`), children: [wrapped(`thread-${t.id}-about`, t.about)] } : {}),
              }),
            ),
            b.moreThreads ? k.note('more-threads', `and ${plural(b.moreThreads, 'more next thread')}`) : null,
            b.decidedThreads ? k.note('decided-threads', `${plural(b.decidedThreads, 'decided thread')} not shown`) : null,
            b.threads.length ? null : k.note('no-threads', 'No prioritised or next threads.'),
          ],
  })

  // ---- Decided: the question in one line and its age; the decision called out under it; the rest behind its fold ----
  const decided =
    b && !failed
      ? k.collapsibleList({
          id: 'decided',
          icon: 'checklist',
          title: 'Decided',
          right: k.summary([[String(b.decided.length), 'recent']]),
          ...fold('decided'),
          items: b.decided.length
            ? b.decided.map(x => {
                const more = [x.topic && x.topic !== x.title ? x.topic : '', x.note && x.note !== x.text ? x.note : '', x.reason ? `Why: ${x.reason}` : ''].filter(Boolean)
                return k.listItem(`decided-${x.id}`, {
                  title: x.title,
                  right: [daysAgo(x.at, d.now)],
                  subtitle: x.text,
                  subtitleLead: 'done',
                  strong: true,
                  ...(more.length ? { ...itemFold(`decided-${x.id}`), children: more.map((t, i) => wrapped(`decided-${x.id}-more-${i}`, t)) } : {}),
                })
              })
            : [k.note('decided-none', 'Nothing answered yet.')],
        })
      : null

  // ---- Agents: the live agents, each its status, description and what it's doing now ----
  const live = d.agents.filter(a => LIVE.has(a.status))
  const agents = k.collapsibleList({
    id: 'agents',
    icon: 'hubot',
    title: 'Agents',
    right: k.summary([[String(live.length), 'running', live.length ? C.blue : undefined]]),
    ...fold('agents'),
    items: live.length
      ? live.map(a =>
          k.listItem(`agent-${a.id}`, {
            lead: a.status === 'running' ? 'running' : 'pending',
            title: a.description || a.type,
            right: a.status === 'running' ? [] : [a.status],
            subtitle: d.doing[a.id] || (a.description ? a.type : undefined),
          }),
        )
      : [k.note('agents-none', 'No agents running.')],
  })

  // ---- Pull requests: Ryan's recent open PRs and any brain.json names, less what brain.json's `ignored` names ----
  const repoOf = (ref: string) => ref.split('#')[0] ?? ref
  const numOf = (ref: string) => (ref.includes('#') ? `#${ref.split('#')[1]}` : ref)
  /** The repo's short name (`visuals` for `openflowfm/visuals`). */
  const shortRepo = (ref: string) => repoOf(ref).split('/').pop() ?? repoOf(ref)
  const ignored: Ignored = b?.ignored ?? { repos: [], prs: [] }
  const open = d.prs.filter(p => p.state === 'OPEN' || p.state === '')
  // An ignored repo covers its PRs, the ones opened later too.
  const prs = open.filter(p => !ignored.prs.includes(p.ref) && !ignored.repos.includes(repoOf(p.ref)))
  const ignoredCount = ignored.repos.length + ignored.prs.length
  /** What the PR is: the kit's PR icon for its state, the colour carrying it (open blue, in progress; draft grey; merged purple; closed red). */
  const stateIcon = (p: PrRow): [string, string] =>
    p.state === 'MERGED' ? ['pr-merged', C.purple] : p.state === 'CLOSED' ? ['pr-closed', C.bad] : p.draft ? ['pr-draft', MUTED] : ['pr-open', C.blue]
  const prItem = (p: PrRow) => {
    const num = numOf(p.ref)
    const [icon, color] = stateIcon(p)
    // The number is the PR's link (where gh gave its address), secondary like the repo name before it, not a link blue.
    const link =
      p.url && Link ? (
        <Link key="link" href={p.url}>
          <Text {...k.role('secondary')}>{num}</Text>
        </Link>
      ) : (
        <Text key="link" {...k.role('secondary')}>
          {num}
        </Text>
      )
    const ignore = () => act.ignore('prs', p.ref, true)
    const ignoreRepo = () => act.ignore('repos', repoOf(p.ref), true)
    // A ⋮ on the title's line unfolds Ignore and Ignore repo under the item (the kit has no popover); the terminal keeps one quiet Ignore.
    const dots = Button ? k.press('menu', '⋮', 'mark', () => act.menu(p.ref)) : null
    const ci = CI_MARK[p.ci] ?? null
    // Merge and auto-merge, for open PRs: Merge asks for a second press (Confirm merge, in the danger tone);
    // a draft or a conflicting PR can't merge, and says why in its place.
    const isOpen = p.state === 'OPEN'
    const blocked = p.draft ? 'draft' : p.ci === 'conflicting' ? 'conflicting' : ''
    const confirming = d.mergeConfirm === p.ref
    const mergeActions = isOpen
      ? [
          blocked
            ? null
            : confirming
              ? { key: `merge-${p.ref}`, label: 'Confirm merge', onPress: () => act.merge(p, 'merge'), tone: 'danger' as const }
              : { key: `merge-${p.ref}`, label: 'Merge', onPress: () => act.merge(p, 'confirm'), quiet: true },
          p.auto
            ? { key: `auto-${p.ref}`, label: 'Disable auto-merge', onPress: () => act.merge(p, 'disable-auto'), quiet: true }
            : { key: `auto-${p.ref}`, label: 'Enable auto-merge', onPress: () => act.merge(p, 'auto'), quiet: true },
        ]
      : []
    return k.listItem(`pr-${p.ref}`, {
      lead: icon,
      leadColor: color,
      title: p.title || p.ref,
      subtitle: shortRepo(p.ref),
      // The CI mark, then a dim "auto" while auto-merge is on.
      meta: [link, ci ? k.status(ci, undefined, 'ci') : null, p.auto ? 'auto' : null],
      right: terminal || !dots ? [quiet(`ignore-${p.ref}`, 'Ignore', ignore)] : [dots],
      children:
        !terminal && d.prMenu === p.ref
          ? [
              k.actions(`pr-${p.ref}-actions`, [
                ...mergeActions,
                { key: `ignore-${p.ref}`, label: 'Ignore', onPress: ignore, quiet: true },
                { key: `ignore-repo-${p.ref}`, label: `Ignore ${shortRepo(p.ref)}`, onPress: ignoreRepo, quiet: true },
              ]),
              isOpen && blocked ? wrapped(`pr-${p.ref}-why`, `Can't merge: it's ${blocked === 'draft' ? 'a draft' : 'conflicting'}.`) : null,
            ]
          : [],
    })
  }
  /** The ignored repos and PRs, each with Stop ignoring, while the ignored list is unfolded. */
  const ignoredItems = (): RenderElement[] => {
    if (!d.ignoredOpen || !ignoredCount) return []
    const item = (key: string, title: string, subtitle: string | undefined, stop: () => void) =>
      k.listItem(key, { title, dim: true, subtitle, right: [quiet(`stop-${key}`, 'Stop ignoring', stop)] })
    return [
      ...ignored.repos.map(r => item(`ignored-repo-${r}`, r, 'repo', () => act.ignore('repos', r, false))),
      ...ignored.prs.map(r => item(`ignored-pr-${r}`, r, d.prs.find(p => p.ref === r)?.title, () => act.ignore('prs', r, false))),
    ]
  }
  const pulls = k.collapsibleList({
    id: 'prs',
    icon: 'pr-open',
    title: 'Pull requests',
    right: k.summary([[String(prs.length), 'open'], ignoredCount ? [String(ignoredCount), 'ignored'] : null]),
    ...fold('prs'),
    items: [
      ...prs.map(prItem),
      prs.length ? null : k.note('prs-none', ignoredCount && open.length ? 'Every open PR is ignored.' : 'No open PRs updated this week.'),
      ignoredCount ? quiet('ignored-toggle', d.ignoredOpen ? `Fold ${ignoredCount} ignored` : `Show ${ignoredCount} ignored`, act.showIgnored) : null,
      ...ignoredItems(),
    ],
  })

  // ---- What needs you: open approvals, then the count of open questions and the inbox button ----
  const needs =
    b && !failed
      ? k.collapsibleList({
          id: 'needs',
          icon: 'comment',
          title: 'Needs you',
          right: k.summary([
            [String(b.approvals.length), b.approvals.length === 1 ? 'approval' : 'approvals'],
            [String(b.questions), b.questions === 1 ? 'question' : 'questions'],
          ]),
          ...fold('needs'),
          items: [
            ...b.approvals.map(x => k.listItem(`approval-${x.id}`, { lead: waiting, title: x.question, right: [`#${x.id}`] })),
            b.approvals.length || b.questions
              ? k.listItem('inbox', {
                  title: b.questions ? `${plural(b.questions, 'open question')}, on recommendations till answered` : 'Approvals wait for you',
                  dim: true,
                  right: [k.actions('inbox-actions', [{ key: 'inbox', label: 'Answer /syn:inbox', onPress: act.inbox }])],
                })
              : k.note('needs-none', 'Nothing needs you.'),
          ],
        })
      : null

  // ---- Epics: each its status, id, phase and open questions; a proof bar and one line per promise under it; Open and Review beside it ----
  const epicRows = d.epics ?? []
  const openQs = epicRows.reduce((n, p) => n + p.questions, 0)
  const inReview = epicRows.filter(p => p.status === 'review').length
  // On the terminal a list item's children sit a gutter (2 cells) in from the body.
  const under = k.width - 2
  /** One promise as one bar segment: proven in the done colour, refuted in the failed one, open as track, dropped dim. */
  const segment = (pr: PromiseRow): Part =>
    pr.status === 'proven'
      ? { value: 1, color: STATUS.done.color }
      : pr.status === 'refuted'
        ? { value: 1, color: STATUS.failed.color }
        : pr.status === 'dropped'
          ? { value: 1, color: GRAY.dark }
          : { value: 1, color: terminal ? MUTED : TRACK, room: true }
  /** The promises as one bar, a segment each in order, and the figure "proven of total". */
  const proofBar = (p: EpicRow) => {
    const proven = p.promises.filter(pr => pr.status === 'proven').length
    const of = ` of ${p.promises.length}`
    return (
      <Box key={`epic-${p.id}-proofs`} flexDirection="row" alignItems="center" gap={terminal ? 1 : SPACE.item} minWidth={0}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {k.bar(p.promises.map(segment), p.promises.length, terminal ? { width: Math.max(4, under - String(proven).length - of.length - 1) } : {})}
        </Box>
        <Text>
          {String(proven)}
          <Text color={MUTED}>{of}</Text>
        </Text>
      </Box>
    )
  }
  /** A proof plan, cut to fit beside a promise on the app surfaces (whose right cluster doesn't give way); the terminal cuts it itself. */
  const plan = (text: string) => (terminal || text.length <= 32 ? text : `${text.slice(0, 31)}…`)
  const promiseLine = (p: EpicRow, pr: PromiseRow) =>
    k.item(`epic-${p.id}-${pr.id}`, {
      text: pr.text ? `${pr.id}  ${pr.text}` : pr.id,
      note: pr.by || undefined,
      dim: pr.status === 'dropped',
      right: [
        pr.proof
          ? k.actions(`epic-${p.id}-${pr.id}-actions`, [{ key: `open-${p.id}-${pr.id}`, label: 'Open', onPress: () => act.openProof(p, pr) }])
          : pr.plan
            ? plan(pr.plan)
            : null,
      ],
      ...(terminal ? { width: under } : {}),
    })
  const epicItem = (p: EpicRow) =>
    k.listItem(`epic-${p.id}`, {
      lead: EPIC_MARK[p.status] ?? 'idle',
      title: p.id,
      dim: p.status === 'done' || p.status === 'rejected' || p.status === 'dropped',
      right: [
        k.actions(`epic-${p.id}-actions`, [
          p.page ? { key: `open-${p.id}`, label: 'Open', onPress: () => act.openEpic(p) } : null,
          { key: `review-${p.id}`, label: 'Review', onPress: () => act.review(p), quiet: true },
        ]),
      ],
      subtitle: p.error ?? (p.goal || undefined),
      // The phase (with the revision past the first), then the open questions: the row's note.
      meta: [[p.phase || 'no status', p.rev > 1 ? `rev ${p.rev}` : ''].filter(Boolean).join(' · '), p.questions ? plural(p.questions, 'open question') : null],
      children: p.promises.length ? [proofBar(p), ...p.promises.map(pr => promiseLine(p, pr))] : [],
    })
  const epicsList = k.collapsibleList({
    id: 'epics',
    icon: 'book',
    title: 'Epics',
    right: d.epics && epicRows.length ? k.summary([[String(inReview), 'in review'], [String(openQs), openQs === 1 ? 'question' : 'questions']]) : undefined,
    loading: !d.epics,
    ...fold('epics'),
    items: !d.epics
      ? [k.note('epics-loading', 'Reading epics…', 'loading')]
      : epicRows.length
        ? epicRows.map(epicItem)
        : [k.note('epics-none', 'No epics yet. /syn:propose <ask>')],
  })

  // ---- Next: the single next step ----
  const next =
    b && !failed && b.next
      ? k.collapsibleList({
          id: 'next',
          icon: 'arrow-up',
          title: 'Next',
          ...fold('next'),
          items: [k.listItem('next-step', { title: b.next })],
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
  // On the desktop each list takes a group's space above it, so the lists read apart.
  const spaced = (id: string, s: RenderElement | null) =>
    s && !terminal ? (
      <Box key={`spaced-${id}`} flexDirection="column" width="100%" minWidth={0} marginTop={SPACE.group}>
        {s}
      </Box>
    ) : s
  const body = k.pinned(
    k.flow('sections', [spaced('doing', doing), spaced('decided', decided), spaced('agents', agents), spaced('prs', pulls), spaced('needs', needs), spaced('epics', epicsList), spaced('next', next)]),
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
