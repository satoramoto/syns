import type { ProposalRow } from '../types'
import { firstSentence } from './brain'

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const list = (v: unknown): any[] => (Array.isArray(v) ? v.filter(x => x != null) : [])

/**
 * One `~/.syns/proposals/<id>/proposal.json` as the Proposals section draws it.
 * `open` is the set of brain.json inbox ids still open; without it (brain.json
 * unreadable), a question counts as open until the proposal lists it under
 * `decisions`. A file that isn't a JSON object still gets a row, named after its
 * folder, with `error` saying why.
 */
export const toProposal = (text: string, folder: string, open: Set<number> | null): ProposalRow => {
  const empty: ProposalRow = { id: folder, rev: 0, status: '', goal: '', claims: 0, verified: 0, refuted: 0, questions: 0, page: '' }
  let d: any
  try {
    d = JSON.parse(text)
  } catch {
    return { ...empty, error: "proposal.json isn't valid JSON" }
  }
  if (!d || typeof d !== 'object') return { ...empty, error: "proposal.json isn't an object" }
  const claims = list(d.claims)
  const decided = new Set(list(d.decisions).map(Number))
  const questions = list(d.questions).map(Number).filter(n => Number.isFinite(n))
  const page = list(d.evidence).find(e => str(e.kind) === 'page' && str(e.url))
  return {
    id: str(d.id) || folder,
    rev: Number(d.rev) || 0,
    status: str(d.status).trim().toLowerCase(),
    goal: firstSentence(str(d.goal)),
    claims: claims.length,
    verified: claims.filter(c => str(c.status) === 'verified').length,
    refuted: claims.filter(c => str(c.status) === 'refuted').length,
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
export const sortProposals = (rows: ProposalRow[]) => [...rows].sort((a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2) || a.id.localeCompare(b.id))
