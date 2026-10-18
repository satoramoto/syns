// What a session's transcript (`~/.claude/projects/<slug>/<sessionId>.jsonl`)
// says about its work, and every recent session's tasks as the Tasks tab draws
// them. Pure: register.tsx reads the files and feeds the lines in here.
import type { TaskRepo, TaskRow, TaskState, TaskView } from '../../types'
import { firstSentence } from '../brain'

export const DAY = 86_400_000

/** The transcript lines the Tasks tab reads: the app's turn tools (task list, wrap-up) and the person's prompts. */
export const TOOL_MARK = '"name":"mcp__ccd_turn__'
export const PROMPT_MARK = '"role":"user","content":"'

type Status = 'pending' | 'in_progress' | 'completed'
type Item = { content: string; status: Status }

/**
 * One session's transcript so far, built up line by line as the file grows. Each
 * event takes the next `seq`, so what came after what can be told.
 */
export type Scan = {
  /** The task list: the last `update_plan` call with `items`, with the later step calls applied. */
  plan: Item[] | null
  planSeq: number
  /** The last `wrap_up`'s recap, and whether it asked something. */
  recap: string
  ask: boolean
  wrapSeq: number
  /** The person's last prompt. */
  promptSeq: number
  /** The first prompt's text, for a title when the app has no record of the session. */
  firstPrompt: string
  seq: number
}

export const emptyScan = (): Scan => ({ plan: null, planSeq: 0, recap: '', ask: false, wrapSeq: 0, promptSeq: 0, firstPrompt: '', seq: 0 })

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const STATUSES = new Set<Status>(['pending', 'in_progress', 'completed'])

/** `update_plan`'s input on the list: a whole new list, `advance`, or `done`/`start` by 1-based number. */
const applyPlan = (s: Scan, input: any) => {
  if (Array.isArray(input?.items)) {
    s.plan = input.items
      .filter((x: any) => x && typeof x === 'object')
      .map((x: any): Item => ({ content: str(x.content), status: STATUSES.has(x.status) ? x.status : 'pending' }))
    s.planSeq = ++s.seq
    return
  }
  const plan = s.plan
  if (!plan) return
  if (input?.advance === true) {
    const at = plan.findIndex(x => x.status === 'in_progress')
    if (at >= 0) plan[at]!.status = 'completed'
    const next = plan.findIndex((x, i) => i > at && x.status === 'pending')
    if (next >= 0) plan[next]!.status = 'in_progress'
  }
  if (Array.isArray(input?.done)) for (const n of input.done) if (plan[Number(n) - 1]) plan[Number(n) - 1]!.status = 'completed'
  if (input?.start != null && plan[Number(input.start) - 1]) plan[Number(input.start) - 1]!.status = 'in_progress'
  s.planSeq = ++s.seq
}

