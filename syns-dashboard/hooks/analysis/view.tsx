import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { ago } from '../../kit/format'
import { C, INK, STATUS } from '../../kit/tokens'
import { EDGE, FOLD, MEASURE, SPACE, fold, kit } from '../../kit/ui'
import type { AnalysisRun, AnalysisSection, AnalysisTerm, AnalysisView } from '../../types'
import type { Els } from '../view'

/** The dashboard's elements, with `Input` where the surface draws fields (not mobile). */
export type AnalysisEls = Els & Partial<Pick<Elements['desktop'], 'Input'>>

export type AnalysisData = {
  view: AnalysisView | null
  run: AnalysisRun
  /** The term and the bucket unfolded (`term-<stem>`, `bucket-<start>`), one of each at most. */
  folds: string[]
  /** The one section unfolded. */
  section: AnalysisSection
  /** The page of Terms shown, from 0. */
  page: number
  /** The next run's settings: the person's, else the file's. */
  since: string
  bucket: 'day' | 'week'
  now: number
}

export type AnalysisActions = {
  /** Unfolds a term or a bucket (folding the one open before it), or folds it. */
  toggle: (id: string) => void
  /** Unfolds a section (folding the one open), or folds it. */
  section: (id: Exclude<AnalysisSection, 'none'>) => void
  /** Shows a page of Terms. */
  page: (n: number) => void
  run: () => void
  /** Opens focus.html; absent where it can't (off the desktop). */
  open?: () => void
  setSince: (since: string) => void
  setBucket: (bucket: 'day' | 'week') => void
}

/**
 * Rows a page, by section. The engine refuses a tree over 100,000 characters
 * serialized, and a desktop row with a gauge (its SVG end caps and fill) costs
 * 2,000 to 3,000: one section open, a page of its rows, one term's neighbours
 * and one bucket's terms at a time keep the drawing near half of that.
 */
export const ANALYSIS_PAGE = { terms: 10, weeks: 10, topics: 10 } as const

const pct = (share: number) => `${Math.round(share * 100)}%`
/** `YYYY-MM-DD` as `MM-DD`, for a lifespan's ends. */
const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(5) : d)

/**
 * The Analysis tab: the focus analyzer's last run. A heading with the run's
 * figures (generated, prompts, terms, topics), Run and Open page, and the next
 * run's since and bucket; then Terms (top 40 by count, a page at a time, each
 * folding out its closest neighbours by npmi), By week (one fold per bucket
 * newest first: prompts, sessions, its top terms), and Topics (top 20 by total,
 * share and lifespan). One section, one term and one bucket unfold at a time.
 */
