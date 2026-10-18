// What Ryan was focused on, over time, from his own prompts across harnesses.
//
//   bun analysis/focus.ts [--since YYYY-MM-DD] [--bucket day|week]
//
// Reads the person's prompts (never the agent's replies) from Claude Code
// transcripts (`~/.claude/projects/*/<uuid>.jsonl`) and Codex rollouts
// (`~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`), buckets them by local day
// or week (weeks start Monday), weighs each bucket's terms by TF-IDF (the
// bucket is the document, all buckets the corpus), groups co-occurring terms
// into topics, and writes `~/.syns/files/focus/focus.json` and `focus.html`,
// plus a one-line-per-bucket summary on stdout.
//
// Deterministic: no randomness, no model calls, every list sorted with a
// fixed tie-break, `generatedAt` is the newest prompt's time (not the clock).
// The same transcripts give byte-identical output on the same machine (the
// buckets follow its time zone).

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const OUT_DIR = join(HOME, '.syns', 'files', 'focus')

// ---- arguments ----

type BucketKind = 'day' | 'week'

const usage = () => {
  console.error('usage: bun analysis/focus.ts [--since YYYY-MM-DD] [--bucket day|week]')
  process.exit(2)
}

const parseArgs = (argv: string[]): { since: string | null; bucket: BucketKind } => {
  let since: string | null = null
  let bucket: BucketKind = 'week'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const v = argv[i + 1]
    if (a === '--since' && v && /^\d{4}-\d{2}-\d{2}$/.test(v)) (since = v), i++
    else if (a === '--bucket' && (v === 'day' || v === 'week')) (bucket = v), i++
    else usage()
  }
  return { since, bucket }
}

/** Local midnight of a `YYYY-MM-DD`. */
const localDay = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The local day or week (from Monday) a time falls in, as its start date. */
const bucketOf = (at: number, kind: BucketKind): string => {
  const d = new Date(at)
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (kind === 'week') day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return ymd(day)
}

const nextBucket = (start: string, kind: BucketKind): string => {
  const d = localDay(start)
  d.setDate(d.getDate() + (kind === 'week' ? 7 : 1))
  return ymd(d)
}

// ---- reading prompts ----

type Harness = 'claude' | 'codex'
type Prompt = { at: number; harness: Harness; repo: string; session: string; text: string }

