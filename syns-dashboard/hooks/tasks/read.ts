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
      harness: 'claude',
    })
  })
  return rows
}

// ---- Codex: `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<uuid>.jsonl` ----

/** The rollout lines the Tasks tab reads: the person's prompts and the agent's messages, as completed items. */
export const CODEX_PROMPT_MARK = '"type":"UserMessage"'
export const CODEX_REPLY_MARK = '"type":"AgentMessage"'

/** A Codex session's first line (`session_meta`): its id, its cwd, and whether it's one the person started. */
export type CodexMeta = { id: string; cwd: string; skip: boolean }

/** Threads Codex starts on its own (an approval reviewer, a subagent) aren't sessions of the person's. */
const CODEX_SKIP = new Set(['guardian_review', 'subagent'])

export const codexMeta = (line: string): CodexMeta | null => {
  let d: any
  try {
    d = JSON.parse(line)
  } catch {
    return null
  }
  if (d?.type !== 'session_meta') return null
  const p = d.payload ?? {}
  return { id: str(p.id), cwd: str(p.cwd), skip: CODEX_SKIP.has(str(p.thread_source)) }
}

/** One Codex session so far: its first prompt and its last message. */
export type CodexScan = { firstPrompt: string; reply: string }

export const emptyCodexScan = (): CodexScan => ({ firstPrompt: '', reply: '' })

/** The first `"text":"…"` string after `mark` in a (maybe cut) line, decoded. */
const textAfter = (line: string, mark: string): string => {
  const at = line.indexOf(mark)
  if (at < 0) return ''
  const t = line.indexOf('"text":"', at)
  if (t < 0) return ''
  // Escapes come in whole pairs here; only a `\u` escape can be cut short.
  const raw = (/^((?:[^"\\]|\\.)*)/.exec(line.slice(t + 8))?.[1] ?? '').replace(/\\u[0-9a-fA-F]{0,3}$/, '')
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw.replace(/\\[nrt]/g, ' ').replace(/\\(.)/g, '$1')
  }
}

/** Tags (a heartbeat, an app's context block) left out, spaces collapsed. */
const plain = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/** The Codex app's names for its threads (`~/.codex/session_index.jsonl`, one `{id, thread_name}` per line, the last one standing). */
export const codexNames = (text: string): Map<string, string> => {
  const names = new Map<string, string>()
  for (const line of text.split('\n')) {
    try {
      const d = JSON.parse(line)
      if (typeof d?.id === 'string' && typeof d.thread_name === 'string' && d.thread_name.trim()) names.set(d.id, d.thread_name.trim())
    } catch {
      continue
    }
  }
  return names
}

/** One rollout line the shell picked out (a prompt or a message), applied to the scan. */
export const scanCodexLine = (s: CodexScan, line: string) => {
  if (line.includes(CODEX_REPLY_MARK)) {
    const text = plain(textAfter(line, CODEX_REPLY_MARK))
    if (text) s.reply = text
    return
  }
  if (s.firstPrompt || !line.includes(CODEX_PROMPT_MARK)) return
  let text = textAfter(line, CODEX_PROMPT_MARK)
  // Attached files or a ChatGPT conversation come first; the person's words follow this heading.
  const ask = text.indexOf('## My request:')
  if (ask >= 0) text = text.slice(ask + 14)
  s.firstPrompt = plain(text)
}

/** A Codex session moved this recently is running. */
export const CODEX_LIVE = 10 * 60_000

/**
 * A Codex session's one row (Codex keeps no task list or wrap-up): running
 * while its rollout moved in the last 10 minutes, idle after a day, done
 * between; the recap is the first sentence of its last message.
 */
export const codexRow = (s: CodexScan, m: Meta, now: number): TaskRow => {
  const state: TaskState = now - m.at < CODEX_LIVE ? 'running' : now - m.at > DAY ? 'idle' : 'done'
  return {
    key: `${m.id}-0`,
    text: m.title,
    state,
    recap: s.reply ? firstSentence(s.reply) : '',
    done: state === 'done' ? 1 : 0,
    total: 1,
    session: m.id,
    link: '',
    title: m.title,
    agent: '',
    at: m.at,
    harness: 'codex',
  }
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