export const renderAnalysis = (els: AnalysisEls, surface: RenderSurface, columns: number, rows: number | undefined, d: AnalysisData, act: AnalysisActions, focused?: boolean): RenderElement => {
  const { Box, Text, Input } = els
  const terminal = surface === 'terminal'
  const k = kit(els as any, surface, columns, { focused, ...(terminal ? { measure: MEASURE } : {}) })
  const v = d.view
  const open = (id: string) => d.folds.includes(id)

  const spaced = (id: string, s: RenderElement | null) =>
    s && !terminal ? (
      <Box key={`spaced-${id}`} flexDirection="column" width="100%" minWidth={0} marginTop={SPACE.group}>
        {s}
      </Box>
    ) : s

  // ---- the heading: figures, actions, the next run's settings, the run's state ----
  const generated = v && v.generatedAt ? Date.parse(v.generatedAt) : NaN
  const figures = k.summary(
    v && !v.note
      ? [
          Number.isFinite(generated) ? [ago(Math.max(0, d.now - generated)), 'ago'] : null,
          [String(v.prompts), v.prompts === 1 ? 'prompt' : 'prompts'],
          v.termCount ? [String(v.termCount), v.termCount === 1 ? 'term' : 'terms'] : null,
          [String(v.topicCount), v.topicCount === 1 ? 'topic' : 'topics'],
        ]
      : [],
    { loading: !v },
  )
  const actions = k.actions('analysis-actions', [
    d.run.running ? null : { key: 'analysis-run', label: 'Run', onPress: act.run },
    act.open && v && !v.note ? { key: 'analysis-open', label: 'Open page', onPress: act.open, quiet: true } : null,
  ])
  const bucketPress = (b: 'day' | 'week') => k.press(`analysis-bucket-${b}`, b, d.bucket === b ? 'primary' : 'meta', () => act.setBucket(b))
  const controls = (
    <Box key="analysis-controls" flexDirection="row" alignItems="center" gap={terminal ? 1 : SPACE.item} minWidth={0}>
      <Box flexShrink={0}>{k.caption('since')}</Box>
      <Box width={terminal ? 12 : 9} flexShrink={0} minWidth={0}>
        {Input ? (
          // Keyed by the value, so a run or a reset puts the field back to it.
          <Input key={`analysis-since-${d.since}`} placeholder="YYYY-MM-DD" value={d.since} submitLabel="set" onSubmit={(s: string) => act.setSince(s.trim())} />
        ) : (
          k.press('analysis-since', d.since || '—', 'secondary', () => undefined)
        )}
      </Box>
      <Box flexShrink={0}>{k.caption('bucket')}</Box>
      {bucketPress('day')}
      {bucketPress('week')}
    </Box>
  )
  // An error is one line on every surface: the failed mark in its colour, then the words.
  // (The kit's error note marks it with an SVG icon on the desktop, which carries no text colour.)
  const failed = (key: string, text: string) => (
    <Box key={key} flexDirection="row" gap={terminal ? 1 : SPACE.pair} minWidth={0} alignItems="center">
      <Box flexShrink={0}>
        <Text {...k.ink(C.bad)}>{STATUS.failed.glyph}</Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate">{text}</Text>
      </Box>
    </Box>
  )
  const state = d.run.running
    ? k.note('analysis-running', 'running…', 'loading')
    : d.run.error
      ? failed('analysis-error', d.run.error)
      : v?.note
        ? v.mtime
          ? failed('analysis-note', v.note)
          : k.note('analysis-note', v.note, 'empty')
        : null
  const heading = k.collapsibleList({
    id: 'analysis',
    title: 'Focus',
    right: figures,
    items: [
      <Box key="analysis-bar" flexDirection="row" justifyContent="space-between" alignItems="center" gap={terminal ? 1 : SPACE.item} minWidth={0}>
        {controls}
        {actions}
      </Box>,
      state,
    ],
  })

  if (!v || v.note) {
    return (
      <Box flexDirection="column" flexGrow={1} minWidth={0} minHeight={rows}>
        {heading}
      </Box>
    )
  }

  // ---- Terms: a reading each, its neighbours folded under it ----
  const termMax = Math.max(1, ...(v.terms ?? []).map(t => t.count))
  const indent = terminal ? 2 : EDGE.left
  const term = (t: AnalysisTerm) => {
    const id = `term-${t.term}`
    const unfolded = open(id)
    const reading = k.reading(`${id}-reading`, { label: t.surface, value: t.count, max: termMax, color: INK, figure: String(t.count), labelWidth: terminal ? 14 : 12, ...(terminal ? { width: k.width - 2 } : {}) })
    return (
      <Box key={id} flexDirection="column" minWidth={0}>
        <Box flexDirection="row" alignItems="center" gap={terminal ? 1 : SPACE.pair} minWidth={0}>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {reading}
          </Box>
          {t.neighbours.length ? k.press(`${id}-fold`, terminal ? (unfolded ? FOLD.open : FOLD.closed) : fold(!unfolded), 'mark', () => act.toggle(id)) : <Box width={terminal ? 1 : 1.6} flexShrink={0} />}
        </Box>
        {unfolded && t.neighbours.length ? (
          <Box flexDirection="column" paddingLeft={indent} minWidth={0}>
            {t.neighbours.map(n =>
              k.reading(`${id}-n-${n.term}`, { label: n.surface, value: Math.max(0, n.npmi), max: 1, color: INK, figure: n.npmi.toFixed(2), unit: 'npmi', labelWidth: terminal ? 14 : 12, ...(terminal ? { width: k.width - 2 - indent } : {}) }),
            )}
          </Box>
        ) : null}
      </Box>
    )
  }
  // One section's items are drawn at a time, a page of them; a folded one draws its header alone.
  type Open = Exclude<AnalysisSection, 'none'>
  const shown = (id: Open) => d.section === id
  /** The open section's page of `rows`, its range for the header, and Previous/Next under it. */
  const paged = <T,>(id: Open, rows: T[]) => {
    const size = ANALYSIS_PAGE[id]
    const pages = Math.max(1, Math.ceil(rows.length / size))
    const page = shown(id) ? Math.max(0, Math.min(pages - 1, d.page)) : 0
    const first = page * size
    const slice = rows.slice(first, first + size)
    const range: [string, string] = [`${first + 1}–${first + slice.length}`, `of ${rows.length}`]
    const nav =
      pages > 1
        ? k.actions(`${id}-pages`, [
            page > 0 ? { key: `${id}-prev`, label: 'Previous', onPress: () => act.page(page - 1), quiet: true } : null,
            page < pages - 1 ? { key: `${id}-next`, label: 'Next', onPress: () => act.page(page + 1), quiet: true } : null,
          ])
        : null
    return { slice, range: rows.length > size ? range : null, nav }
  }

  const termPage = paged('terms', v.terms ?? [])
  const terms = v.terms
    ? k.collapsibleList({
        id: 'terms',
        title: 'Terms',
        right: k.summary([termPage.range ?? [String(v.terms.length), 'shown'], [String(v.termCount), 'kept']]),
        collapsed: !shown('terms'),
        onToggle: () => act.section('terms'),
        items: !shown('terms') ? [] : v.terms.length ? [...termPage.slice.map(term), termPage.nav] : [k.note('terms-none', 'No terms in this run.')],
      })
    : null

  // ---- By week (or day): one fold per bucket, newest first ----
  const bucketPage = paged('weeks', v.buckets)
  const buckets = v.buckets.length
    ? k.collapsibleList({
        id: 'weeks',
        title: v.bucket === 'day' ? 'By day' : 'By week',
        right: k.summary([bucketPage.range ?? [String(v.buckets.length), v.bucket === 'day' ? 'days' : 'weeks']]),
        collapsed: !shown('weeks'),
        onToggle: () => act.section('weeks'),
        items: !shown('weeks') ? [] : [...bucketPage.slice.map(b => {
          const id = `bucket-${b.start}`
          const max = Math.max(1e-9, ...b.terms.map(t => t.tfidf))
          return k.listItem(id, {
            title: b.start,
            right: [k.summary([[String(b.prompts), b.prompts === 1 ? 'prompt' : 'prompts'], [String(b.sessions), b.sessions === 1 ? 'session' : 'sessions']])],
            open: open(id),
            onToggle: () => act.toggle(id),
            children: b.terms.length
              ? b.terms.map(t => k.reading(`${id}-${t.term}`, { label: t.surface, value: t.tfidf, max, color: INK, figure: String(t.count), labelWidth: terminal ? 14 : 12, ...(terminal ? { width: k.width - 2 } : {}) }))
              : [k.note(`${id}-none`, 'No terms.')],
          })
        }), bucketPage.nav],
      })
    : null

  // ---- Topics: share of all topics' total, and lifespan ----
  const topMax = Math.max(1e-9, ...v.topics.map(t => t.share))
  const topicPage = paged('topics', v.topics)
  const topics = v.topics.length
    ? k.collapsibleList({
        id: 'topics',
        title: 'Topics',
        right: k.summary([topicPage.range ?? [String(v.topics.length), 'shown'], [String(v.topicCount), 'kept']]),
        collapsed: !shown('topics'),
        onToggle: () => act.section('topics'),
        items: !shown('topics') ? [] : [...topicPage.slice.map(t =>
          k.listItem(`topic-${t.id}`, {
            title: t.name,
            meta: t.first || t.last ? [t.first === t.last ? day(t.first) : `${day(t.first)} → ${day(t.last)}`] : undefined,
            right: [
              <Box key={`topic-${t.id}-gauge`} width={terminal ? 6 : 4} flexShrink={0} flexDirection="row" alignItems="center">
                {k.gauge(t.share, topMax, INK, terminal ? { width: 6 } : {})}
              </Box>,
              pct(t.share),
            ],
          }),
        ), topicPage.nav],
      })
    : null

  return (
    <Box flexDirection="column" flexGrow={1} minWidth={0} minHeight={rows}>
      {heading}
      {spaced('terms', terms)}
      {spaced('weeks', buckets)}
      {spaced('topics', topics)}
    </Box>
  )
}
