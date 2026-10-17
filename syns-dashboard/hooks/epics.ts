import type { EpicRow, PromiseRow } from '../types'
import { firstSentence } from './brain'

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const list = (v: unknown): any[] => (Array.isArray(v) ? v.filter(x => x != null) : [])

/** An epic's phase, from its status: the proposal until approved, then delivery, then how it ended. */
const phaseOf = (status: string): string =>
  status === 'draft' || status === 'review' ? 'proposal' : status === 'approved' || status === 'active' ? 'delivery' : status

const PROMISE_STATUS = new Set(['proven', 'refuted', 'open', 'dropped'])

/** What a proof opens: a file's path (`~` left for the opener to expand), else a page's or PR's URL; empty when it has neither. */
const targetOf = (p: any): string => (str(p?.kind) === 'file' ? str(p.path) : str(p?.url) || str(p?.path))

const toPromise = (p: any, i: number): PromiseRow => {
  const status = str(p.status).trim().toLowerCase()
  return {
    id: str(p.id) || `P${i + 1}`,
    text: str(p.text),
    by: str(p.by),
    status: PROMISE_STATUS.has(status) ? (status as PromiseRow['status']) : 'open',
    plan: str(p.proof),
    proof: list(p.proofs).map(targetOf).find(Boolean) ?? '',
  }
}

/**
 * One `~/.syns/epics/<id>/epic.json` as the Epics section draws it.
 * `open` is the set of brain.json inbox ids still open; without it (brain.json
 * unreadable), a question counts as open until the epic lists it under
 * `decisions`. A file that isn't a JSON object still gets a row, named after its
 * folder, with `error` saying why.
 */
export const toEpic = (text: string, folder: string, open: Set<number> | null): EpicRow => {
  const empty: EpicRow = { id: folder, rev: 0, status: '', phase: '', goal: '', promises: [], questions: 0, page: '' }
  let d: any
  try {
    d = JSON.parse(text)
  } catch {
    return { ...empty, error: "epic.json isn't valid JSON" }
  }
  if (!d || typeof d !== 'object') return { ...empty, error: "epic.json isn't an object" }
  const decided = new Set(list(d.decisions).map(Number))
  const questions = list(d.questions).map(Number).filter(n => Number.isFinite(n))
  const page = list(d.evidence).find(e => str(e.kind) === 'page' && str(e.url))
  const status = str(d.status).trim().toLowerCase()
  return {
    id: str(d.id) || folder,
    rev: Number(d.rev) || 0,
    status,
    phase: phaseOf(status),
    goal: firstSentence(str(d.goal)),
    promises: list(d.promises)
      .filter(p => typeof p === 'object')
      .map(toPromise),
    questions: questions.filter(q => (open ? open.has(q) : !decided.has(q))).length,
    page: page ? str(page.url) : '',
  }
}

/** The ids of brain.json's inbox items still open; null when the text isn't brain.json. */
export const openInbox = (text: string): Set<number> | null => {
  try {
    const d = JSON.parse(text)
    if (!d || typeof d !== 'object') return null
    return new Set(list(d.inbox).filter(i => i.status === 'open').map(i => Number(i.id)))
  } catch {
    return null
  }
}

/** The order rows are listed in: what needs review first, then active work, then the rest; by id within each. */
const RANK: Record<string, number> = { review: 0, approved: 1, active: 1, draft: 2, done: 3, rejected: 4, dropped: 4 }
export const sortEpics = (rows: EpicRow[]) => [...rows].sort((a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2) || a.id.localeCompare(b.id))
