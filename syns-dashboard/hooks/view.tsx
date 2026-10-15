import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { C, MUTED } from '../kit/tokens'
import { EDGE, MEASURE, SPACE, kit } from '../kit/ui'
import type { FlowSwitch } from '../kit/ui'
import type { AgentRow, BrainView, PrRow } from '../types'
import { daysAgo } from './brain'

export type Els = Pick<Elements['desktop'], 'Box' | 'Text' | 'Svg'> & Partial<Pick<Elements['desktop'], 'Button'>>

export type DashData = {
  brain: BrainView | null
  prs: PrRow[]
  agents: AgentRow[]
  doing: Record<string, string>
  collapsed: string[]
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
  flow?: FlowSwitch
}

const LIVE = new Set(['running', 'pending', 'waiting'])

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The re-entry pane, on every surface: five sections in the kit's inspector
 * look (what we're doing, what you decided, what's running, what needs you,
 * next), then a footer with the full brief (`/syn:back`).
 */
export const render = (els: Els, surface: RenderSurface, columns: number, rows: number | undefined, d: DashData, act: DashActions, focused?: boolean): RenderElement => {
  const { Box } = els
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

  // ---- What we're doing: the outcome, then the top threads, each its title and status, then its next step ----
  const doing = k.section({
    id: 'doing',
    icon: 'tasklist',
    title: 'Doing',
    right: b && !failed ? k.summary([[String(b.threads.length + b.moreThreads), 'active']]) : undefined,
    loading,
    ...fold('doing'),
    children: !b
      ? [k.note('doing-loading', 'Reading brain.json…', 'loading')]
      : failed
        ? [k.note('doing-error', `${failed} · run /syn:onboard to make one`, 'error', { lines: 2 })]
        : [
            b.outcome ? k.note('outcome', b.outcome) : null,
            ...b.threads.map(t => (
              <Box key={`thread-${t.id}`} flexDirection="column" marginTop={terminal ? 0 : SPACE.pair / 2}>
                {k.item(`thread-${t.id}-head`, {
                  lead: 'running',
                  text: t.title,
                  note: t.about,
                  right: [{ part: `P${t.priority}`, drop: 1 }],
                })}
                {t.next ? under(`thread-${t.id}-next`, `next: ${t.next}`) : null}
              </Box>
            )),
            b.moreThreads ? k.note('more-threads', `and ${plural(b.moreThreads, 'more thread')}`) : null,
            b.threads.length ? null : k.note('no-threads', 'No active threads.'),
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
          children: b.decided.length
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

  // ---- What's running: live agents (and what each is doing), then the open PRs brain.json names ----
  const live = d.agents.filter(a => LIVE.has(a.status))
  const prs = d.prs.filter(p => p.state === 'OPEN' || p.state === '')
  const running = k.section({
    id: 'running',
    icon: 'zap',
    title: 'Running',
    right: k.summary([[String(live.length), live.length === 1 ? 'agent' : 'agents', live.length ? C.blue : undefined], [String(prs.length), prs.length === 1 ? 'PR' : 'PRs']]),
    ...fold('running'),
    children: [
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
      ...prs.map(p =>
        k.item(`pr-${p.ref}`, {
          lead: 'pr-open',
          leadColor: p.state === 'OPEN' ? C.ok : MUTED,
          text: p.title || p.ref,
          note: p.title ? p.ref : undefined,
          right: p.state ? [] : [{ part: 'state unknown', drop: 1 }],
        }),
      ),
      live.length || prs.length ? null : k.note('running-none', 'No agents running, no open PRs.'),
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
          children: [
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
          children: [k.item('next-step', { text: b.next })],
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
  const body = k.pinned(k.flow('sections', [doing, decided, running, needs, next]), footer, rows)
  if (terminal) return body
  // The desktop pane takes the main window's background.
  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor="#151515">
      {body}
    </Box>
  )
}
