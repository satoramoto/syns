import type { Approval, BrainView, Decision, Ignored, PodRow } from '../types'

/** How many `next` pods (every prioritised one is listed), decisions and PRs the pane lists. */
export const NEXT_PODS = 5
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

/** Why a decision: the description of the option whose label is the choice; empty when the choice was "Other" or matches none. */
const reasonOf = (item: any) => {
  const choice = str(item?.answer?.choice)
  const options: any[] = Array.isArray(item?.options) ? item.options : []
  return str(options.find(o => o && str(o.label) === choice)?.description)
}

/** One entry of brain.json's `updates` as a line of text: a string as is, an object by its `text` or `title`. */
export const updateText = (u: unknown): string => {
  if (typeof u === 'string') return u
  const o = (u ?? {}) as Record<string, unknown>
  return str(o.text ?? o.title ?? JSON.stringify(u))
}

/** brain.json's `ignored` (`{ repos, prs }`), each list strings only; missing or malformed reads as empty. */
export const ignoredOf = (v: unknown): Ignored => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
  return { repos: list(o.repos), prs: list(o.prs) }
}

/** brain.json's text, as the pane and the band draw it. */
export const toView = (text: string, path: string, mtime: number): BrainView => {
  const empty: BrainView = { path, mtime, outcome: '', pods: [], morePods: 0, decidedPods: 0, decided: [], approvals: [], questions: 0, prs: [], ignored: { repos: [], prs: [] }, updates: [], next: '' }
  let d: any
  try {
    d = JSON.parse(text)
  } catch (e) {
    return { ...empty, error: `brain.json isn't valid JSON (${str((e as Error).message).slice(0, 80)})` }
  }
  if (!d || typeof d !== 'object') return { ...empty, error: "brain.json isn't an object" }

  // A pod's place: `next` or `decided` (in `status`, or as the whole of `state`), else
  // prioritised while it's active with a priority; active without one waits as `next`.
  // An older brain file names them `threads`; read that only when `pods` is absent.
  const source = d.pods !== undefined ? d.pods : d.threads
  const all: any[] = (Array.isArray(source) ? source : []).filter(Boolean)
  const placeOf = (t: any): 'priority' | 'next' | 'decided' | 'other' => {
    const word = [t.status, t.state].map(v => str(v).trim().toLowerCase()).find(v => v === 'next' || v === 'decided')
    if (word) return word as 'next' | 'decided'
    if ((t.status ?? 'active') !== 'active') return 'other'
    return Number(t.priority) > 0 ? 'priority' : 'next'
  }
  const row = (t: any, tier: PodRow['tier']): PodRow => ({
    id: str(t.id),
    ...splitTitle(str(t.title || t.id)),
    priority: Number(t.priority) || 0,
    status: str(t.status || 'active'),
    tier,
    next: firstSentence(str(t.next)),
  })
  const prioritised = all.filter(t => placeOf(t) === 'priority').sort((a, b) => Number(a.priority) - Number(b.priority))
  const waiting = all.filter(t => placeOf(t) === 'next')
  const pods: PodRow[] = [...prioritised.map(t => row(t, 'priority')), ...waiting.slice(0, NEXT_PODS).map(t => row(t, 'next'))]

  // Answered items live in `answered`, or stay in `inbox` marked answered; both count.
  const items: any[] = [...(Array.isArray(d.inbox) ? d.inbox : []), ...(Array.isArray(d.answered) ? d.answered : [])].filter(Boolean)
  const decided: Decision[] = items
    .filter(i => i.status === 'answered' && i.answer)
    .map(i => ({
      id: Number(i.id) || 0,
      title: str(i.title || i.topic) || firstSentence(str(i.question)),
      text: decisionText(i.answer),
      topic: str(i.question),
      note: str(i.answer.note),
      reason: reasonOf(i),
      at: str(i.answer.at),
    }))
    // Newest first: by when it was answered, then (answers of the same day) the later item.
    .sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1))
    .slice(0, DECIDED)

  const open = items.filter(i => i.status === 'open')
  const approvals: Approval[] = open.filter(i => i.kind === 'approval').map(i => ({ id: Number(i.id) || 0, question: str(i.question) }))

  return {
    path,
    mtime,
    outcome: str(d.outcome),
    pods,
    morePods: Math.max(0, waiting.length - NEXT_PODS),
    decidedPods: all.filter(t => placeOf(t) === 'decided').length,
    decided,
    approvals,
    questions: open.length - approvals.length,
    // The refs under `ignored` are PRs the user stopped hearing about, not PRs the file names.
    prs: prRefs(JSON.stringify({ ...d, ignored: undefined })).slice(0, PRS),
    ignored: ignoredOf(d.ignored),
    updates: (Array.isArray(d.updates) ? d.updates : []).filter((u: unknown) => u != null).map(updateText),
    // A `next` of its own wins; otherwise the top pod's.
    next: firstSentence(str(d.next)) || pods[0]?.next || '',
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
