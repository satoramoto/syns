import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { ago } from '../../kit/format'
import { INK } from '../../kit/tokens'
import { EDGE, FOLD, MEASURE, SPACE, fold, kit } from '../../kit/ui'
import type { AnalysisRun, AnalysisTerm, AnalysisView } from '../../types'
import type { Els } from '../view'

/** The dashboard's elements, with `Input` where the surface draws fields (not mobile). */
export type AnalysisEls = Els & Partial<Pick<Elements['desktop'], 'Input'>>

export type AnalysisData = {
  view: AnalysisView | null
  run: AnalysisRun
  /** Ids whose fold is flipped from its default (see `isOpen`). */
  folds: string[]
  /** The next run's settings: the person's, else the file's. */
  since: string
  bucket: 'day' | 'week'
  now: number
}

export type AnalysisActions = {
  toggle: (id: string) => void
  run: () => void
  /** Opens focus.html; absent where it can't (off the desktop). */
  open?: () => void
  setSince: (since: string) => void
  setBucket: (bucket: 'day' | 'week') => void
}

/** Sections start open, a term's neighbours folded, and only the newest bucket open. */
const isOpen = (folds: string[], id: string, byDefault: boolean) => byDefault !== folds.includes(id)

const pct = (share: number) => `${Math.round(share * 100)}%`
/** `YYYY-MM-DD` as `MM-DD`, for a lifespan's ends. */
const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(5) : d)

/**
 * The Analysis tab: the focus analyzer's last run. A heading with the run's
 * figures (generated, prompts, terms, topics), Run and Open page, and the next
 * run's since and bucket; then Terms (top 40 by count, each folding out its
 * closest neighbours by npmi), one section per bucket newest first (prompts,
 * sessions, its top terms), and Topics (top 20 by total, share and lifespan).
 */
export const renderAnalysis = (els: AnalysisEls, surface: RenderSurface, columns: number, rows: number | undefined, d: AnalysisData, act: AnalysisActions, focused?: boolean): RenderElement => {
  const { Box, Input } = els
  const terminal = surface === 'terminal'
  const k = kit(els as any, surface, columns, { focused, ...(terminal ? { measure: MEASURE } : {}) })
  const v = d.view
  const open = (id: string, byDefault: boolean) => isOpen(d.folds, id, byDefault)

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
  const state = d.run.running
    ? k.note('analysis-running', 'running…', 'loading')
    : d.run.error
      ? k.note('analysis-error', d.run.error, 'error')
      : v?.note
        ? k.note('analysis-note', v.note, v.mtime ? 'error' : 'empty')
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
    const unfolded = open(id, false)
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
  const terms = v.terms
    ? k.collapsibleList({
        id: 'terms',
        title: 'Terms',
        right: k.summary([[String(v.terms.length), 'shown'], [String(v.termCount), 'kept']]),
        collapsed: !open('terms', true),
        onToggle: () => act.toggle('terms'),
        items: v.terms.length ? v.terms.map(term) : [k.note('terms-none', 'No terms in this run.')],
      })
    : null

  // ---- By week (or day): one fold per bucket, newest first ----
  const buckets = v.buckets.length
    ? k.collapsibleList({
        id: 'weeks',
        title: v.bucket === 'day' ? 'By day' : 'By week',
        right: k.summary([[String(v.buckets.length), v.bucket === 'day' ? 'days' : 'weeks']]),
        collapsed: !open('weeks', true),
        onToggle: () => act.toggle('weeks'),
        items: v.buckets.map((b, i) => {
          const id = `bucket-${b.start}`
          const max = Math.max(1e-9, ...b.terms.map(t => t.tfidf))
          return k.listItem(id, {
            title: b.start,
            right: [k.summary([[String(b.prompts), b.prompts === 1 ? 'prompt' : 'prompts'], [String(b.sessions), b.sessions === 1 ? 'session' : 'sessions']])],
            open: open(id, i === 0),
            onToggle: () => act.toggle(id),
            children: b.terms.length
              ? b.terms.map(t => k.reading(`${id}-${t.term}`, { label: t.surface, value: t.tfidf, max, color: INK, figure: String(t.count), labelWidth: terminal ? 14 : 12, ...(terminal ? { width: k.width - 2 } : {}) }))
              : [k.note(`${id}-none`, 'No terms.')],
          })
        }),
      })
    : null

  // ---- Topics: share of all topics' total, and lifespan ----
  const topMax = Math.max(1e-9, ...v.topics.map(t => t.share))
  const topics = v.topics.length
    ? k.collapsibleList({
        id: 'topics',
        title: 'Topics',
        right: k.summary([[String(v.topics.length), 'shown'], [String(v.topicCount), 'kept']]),
        collapsed: !open('topics', true),
        onToggle: () => act.toggle('topics'),
        items: v.topics.map(t =>
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
        ),
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
