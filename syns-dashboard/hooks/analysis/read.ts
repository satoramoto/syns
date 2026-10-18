// The focus analyzer's last run (`~/.syns/files/focus/focus.json`, written by
// `bun analysis/focus.ts`) as the Analysis tab draws it. Pure: register.tsx reads
// the file and hands its text in here. Read defensively: a field missing or of
// the wrong kind draws nothing, never an error.
import type { AnalysisBucket, AnalysisTerm, AnalysisTopic, AnalysisView } from '../../types'

/** Terms listed, by count. */
export const TERMS = 40
/** Neighbours under a term, by npmi. */
export const NEIGHBOURS = 8
/** Terms under a bucket, by TF-IDF. */
export const BUCKET_TERMS = 8
/** Topics listed, by total. */
export const TOPICS = 20

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** An empty view carrying why there's nothing to draw. */
export const noteView = (note: string, mtime = 0): AnalysisView => ({
  mtime,
  generatedAt: '',
  since: '',
  bucket: '',
  prompts: 0,
  termCount: 0,
  topicCount: 0,
  terms: null,
  buckets: [],
  topics: [],
  note,
})

/** focus.json's text, read at `mtime`, as the tab's view; a file that isn't JSON is a note. */
export const toView = (text: string, mtime: number): AnalysisView => {
  let d: any
  try {
    d = JSON.parse(text)
  } catch {
    return noteView('focus.json is not JSON (a run may be writing it).', mtime)
  }
  if (!d || typeof d !== 'object') return noteView('focus.json holds no run.', mtime)

  const rawTerms = Array.isArray(d.terms) ? d.terms : null
  // A stem's surface form, for neighbours and bucket terms that carry only the stem.
  const surface = new Map<string, string>()
  for (const t of arr(rawTerms)) if (t && str(t.term)) surface.set(str(t.term), str(t.surface) || str(t.term))
  const shown = (term: string) => surface.get(term) || term

  const terms: AnalysisTerm[] | null = rawTerms
    ? rawTerms
        .filter((t: any) => t && str(t.term))
        .map((t: any) => ({ term: str(t.term), surface: str(t.surface) || str(t.term), count: num(t.count) }))
        .sort((a: AnalysisTerm, b: AnalysisTerm) => b.count - a.count || a.term.localeCompare(b.term))
        .slice(0, TERMS)
        .map((t: AnalysisTerm) => {
          const raw = rawTerms.find((x: any) => x && x.term === t.term)
          const neighbours = arr(raw?.neighbours)
            .filter((n: any) => n && str(n.term))
            .map((n: any) => ({ term: str(n.term), surface: shown(str(n.term)), npmi: num(n.npmi) }))
            .sort((a, b) => b.npmi - a.npmi)
            .slice(0, NEIGHBOURS)
          return { ...t, neighbours }
        })
    : null

  const buckets: AnalysisBucket[] = arr(d.buckets)
    .filter(b => b && str(b.start))
    .map(b => ({
      start: str(b.start),
      prompts: num(b.prompts),
      sessions: num(b.sessions),
      terms: arr(b.terms)
        .filter((t: any) => t && str(t.term))
        .map((t: any) => ({ term: str(t.term), surface: shown(str(t.term)), count: num(t.count), tfidf: num(t.tfidf) }))
        .sort((x, y) => y.tfidf - x.tfidf || y.count - x.count)
        .slice(0, BUCKET_TERMS),
    }))
    .sort((a, b) => b.start.localeCompare(a.start))

  const rawTopics = arr(d.topics).filter(t => t && str(t.id))
  const all = rawTopics.reduce((n, t) => n + num(t.total), 0)
  const topics: AnalysisTopic[] = rawTopics
    .map(t => ({ id: str(t.id), name: str(t.name) || str(t.id), total: num(t.total), share: all > 0 ? num(t.total) / all : 0, first: str(t.first), last: str(t.last) }))
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
    .slice(0, TOPICS)

  return {
    mtime,
    generatedAt: str(d.generatedAt),
    since: str(d.since),
    bucket: str(d.bucket),
    prompts: buckets.reduce((n, b) => n + b.prompts, 0),
    termCount: rawTerms ? rawTerms.length : 0,
    topicCount: rawTopics.length,
    terms,
    buckets,
    topics,
  }
}
