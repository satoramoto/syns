import type { RenderElement, RenderSurface } from 'claude-code'

import { ago } from '../../kit/format'
import { INK } from '../../kit/tokens'
import type { StatusKind } from '../../kit/tokens'
import { EDGE, MEASURE, SPACE, kit } from '../../kit/ui'
import type { Approval, TaskRow, TaskState, TaskView } from '../../types'
import type { Els } from '../view'

/** A task's state as its lead: running blue, waiting on you the pending mark (as an epic in review), idle grey, done green. */
const LEAD: Record<TaskState, StatusKind> = { running: 'running', waiting: 'pending', idle: 'idle', done: 'done' }

/** A session's label beside a row keeps this many characters. */
const LABEL_CHARS = 24

export type TasksData = {
  view: TaskView | null
  /** brain.json's open approvals: they wait on you too. */
  approvals: Approval[]
  /** Folded sections: `needs`, `repo-<owner/name>`. */
  collapsed: string[]
  now: number
}

export type TasksActions = {
  toggle: (id: string) => void
  /** Opens the row's session in the Claude app. */
  open: (r: TaskRow) => void
  /** Runs `/syn:inbox`. */
  inbox: () => void
}

const cut = (text: string, n: number) => ([...text].length > n ? `${[...text].slice(0, n - 1).join('')}…` : text)

/**
 * The Tasks tab: what waits on you across every session first (waiting rows and
 * brain.json's approvals), then a collapsible section per repo, most recent
 * first, its figures on the heading (running · waiting · idle · done) and one
 * reading per task under it: the state's mark, the task, the session's recap on
 * its current row, a gauge of its plan, the session (pressed, it opens there)
 * with the subagent running in it, and the age.
 */
export const renderTasks = (els: Els, surface: RenderSurface, columns: number, rows: number | undefined, d: TasksData, act: TasksActions, focused?: boolean): RenderElement => {
  const { Box } = els
  const terminal = surface === 'terminal'
  const k = kit(els as any, surface, columns, { focused, ...(terminal ? { measure: MEASURE } : {}) })
  const v = d.view
  const fold = (id: string) => ({ collapsed: d.collapsed.includes(id), onToggle: () => act.toggle(id) })
  // The terminal's narrow pane keeps the task and the age; the gauge goes first.
  const roomy = !terminal || k.width >= 56

  const gauge = (r: TaskRow, key: string) => (
    <Box key={key} width={terminal ? 6 : 4} flexShrink={0} flexDirection="row" alignItems="center">
      {k.gauge(r.done, Math.max(r.total, 1), INK, terminal ? { width: 6 } : {})}
    </Box>
  )
  const label = (r: TaskRow) => cut(r.agent ? `${r.title} · ${r.agent}` : r.title, terminal ? 18 : LABEL_CHARS)
  const row = (prefix: string, r: TaskRow) =>
    k.listItem(`${prefix}-${r.key}`, {
      lead: LEAD[r.state],
      title: r.text,
      dim: r.state === 'done',
      subtitle: r.recap || undefined,
      subtitleRole: r.state === 'waiting' || r.state === 'running' ? 'secondary' : 'meta',
      meta: r.state === 'waiting' ? ['waiting on you'] : undefined,
      right: [
        roomy ? gauge(r, `${prefix}-${r.key}-gauge`) : null,
        // The app opens a session on the desktop only (`open` is macOS's), and only one it has a record of: plain text otherwise.
        roomy ? (r.link && !terminal ? k.press(`${prefix}-${r.key}-open`, label(r), 'secondary', () => act.open(r)) : label(r)) : null,
        ago(d.now - r.at),
      ],
    })

  const spaced = (id: string, s: RenderElement | null) =>
    s && !terminal ? (
      <Box key={`spaced-${id}`} flexDirection="column" width="100%" minWidth={0} marginTop={SPACE.group}>
        {s}
      </Box>
    ) : s

  if (!v || v.note) {
    const body = k.collapsibleList({
      id: 'tasks',
      title: 'Tasks',
      loading: !v,
      items: [v?.note ? k.note('tasks-note', v.note, 'error') : k.note('tasks-loading', 'Reading session transcripts…', 'loading')],
    })
    return (
      <Box flexDirection="column" flexGrow={1} minWidth={0}>
        {body}
      </Box>
    )
  }

  // ---- Needs you: waiting sessions across repos, then brain.json's open approvals ----
  const needCount = v.needs.length + d.approvals.length
  const needs = needCount
    ? k.collapsibleList({
        id: 'needs',
        title: 'Needs you',
        right: k.summary([[String(needCount), 'waiting']]),
        ...fold('needs'),
        items: [
          ...v.needs.map(r => row('needs', r)),
          ...d.approvals.map(a =>
            k.listItem(`approval-${a.id}`, {
              lead: 'pending',
              title: a.question,
              meta: [`approval · inbox ${a.id}`],
              right: [k.actions(`approval-${a.id}-actions`, [{ key: `answer-${a.id}`, label: 'Answer', onPress: act.inbox }])],
            }),
          ),
        ],
      })
    : null

  // ---- one section per repo ----
  const sections = v.repos.map(repo => {
    const id = `repo-${repo.repo}`
    return spaced(
      id,
      k.collapsibleList({
        id,
        title: repo.repo,
        right: k.summary([
          repo.running ? [String(repo.running), 'running'] : null,
          repo.waiting ? [String(repo.waiting), 'waiting'] : null,
          repo.idle ? [String(repo.idle), 'idle'] : null,
          repo.done ? [String(repo.done), 'done'] : null,
        ]),
        ...fold(id),
        items: repo.rows.map(r => row('task', r)),
      }),
    )
  })

  const tasks = v.repos.reduce((n, r) => n + r.rows.length, 0)
  const figures = (
    <Box key="figures" flexDirection="row" paddingLeft={terminal ? 0 : EDGE.right} paddingRight={terminal ? 0 : EDGE.right} minWidth={0}>
      {k.summary([[String(tasks), tasks === 1 ? 'task' : 'tasks'], [String(v.sessions), v.sessions === 1 ? 'session' : 'sessions'], [String(v.repos.length), v.repos.length === 1 ? 'repo' : 'repos']])}
    </Box>
  )
  const empty = v.repos.length ? null : k.note('tasks-none', `No session kept a task list in the last week.`)
  return (
    <Box flexDirection="column" flexGrow={1} minWidth={0} minHeight={rows}>
      {figures}
      {spaced('needs', needs)}
      {empty}
      {sections}
    </Box>
  )
}