/** A prompt's text from its (maybe cut) line: tags and pasted blocks left out, spaces collapsed. */
const promptText = (line: string): string => {
  const at = line.indexOf(PROMPT_MARK)
  if (at < 0) return ''
  const raw = /^((?:[^"\\]|\\.)*)/.exec(line.slice(at + PROMPT_MARK.length))?.[1] ?? ''
  let text: string
  try {
    text = JSON.parse(`"${raw.replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, '')}"`)
  } catch {
    text = raw
  }
  return text
    .replace(/<pasted_content[\s\S]*?(<\/pasted_content>|$)/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One transcript line the shell picked out (a turn tool's call or a prompt), applied to the scan. */
export const scanLine = (s: Scan, line: string) => {
  if (line.includes(TOOL_MARK)) {
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      return
    }
    if (d?.isSidechain || d?.type !== 'assistant') return
    for (const b of Array.isArray(d.message?.content) ? d.message.content : []) {
      if (b?.type !== 'tool_use') continue
      if (b.name === 'mcp__ccd_turn__update_plan') applyPlan(s, b.input)
      else if (b.name === 'mcp__ccd_turn__wrap_up') {
        s.recap = str(b.input?.recap)
        s.ask = Boolean(str(b.input?.ask).trim())
        s.wrapSeq = ++s.seq
      }
    }
    return
  }
  // Meta and sidechain prompts were left out by the shell, which tests the whole line: the markers sit past the cut.
  if (!line.includes(PROMPT_MARK)) return
  const text = promptText(line)
  // The app's own lines in the person's voice (a slash command's output, a caveat) aren't a turn of theirs.
  if (!text || /^(Caveat:|\[Request interrupted)/.test(text)) return
  s.promptSeq = ++s.seq
  if (!s.firstPrompt) s.firstPrompt = text
}

/** What register.tsx knows of a session beside its scan. */
export type Meta = { id: string; link: string; title: string; agent: string; at: number }

const RANK: Record<TaskState, number> = { running: 0, waiting: 1, idle: 2, done: 3 }

/**
 * One session's rows: one per item of its task list (or, with no list but a
 * wrap-up, one for the session itself). Its last wrap-up, coming after every
 * step call, checks off the in-progress step unless it asked something; asked,
 * and nothing after it, the session waits on you and its current step is the
 * waiting row. The recap goes on the session's current row (in progress or
 * waiting, else the last done). A session quiet for a day draws its in-progress
 * step idle and drops its done rows.
 */
export const toRows = (s: Scan, m: Meta, now: number): TaskRow[] => {
  const quiet = now - m.at > DAY
  const waiting = s.ask && s.wrapSeq > s.planSeq && s.wrapSeq > s.promptSeq
  const items: Item[] = s.plan
    ? s.plan.map(x => ({ ...x }))
    : s.wrapSeq
      ? [{ content: m.title, status: waiting ? 'in_progress' : 'completed' }]
      : []
  if (!items.length) return []
  if (s.wrapSeq > s.planSeq && !s.ask) for (const x of items) if (x.status === 'in_progress') x.status = 'completed'
  const running = items.findIndex(x => x.status === 'in_progress')
  const pending = items.findIndex(x => x.status === 'pending')
  const lastDone = items.map(x => x.status).lastIndexOf('completed')
  const waitAt = waiting ? (running >= 0 ? running : pending >= 0 ? pending : items.length - 1) : -1
  const current = waitAt >= 0 ? waitAt : running >= 0 ? running : lastDone
  const done = items.filter(x => x.status === 'completed').length
  const recap = s.recap ? firstSentence(s.recap) : ''
  const rows: TaskRow[] = []
  items.forEach((x, i) => {
    const state: TaskState =
      i === waitAt ? 'waiting' : x.status === 'completed' ? 'done' : x.status === 'in_progress' && !quiet ? 'running' : 'idle'
    if (state === 'done' && quiet) return
    rows.push({
      key: `${m.id}-${i}`,
      text: x.content || '(untitled step)',
      state,
      recap: i === current ? recap : '',
      done,
      total: items.length,
      session: m.id,
      link: m.link,
      title: m.title,
      agent: m.agent,
      at: m.at,
    })
  })
  return rows
}

/** `owner/name` for a cwd under `<home>/Code/`, else its last two segments. */
export const repoOf = (cwd: string, home: string): string => {
  const parts = (cwd.startsWith(`${home}/Code/`) ? cwd.slice(home.length + 6) : cwd).split('/').filter(Boolean)
  return cwd.startsWith(`${home}/Code/`) ? parts.slice(0, 2).join('/') : parts.slice(-2).join('/') || cwd
}

/** Every session's rows, grouped by repo: repos and needs most recent first, rows running, waiting, idle, done. */
export const toView = (sessions: { rows: TaskRow[]; repo: string }[], now: number): TaskView => {
  const byRepo = new Map<string, TaskRow[]>()
  for (const s of sessions) if (s.rows.length) byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), ...s.rows])
  const order = (a: TaskRow, b: TaskRow) => RANK[a.state] - RANK[b.state] || b.at - a.at
  const repos: TaskRepo[] = [...byRepo.entries()]
    .map(([repo, rows]) => {
      const count = (st: TaskState) => rows.filter(r => r.state === st).length
      return { repo, at: Math.max(...rows.map(r => r.at)), rows: [...rows].sort(order), running: count('running'), waiting: count('waiting'), idle: count('idle'), done: count('done') }
    })
    .sort((a, b) => b.at - a.at)
  const needs = repos.flatMap(r => r.rows.filter(x => x.state === 'waiting')).sort((a, b) => b.at - a.at)
  return { at: now, repos, needs, sessions: sessions.filter(s => s.rows.length).length }
}
