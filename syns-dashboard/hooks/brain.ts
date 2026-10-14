import type { Approval, BrainView, Decision, ThreadRow } from '../types'

/** How many threads, decisions and PRs the pane lists. */
export const THREADS = 3
export const DECIDED = 8
export const PRS = 8

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** The first sentence of a text (up to `. ` before a capital, or its end), without the closing stop. */
export const firstSentence = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ')
  const m = /^(.+?[.!?])\s+(?=[A-Z(])/.exec(t)
  return (m ? m[1]! : t).replace(/\.$/, '')
}

/** A title split at its first `: `, the head as the title and the rest as what it's about. */
const splitTitle = (title: string) => {
  const i = title.indexOf(': ')
  return i > 0 ? { title: title.slice(0, i), about: title.slice(i + 2) } : { title, about: '' }
}

/** `owner/repo#n` for every PR the text names, as a ref or a pull URL, in order, once each. */
export const prRefs = (text: string): string[] => {
  const found: string[] = []
  const re = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)|\b([\w.-]+\/[\w.-]+)#(\d+)\b/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const ref = m[1] ? `${m[1]}#${m[2]}` : `${m[3]}#${m[4]}`
    if (!found.includes(ref)) found.push(ref)
  }
  return found
}

/** What an answer decided: the choice, or the note when the choice was "Other". */
const decisionText = (answer: any) => {
  const choice = str(answer?.choice)
  const note = str(answer?.note)
  return choice && choice !== 'Other' ? choice : firstSentence(note) || choice
}

/** brain.json's text, as the pane draws it. */
export const toView = (text: string, path: string, mtime: number): BrainView => {
  const empty: BrainView = { path, mtime, outcome: '', threads: [], moreThreads: 0, decided: [], approvals: [], questions: 0, prs: [], next: '' }
  let d: any
  try {
    d = JSON.parse(text)
  } catch (e) {
    return { ...empty, error: `brain.json isn't valid JSON (${str((e as Error).message).slice(0, 80)})` }
  }
  if (!d || typeof d !== 'object') return { ...empty, error: "brain.json isn't an object" }

  const active = (Array.isArray(d.threads) ? d.threads : [])
    .filter((t: any) => t && (t.status ?? 'active') === 'active')
    .sort((a: any, b: any) => (Number(a.priority) || 99) - (Number(b.priority) || 99))
  const threads: ThreadRow[] = active.slice(0, THREADS).map((t: any) => ({
    id: str(t.id),
    ...splitTitle(str(t.title || t.id)),
    priority: Number(t.priority) || 0,
    status: str(t.status || 'active'),
    next: firstSentence(str(t.next)),
  }))

  // Answered items live in `answered`, or stay in `inbox` marked answered; both count.
  const items: any[] = [...(Array.isArray(d.inbox) ? d.inbox : []), ...(Array.isArray(d.answered) ? d.answered : [])].filter(Boolean)
  const decided: Decision[] = items
    .filter(i => i.status === 'answered' && i.answer)
    .map(i => ({ id: Number(i.id) || 0, text: decisionText(i.answer), topic: str(i.question), at: str(i.answer.at) }))
    // Newest first: by when it was answered, then (answers of the same day) the later item.
    .sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1))
    .slice(0, DECIDED)

  const open = items.filter(i => i.status === 'open')
  const approvals: Approval[] = open.filter(i => i.kind === 'approval').map(i => ({ id: Number(i.id) || 0, question: str(i.question) }))

  return {
    path,
    mtime,
    outcome: str(d.outcome),
    threads,
    moreThreads: Math.max(0, active.length - THREADS),
    decided,
    approvals,
    questions: open.length - approvals.length,
    prs: prRefs(text).slice(0, PRS),
    // A `next` of its own wins; otherwise the top thread's.
    next: firstSentence(str(d.next)) || threads[0]?.next || '',
  }
}

/** How long ago a stored date (`2026-10-14`, or with a time) was, in days: `today`, `1d`, `12d`. */
export const daysAgo = (at: string, now: number) => {
  const t = Date.parse(at.length === 10 ? `${at}T00:00:00` : at)
  if (!Number.isFinite(t)) return ''
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const days = Math.ceil((start.getTime() - t) / 86_400_000)
  return days <= 0 ? 'today' : `${days}d`
}