const sortedDir = (dir: string): string[] => {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

const mtime = (path: string): number => {
  try {
    const s = statSync(path)
    return s.isFile() ? s.mtimeMs : -1
  } catch {
    return -1
  }
}

/** `owner/name` for a cwd under `~/Code/`, `codex desktop` for Codex Desktop's folders, else its last two segments (as the Tasks tab names them). */
const repoOf = (cwd: string): string => {
  if (!cwd) return '(unknown)'
  if (cwd.startsWith(`${HOME}/Documents/Codex/`)) return 'codex desktop'
  const inCode = cwd.startsWith(`${HOME}/Code/`)
  const parts = (inCode ? cwd.slice(HOME.length + 6) : cwd).split('/').filter(Boolean)
  return (inCode ? parts.slice(0, 2) : parts.slice(-2)).join('/') || cwd
}

/** Each line of `text` containing `mark`, once per line. */
function* linesWith(text: string, mark: string): Generator<{ line: string; after: number }> {
  let at = 0
  while ((at = text.indexOf(mark, at)) >= 0) {
    const start = text.lastIndexOf('\n', at) + 1
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    yield { line: text.slice(start, end), after: at + mark.length - start }
    at = end
  }
}

const CLAUDE_MARK = '"role":"user","content":'

/** The person's words in a Claude prompt: a slash command's name and arguments kept, the app's tagged blocks left out. */
const cleanClaude = (raw: string): string => {
  // An artifact comment arrives wrapped in the app's instructions; the person's words are the quoted lines.
  if (raw.startsWith('[Artifact comment sent to Claude]')) {
    const quote = /=== BEGIN ARTIFACT COMMENT \w+ ===\n([\s\S]*?)\n=== END ARTIFACT COMMENT/.exec(raw)?.[1] ?? ''
    return quote.replace(/^> ?/gm, '').trim()
  }
  if (/^(Another Claude session sent a message:|\[Subagent )/.test(raw)) return ''
  const command = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/.exec(raw)?.[1] ?? ''
  const text = raw
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, ' $1 ')
    .replace(/<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<\/?[a-zA-Z][\w-]*\b[^>]*>/g, ' ')
    .trim()
  return `${command} ${text}`.trim()
}

const readClaude = (since: number, out: Prompt[]) => {
  const root = join(HOME, '.claude', 'projects')
  const seen = new Set<string>()
  for (const dir of sortedDir(root)) {
    for (const f of sortedDir(join(root, dir))) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(root, dir, f)
      if (mtime(path) < since) continue
      const text = readFileSync(path, 'utf8')
      for (const { line, after } of linesWith(text, CLAUDE_MARK)) {
        const c = line[after]
        // Tool results are most of a transcript's bytes; skip them before parsing.
        if (c !== '"' && !(c === '[' && line.startsWith('[{"type":"text"', after))) continue
        let d: any
        try {
          d = JSON.parse(line)
        } catch {
          continue
        }
        if (d?.type !== 'user' || d.isMeta || d.isSidechain || d.isCompactSummary || d.isVisibleInTranscriptOnly) continue
        // The app's own messages (task notifications, other sessions, subagents) and scripted SDK runs aren't the person's.
        if (d.promptSource === 'system' || d.entrypoint === 'sdk-cli') continue
        const content = d.message?.content
        const raw =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.some((b: any) => b?.type === 'tool_result')
                ? ''
                : content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
              : ''
        const at = Date.parse(d.timestamp)
        if (!raw || !(at >= since)) continue
        const id = typeof d.uuid === 'string' ? d.uuid : `${f}:${at}:${raw.length}`
        if (seen.has(id)) continue
        seen.add(id)
        const clean = cleanClaude(raw)
        if (!clean || /^(Caveat:|\[Request interrupted|This session is being continued)/.test(clean)) continue
        out.push({
          at,
          harness: 'claude',
          repo: repoOf(typeof d.cwd === 'string' ? d.cwd : ''),
          session: typeof d.sessionId === 'string' ? d.sessionId : f.slice(0, -6),
          text: clean,
        })
      }
    }
  }
}

const CODEX_MARK = '"type":"UserMessage"'
/** Threads Codex starts on its own (an approval reviewer, a subagent) aren't the person's. */
const CODEX_SKIP = new Set(['guardian_review', 'subagent'])

const readCodex = (since: number, out: Prompt[]) => {
  const root = join(HOME, '.codex', 'sessions')
  const seen = new Set<string>()
  for (const y of sortedDir(root))
    for (const m of sortedDir(join(root, y)))
      for (const day of sortedDir(join(root, y, m)))
        for (const f of sortedDir(join(root, y, m, day))) {
          if (!f.startsWith('rollout-') || !f.endsWith('.jsonl')) continue
          const path = join(root, y, m, day, f)
          if (mtime(path) < since) continue
          const text = readFileSync(path, 'utf8')
          let meta: any
          try {
            meta = JSON.parse(text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n')))
          } catch {
            continue
          }
          if (meta?.type !== 'session_meta') continue
          const p = meta.payload ?? {}
          if (CODEX_SKIP.has(p.thread_source)) continue
          const session = typeof p.id === 'string' ? p.id : f
          const repo = repoOf(typeof p.cwd === 'string' ? p.cwd : '')
          for (const { line } of linesWith(text, CODEX_MARK)) {
            let d: any
            try {
              d = JSON.parse(line)
            } catch {
              continue
            }
            const item = d?.payload?.item
            if (d?.type !== 'event_msg' || d.payload?.type !== 'item_completed' || item?.type !== 'UserMessage') continue
            const at = Date.parse(d.timestamp)
            if (!(at >= since)) continue
            const id = typeof item.id === 'string' ? item.id : `${session}:${at}`
            if (seen.has(id)) continue
            seen.add(id)
            let raw = (Array.isArray(item.content) ? item.content : [])
              .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
              .map((b: any) => b.text)
              .join('\n')
            // Attached files or a ChatGPT conversation come first; the person's words follow this heading.
            const ask = raw.indexOf('## My request:')
            if (ask >= 0) raw = raw.slice(ask + 14)
            const clean = raw
              .replace(/<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
              .replace(/<\/?[a-zA-Z][\w-]*\b[^>]*>/g, ' ')
              .trim()
            if (clean) out.push({ at, harness: 'codex', repo, session, text: clean })
          }
        }
}

// ---- terms ----

/** English function words plus chat and voice-dictation filler. */
const STOPWORDS = new Set(
  `a about above after again against all almost also although always am among an and another any anybody anyone anything anyway anyways anywhere are aren around as at
  back be became because become been before being below between both but by can cannot cant could couldnt did didnt do does doesnt doing done dont down during
  each either else enough etc even ever every everything few for from further get gets getting give go goes going gone got gotta gonna had hadnt has hasnt have havent having he her here hers herself him himself his how however
  i id ill im ive if in into is isnt it its itself just keep kind kinda know let lets like likely made make makes making many may maybe me might mine more most much must my myself
  need needs never new no nor not nothing now of off often oh ok okay on once one only onto or other others otherwise our ours ourselves out over own
  per perhaps please pretty probably put quite rather really right said same say says see seem seems shall she should shouldnt since so some somehow someone something sometimes somewhere sort sorta still stuff such sure
  take than thank thanks that thats the their theirs them themselves then there theres these they theyre theyll theyve thing things think this those though through thus to too toward towards try trying
  uh um umm hmm under until up upon us use used using very via want wanna wants was wasnt way ways we well were werent weve what whatever whats when where whether which while who whom whose why will with within without wont would wouldnt
  yeah yep yes yet you youd youll your youre yours yourself yourselves youve alright actually basically literally anyway able already instead across along let's
  also again bit lot lots little way stuff thing things good great nice cool fine sounds sound guess mean means feel looks look looking see seeing yeah okay ok
  first last next two three now today currently go went gets getting done doing does did want wanted need needed think thought know knew say saying tell told
  make made makes making give given take taken taking work working works`.split(/\s+/),
)

/** Past this, a prompt is mostly pasted material (a report, a log): only its start counts. */
const MAX_PROMPT_CHARS = 2000
/** A prompt this long seen again word for word (a re-sent brief or paste) counts once. */
const DEDUPE_CHARS = 200

const PATH = /(?:~|\.{1,2})?\/?(?:[\w.@-]+\/)+[\w.@-]+/g
const URL = /\b(?:https?|file):\/\/\S+/g
const SLASH = /(^|[\s("'`])(\/[a-z][\w:-]*)(?=$|[\s,.;:!?)"'`])/g

/** A prompt's terms: unigrams, bigrams of adjacent kept words, and file paths, repo names and slash commands as single terms. */
const termsOf = (text: string, repos: Set<string>): Set<string> => {
  const out = new Set<string>()
  let t = text
    .slice(0, MAX_PROMPT_CHARS)
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(URL, ' ')
    .replace(/['’]/g, '')
  t = t.replace(PATH, (m: string) => {
    let p = m.replace(/[.,:;-]+$/, '')
    if (p.startsWith(HOME)) p = `~${p.slice(HOME.length)}`
    p = p.toLowerCase()
    const segs = p.split('/').filter(Boolean)
    const anchored = /^(~|\.|\/)/.test(p)
    const file = /\.[a-z][a-z0-9]{0,5}$/.test(segs[segs.length - 1] ?? '')
    if (repos.has(p) || anchored || file || segs.length >= 3) {
      out.add(p)
      return ' . '
    }
    return m.replace(/\//g, ' ')
  })
  t = t.replace(SLASH, (_m: string, pre: string, cmd: string) => {
    out.add(cmd.toLowerCase())
    return `${pre} . `
  })
  // A null breaks bigrams: a dropped word, or punctuation between clauses (the `.` left where a path or command was).
  const raw: (string | null)[] = []
  for (const clause of t.toLowerCase().split(/[.,;:!?()[\]{}"`|\n]+/)) {
    for (const w of clause.split(/[^\w-]+/)) {
      if (!w) continue
      const parts = repos.has(w) ? [w] : w.split(/-+/)
      for (const x of parts) {
        // Ids, hashes and timestamp shards (`26t17`, `4a02`, `01m`) have as many digits as letters.
        const digits = x.replace(/\D/g, '').length
        const ok = x.length >= 3 && digits * 2 < x.length && !STOPWORDS.has(x) && !/^_|_$/.test(x)
        raw.push(ok ? x : null)
      }
    }
    raw.push(null)
  }
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]
    if (!w) continue
    out.add(w)
    const n = raw[i + 1]
    if (n && n !== w) out.add(`${w} ${n}`)
  }
  return out
}

// ---- weighting and topics ----

const round = (x: number, d = 4) => {
  const f = 10 ** d
  return Math.round(x * f) / f
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Sizes of the intersection and union of two ascending index lists. */
const jaccard = (a: Int32Array, b: Int32Array): number => {
  let i = 0
  let j = 0
  let both = 0
  while (i < a.length && j < b.length) {
    if (a[i]! === b[j]!) both++, i++, j++
    else if (a[i]! < b[j]!) i++
    else j++
  }
  return both / (a.length + b.length - both)
}

/** Terms a topic can hold: seen in at least this many prompts... */
const VOCAB_MIN_PROMPTS = 5
/** ...across at least this many sessions (one long thread's jargon isn't a focus of its own)... */
const VOCAB_MIN_SESSIONS = 3
/** ...the most salient of them (summed TF-IDF over buckets). */
const VOCAB_SIZE = 500
/** Average-linkage merges stop below this mean Jaccard between two groups' terms. */
const MERGE_MIN = 0.03
/** A topic holds at most this many terms. */
const TOPIC_MAX = 25
/** A topic counts as present in a bucket from this share up (for first and last seen). */
const PRESENT = 0.01

/**
 * Group terms whose prompts overlap: start with one group per term, then
 * repeatedly merge the two groups with the highest average pairwise Jaccard
 * (ties to the lowest indices, terms in a fixed order) until none reaches
 * MERGE_MIN or every candidate would exceed TOPIC_MAX.
 */
const cluster = (sets: Int32Array[]): number[][] => {
  const n = sets.length
  const sim = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sim[i]![j] = sim[j]![i] = jaccard(sets[i]!, sets[j]!)
  const members: (number[] | null)[] = Array.from({ length: n }, (_, i) => [i])
  for (;;) {
    let best = MERGE_MIN
    let bi = -1
    let bj = -1
    for (let i = 0; i < n; i++) {
      const mi = members[i]
      if (!mi) continue
      const row = sim[i]!
      for (let j = i + 1; j < n; j++) {
        const mj = members[j]
        if (!mj || mi.length + mj.length > TOPIC_MAX) continue
        if (row[j]! > best || (bi < 0 && row[j]! >= best)) (best = row[j]!), (bi = i), (bj = j)
      }
    }
    if (bi < 0) break
    const a = members[bi]!
    const b = members[bj]!
    for (let k = 0; k < n; k++) {
      if (!members[k] || k === bi || k === bj) continue
      const v = (a.length * sim[bi]![k]! + b.length * sim[bj]![k]!) / (a.length + b.length)
      sim[bi]![k] = sim[k]![bi] = v
    }
    members[bi] = [...a, ...b]
    members[bj] = null
  }
  return members.filter((m): m is number[] => !!m)
}

// ---- output ----

type BucketOut = {
  start: string
  prompts: number
  sessions: number
  repos: Record<string, number>
  terms: { term: string; tfidf: number; count: number }[]
  topics: { id: string; share: number }[]
}
type TopicOut = { id: string; name: string; terms: string[]; first: string | null; peak: string | null; last: string | null; total: number }
type Focus = { generatedAt: string | null; since: string | null; bucket: BucketKind; buckets: BucketOut[]; topics: TopicOut[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Topics drawn in the chart: every bucket's leader, then the largest totals. */
const CHART_TOPICS = 10

const html = (f: Focus): string => {
  const byId = new Map(f.topics.map(t => [t.id, t]))
  const chosen: string[] = []
  for (const b of f.buckets) if (b.topics[0] && !chosen.includes(b.topics[0].id) && chosen.length < CHART_TOPICS) chosen.push(b.topics[0].id)
  for (const t of f.topics) if (chosen.length < CHART_TOPICS && !chosen.includes(t.id)) chosen.push(t.id)
  const shown = chosen.map(id => byId.get(id)!).sort((a, b) => b.total - a.total || cmp(a.id, b.id))
  const color = new Map(shown.map((t, k) => [t.id, `c${k}`]))
  const W = 960
  const H = 320
  const L = 40
  const R = 24
  const T = 10
  const B = 28
  const n = f.buckets.length
  const shareOf = f.buckets.map(b => new Map(b.topics.map(t => [t.id, t.share])))
  const series = shown.map(t => ({ name: t.name, cls: color.get(t.id)!, values: shareOf.map(m => m.get(t.id) ?? 0) }))
  // The rest of each bucket is spread over smaller topics; the axis tops out just above the tallest stack.
  const tallest = Math.max(0.1, ...f.buckets.map((_, i) => series.reduce((s, x) => s + x.values[i]!, 0)))
  const ymax = Math.min(1, Math.ceil(tallest * 10) / 10)
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1))
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B)
  const base = new Array<number>(n).fill(0)
  const paths: string[] = []
  for (const s of series) {
    const top = base.map((b, i) => b + s.values[i]!)
    const fwd = top.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    const back = base.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse()
    const d = n === 1 ? `M${x(0) - 8},${y(top[0]!)}H${x(0) + 8}V${y(base[0]!)}H${x(0) - 8}Z` : `M${fwd.join('L')}L${back.join('L')}Z`
    paths.push(`<path class="${s.cls}" d="${d}"><title>${esc(s.name)}</title></path>`)
    for (let i = 0; i < n; i++) base[i] = top[i]!
  }
  const step = Math.max(1, Math.ceil(n / 10))
  const ticks = f.buckets
    .map((b, i) => (i % step === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${b.start.slice(5)}</text>` : ''))
    .join('')
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(q => q * ymax)
    .map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v * 100)}%</text>`)
    .join('')
  const legend = series
    .map(s => `<span class="key"><i class="${s.cls}"></i>${esc(s.name)}</span>`)
    .join('')
    .concat(f.topics.length > shown.length ? `<span class="key dim">the rest of each ${f.bucket}: ${f.topics.length - shown.length} smaller topics</span>` : '')
  const topicRows = f.topics
    .map(t => {
      const sw = `<i class="${color.get(t.id) ?? 'co'}"></i>`
      return `<tr><td>${sw}${esc(t.name)}</td><td class="num">${t.total.toFixed(2)}</td><td>${t.first ?? '–'}</td><td>${t.peak ?? '–'}</td><td>${t.last ?? '–'}</td><td class="terms">${esc(t.terms.slice(0, 8).join(', '))}</td></tr>`
    })
    .join('')
  const names = new Map(f.topics.map(t => [t.id, t.name]))
  const bucketRows = [...f.buckets]
    .reverse()
    .map(b => {
      const top = b.topics[0]
      return `<tr><td>${b.start}</td><td class="num">${b.prompts}</td><td class="num">${b.sessions}</td><td>${top ? `${esc(names.get(top.id) ?? top.id)} <span class="dim">${(top.share * 100).toFixed(0)}%</span>` : ''}</td><td class="terms">${esc(b.terms.slice(0, 8).map(t => t.term).join(', '))}</td></tr>`
    })
    .join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Focus Timeline</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1f;--dim:#6e6e73;--rule:#e2e2e0;
--c0:#4e79a7;--c1:#f28e2b;--c2:#59a14f;--c3:#e15759;--c4:#76b7b2;--c5:#edc948;--c6:#b07aa1;--c7:#ff9da7;--c8:#9c755f;--c9:#3b9ab2;--co:#c9c9c6}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececec;--dim:#9a9aa0;--rule:#2c2c30;
--c0:#6f9fd0;--c1:#f5a55a;--c2:#7cc271;--c3:#ee7a7c;--c4:#8fd0cb;--c5:#f2d76b;--c6:#c99bc0;--c7:#ffb6be;--c8:#b8937c;--c9:#5bb6cc;--co:#4a4a4e}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:32px 0 8px}
.dim{color:var(--dim)}
svg{width:100%;height:auto;display:block}
svg text{fill:var(--dim);font-size:11px}svg line{stroke:var(--rule)}
svg path{stroke:var(--bg);stroke-width:.5}
${[...Array(CHART_TOPICS).keys()].map(k => `.c${k}{fill:var(--c${k});background:var(--c${k})}`).join('')}.co{fill:var(--co);background:var(--co)}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0 0}
.key{white-space:nowrap}
i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-weight:600;color:var(--dim);font-size:12px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td{white-space:nowrap}
td.terms{color:var(--dim);white-space:normal;min-width:16em}
</style></head><body><main>
<h1>Focus timeline</h1>
<div class="dim">${f.buckets.length} ${f.bucket === 'week' ? 'weeks' : 'days'}${f.since ? ` since ${f.since}` : ''} · ${f.buckets.reduce((s, b) => s + b.prompts, 0)} prompts · newest ${esc(f.generatedAt ?? '–')}</div>
<h2>Topic share per ${f.bucket}</h2>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked topic share over time">${grid}${paths.join('')}${ticks}</svg>
<div class="legend">${legend}</div>
<h2>Topics by total share</h2>
<div class="wrap"><table><thead><tr><th>Topic</th><th>Total</th><th>First</th><th>Peak</th><th>Last</th><th>Terms</th></tr></thead><tbody>${topicRows}</tbody></table></div>
<h2>${f.bucket === 'week' ? 'Weeks' : 'Days'}</h2>
<div class="wrap"><table><thead><tr><th>Start</th><th>Prompts</th><th>Sessions</th><th>Top topic</th><th>Top terms</th></tr></thead><tbody>${bucketRows}</tbody></table></div>
</main></body></html>
`
}

// ---- main ----

const main = () => {
  const { since, bucket } = parseArgs(process.argv.slice(2))
  const sinceMs = since ? localDay(since).getTime() : 0
  const read: Prompt[] = []
  readClaude(sinceMs, read)
  readCodex(sinceMs, read)
  read.sort((a, b) => a.at - b.at || cmp(a.harness, b.harness) || cmp(a.session, b.session) || cmp(a.text, b.text))
  const sent = new Set<string>()
  const prompts = read.filter(p => {
    if (p.text.length < DEDUPE_CHARS) return true
    if (sent.has(p.text)) return false
    sent.add(p.text)
    return true
  })

  const repos = new Set<string>()
  for (const p of prompts)
    if (p.repo.includes('/') && !p.repo.startsWith('.')) {
      repos.add(p.repo.toLowerCase())
      const name = p.repo.split('/')[1]!.toLowerCase()
      if (name.length >= 3) repos.add(name)
    }

  // Buckets, contiguous from the first prompt's to the last's.
  const starts: string[] = []
  if (prompts.length) {
    const last = bucketOf(prompts[prompts.length - 1]!.at, bucket)
    for (let s = bucketOf(prompts[0]!.at, bucket); s <= last; s = nextBucket(s, bucket)) starts.push(s)
  }
  const index = new Map(starts.map((s, i) => [s, i]))
  const nb = starts.length
  const counts = starts.map(() => new Map<string, number>())
  const sessions = starts.map(() => new Set<string>())
  const repoCounts = starts.map(() => new Map<string, number>())
  const promptCount = new Array<number>(nb).fill(0)
  const promptsOf = new Map<string, number[]>()
  prompts.forEach((p, pi) => {
    const b = index.get(bucketOf(p.at, bucket))!
    promptCount[b]!++
    sessions[b]!.add(`${p.harness}:${p.session}`)
    repoCounts[b]!.set(p.repo, (repoCounts[b]!.get(p.repo) ?? 0) + 1)
    for (const t of termsOf(p.text, repos)) {
      counts[b]!.set(t, (counts[b]!.get(t) ?? 0) + 1)
      const list = promptsOf.get(t)
      if (list) list.push(pi)
      else promptsOf.set(t, [pi])
    }
  })

  // TF-IDF: sublinear count times ln((N+1)/df), N the buckets with prompts.
  const N = promptCount.filter(c => c > 0).length
  const df = new Map<string, number>()
  for (const m of counts) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const weights = counts.map(m => {
    const w = new Map<string, number>()
    for (const [t, c] of m) w.set(t, (1 + Math.log(c)) * Math.log((N + 1) / df.get(t)!))
    return w
  })
  const score = new Map<string, number>()
  for (const w of weights) for (const [t, v] of w) score.set(t, (score.get(t) ?? 0) + v)

  // Topics over the most salient terms.
  const vocab = [...promptsOf.entries()]
    .filter(([, ps]) => ps.length >= VOCAB_MIN_PROMPTS && new Set(ps.map(i => prompts[i]!.session)).size >= VOCAB_MIN_SESSIONS)
    .map(([t]) => t)
    .sort((a, b) => score.get(b)! - score.get(a)! || cmp(a, b))
    .slice(0, VOCAB_SIZE)
    .sort(cmp)
  const groups = cluster(vocab.map(t => Int32Array.from(promptsOf.get(t)!)))
  const slug = (s: string) => s.replace(/[^\w~./:-]+/g, '-')
  const topicsRaw = groups
    .filter(g => g.length >= 2)
    .map(g => {
      const terms = g.map(i => vocab[i]!).sort((a, b) => score.get(b)! - score.get(a)! || cmp(a, b))
      return { id: slug(terms[0]!), name: terms[0]!, terms }
    })
  // A bucket's total is the weight of every topic's terms in it, so its topic shares sum to 1.
  const shares = weights.map(w => {
    const per = topicsRaw.map(tp => tp.terms.reduce((s, t) => s + (w.get(t) ?? 0), 0))
    const total = per.reduce((s, v) => s + v, 0)
    return per.map(v => (total > 0 ? v / total : 0))
  })
  const topics: TopicOut[] = topicsRaw
    .map((tp, k) => {
      let first: string | null = null
      let last: string | null = null
      let peak: string | null = null
      let peakV = 0
      let total = 0
      for (let b = 0; b < nb; b++) {
        const v = shares[b]![k]!
        total += v
        if (v >= PRESENT) {
          first ??= starts[b]!
          last = starts[b]!
        }
        if (v > peakV) (peakV = v), (peak = starts[b]!)
      }
      return { id: tp.id, name: tp.name, terms: tp.terms, first, peak, last, total: round(total) }
    })
    .sort((a, b) => b.total - a.total || cmp(a.id, b.id))

  const buckets: BucketOut[] = starts.map((start, b) => {
    const minCount = promptCount[b]! >= 30 ? 2 : 1
    const terms = [...weights[b]!.entries()]
      .filter(([t]) => counts[b]!.get(t)! >= minCount)
      .map(([term, v]) => ({ term, tfidf: round(v), count: counts[b]!.get(term)! }))
      .sort((x, y) => y.tfidf - x.tfidf || y.count - x.count || cmp(x.term, y.term))
      .slice(0, 40)
    const ts = topicsRaw
      .map((tp, k) => ({ id: tp.id, share: round(shares[b]![k]!) }))
      .filter(t => t.share > 0)
      .sort((x, y) => y.share - x.share || cmp(x.id, y.id))
    const rc = Object.fromEntries([...repoCounts[b]!.entries()].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0])))
    return { start, prompts: promptCount[b]!, sessions: sessions[b]!.size, repos: rc, terms, topics: ts }
  })

  const focus: Focus = {
    generatedAt: prompts.length ? new Date(prompts[prompts.length - 1]!.at).toISOString() : null,
    since,
    bucket,
    buckets,
    topics,
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'focus.json'), `${JSON.stringify(focus, null, 2)}\n`)
  writeFileSync(join(OUT_DIR, 'focus.html'), html(focus))

  const names = new Map(topics.map(t => [t.id, t.name]))
  const claude = prompts.filter(p => p.harness === 'claude').length
  console.log(`${prompts.length} prompts (${claude} claude, ${prompts.length - claude} codex), ${nb} ${bucket}s, ${topics.length} topics`)
  for (const b of buckets) {
    const top = b.topics[0]
    const what = top ? `${names.get(top.id)} (${(top.share * 100).toFixed(0)}%)` : '-'
    console.log(`${b.start}  ${String(b.prompts).padStart(4)} prompts  ${what}  · ${b.terms.slice(0, 5).map(t => t.term).join(', ')}`)
  }
  console.log(`wrote ${join(OUT_DIR, 'focus.json')} and focus.html`)
}

main()
