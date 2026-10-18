// What Ryan was focused on, over time, from his own prompts across harnesses.
//
//   bun analysis/focus.ts [--since YYYY-MM-DD] [--bucket day|week]
//
// Reads the person's prompts (never the agent's replies) from Claude Code
// transcripts (`~/.claude/projects/*/<uuid>.jsonl`), Codex rollouts, live and
// archived (`~/.codex/sessions/**`, `~/.codex/archived_sessions/**`), and chat
// exports (`~/.syns/files/exports/<harness>/**/conversations.json`, in
// ChatGPT's or Claude.ai's export format), buckets them by local day
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
const EXPORTS_DIR = join(HOME, '.syns', 'files', 'exports')

// ---- arguments ----

type BucketKind = 'day' | 'week'

const usage = () => {
  console.error('usage: bun analysis/focus.ts [--since YYYY-MM-DD] [--bucket day|week]')
  console.error(`chat exports: put each conversations.json under ${EXPORTS_DIR}/<harness>/ (chatgpt, claude-ai, ...)`)
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

/** `claude`, `codex`, or an export folder's name (`chatgpt`, `claude-ai`, ...). */
type Harness = string
/** `source`: a Codex thread's `thread_source` (`user`, `agent_created_thread`, ...); empty elsewhere. */
type Prompt = { at: number; harness: Harness; source: string; repo: string; session: string; text: string }

/** Every `.jsonl` (or other `suffix`) file under `dir`, in sorted path order. */
const walk = (dir: string, suffix: string, out: string[] = []): string[] => {
  let entries: { name: string; dir: boolean }[]
  try {
    entries = readdirSync(dir, { withFileTypes: true }).map(e => ({ name: e.name, dir: e.isDirectory() }))
  } catch {
    return out
  }
  for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
    const path = join(dir, e.name)
    if (e.dir) walk(path, suffix, out)
    else if (e.name.endsWith(suffix)) out.push(path)
  }
  return out
}

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
          source: '',
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
  // Archived rollouts are the same files moved; an item id seen twice (a fork, a re-archived copy) counts once.
  const seen = new Set<string>()
  const paths = [join(HOME, '.codex', 'sessions'), join(HOME, '.codex', 'archived_sessions')].flatMap(root => walk(root, '.jsonl'))
  for (const path of paths) {
          const f = path.slice(path.lastIndexOf('/') + 1)
          if (!f.startsWith('rollout-')) continue
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
          const source = typeof p.thread_source === 'string' ? p.thread_source : '(none)'
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
            if (clean) out.push({ at, harness: 'codex', source, repo, session, text: clean })
          }
        }
}

/**
 * Chat exports: every `conversations.json` under `<exports>/<harness>/`, in
 * ChatGPT's format (conversations with a `mapping` of nodes; user messages'
 * `content.parts` strings, `create_time` in seconds) or Claude.ai's
 * (conversations with `chat_messages`; `sender: "human"`, `text`,
 * `created_at`). The harness is the folder's name; a chat has no repo.
 */
const readExports = (since: number, out: Prompt[]) => {
  const seen = new Set<string>()
  for (const harness of sortedDir(EXPORTS_DIR)) {
    for (const path of walk(join(EXPORTS_DIR, harness), 'conversations.json')) {
      if (!path.endsWith('/conversations.json')) continue
      let data: any
      try {
        data = JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        continue
      }
      if (!Array.isArray(data)) continue
      const push = (id: string, at: number, session: string, text: string) => {
        const clean = text.trim()
        if (!clean || !(at >= since) || seen.has(`${harness}:${id}`)) return
        seen.add(`${harness}:${id}`)
        out.push({ at, harness, source: '', repo: `${harness} chat`, session, text: clean })
      }
      for (const c of data) {
        if (c?.mapping && typeof c.mapping === 'object') {
          const session = String(c.conversation_id ?? c.id ?? '')
          for (const key of Object.keys(c.mapping).sort()) {
            const m = c.mapping[key]?.message
            if (m?.author?.role !== 'user' || typeof m.create_time !== 'number') continue
            const parts = Array.isArray(m.content?.parts) ? m.content.parts.filter((x: unknown) => typeof x === 'string') : []
            push(String(m.id ?? key), m.create_time * 1000, session, parts.join('\n'))
          }
        } else if (Array.isArray(c?.chat_messages)) {
          const session = String(c.uuid ?? '')
          c.chat_messages.forEach((m: any, i: number) => {
            if (m?.sender !== 'human' || typeof m.text !== 'string') return
            push(String(m.uuid ?? `${session}:${i}`), Date.parse(m.created_at), session, m.text)
          })
        }
      }
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

/** A term a topic can hold is seen in at least this many prompts. */
const VOCAB_MIN_PROMPTS = 2
/** Two terms are linked only when they share at least this many prompts (once is a coincidence of one prompt). */
const MIN_SHARED = 2
/** Average-linkage merges stop below this mean Jaccard between two groups' terms. */
const MERGE_MIN = 0.03
/** A topic holds at most this many terms. */
const TOPIC_MAX = 25
/** A topic counts as present in a bucket from this share up (for first and last seen). */
const PRESENT = 0.01

/** A max-heap of candidate merges: highest average first, then the lowest pair of indices. */
type Cand = { avg: number; i: number; j: number; vi: number; vj: number }
const before = (a: Cand, b: Cand) => a.avg > b.avg || (a.avg === b.avg && (a.i < b.i || (a.i === b.i && a.j < b.j)))
const heapPush = (h: Cand[], c: Cand) => {
  h.push(c)
  for (let k = h.length - 1; k > 0; ) {
    const p = (k - 1) >> 1
    if (!before(h[k]!, h[p]!)) break
    ;[h[k], h[p]] = [h[p]!, h[k]!]
    k = p
  }
}
const heapPop = (h: Cand[]): Cand | undefined => {
  const top = h[0]
  const last = h.pop()
  if (!h.length || !last) return top
  h[0] = last
  for (let k = 0; ; ) {
    const l = 2 * k + 1
    const r = l + 1
    let m = k
    if (l < h.length && before(h[l]!, h[m]!)) m = l
    if (r < h.length && before(h[r]!, h[m]!)) m = r
    if (m === k) break
    ;[h[k], h[m]] = [h[m]!, h[k]!]
    k = m
  }
  return top
}

/**
 * Group terms whose prompts overlap, by average linkage on Jaccard. Candidate
 * pairs come only through shared prompts (a term's prompts, then those
 * prompts' terms), linked when they share MIN_SHARED prompts and reach
 * MERGE_MIN; pairs never linked count as 0 in a group's average. Then the
 * two groups with the highest average merge, ties to the lowest indices
 * (terms in a fixed order), until none reaches MERGE_MIN or every candidate
 * would exceed TOPIC_MAX.
 */
const cluster = (sets: Int32Array[], byPrompt: Int32Array[]): number[][] => {
  const n = sets.length
  // sum[a]: group a's summed pairwise Jaccard with each linked group.
  const sum: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  const co = new Int32Array(n)
  const touched: number[] = []
  for (let a = 0; a < n; a++) {
    for (const p of sets[a]!) for (const b of byPrompt[p]!) if (b > a && co[b]!++ === 0) touched.push(b)
    touched.sort((x, y) => x - y)
    for (const b of touched) {
      const c = co[b]!
      co[b] = 0
      if (c < MIN_SHARED) continue
      const j = c / (sets[a]!.length + sets[b]!.length - c)
      if (j < MERGE_MIN) continue
      sum[a]!.set(b, j)
      sum[b]!.set(a, j)
    }
    touched.length = 0
  }
  const members: (number[] | null)[] = Array.from({ length: n }, (_, i) => [i])
  const version = new Int32Array(n)
  const heap: Cand[] = []
  const offer = (x: number, y: number, s: number) => {
    const [i, j] = x < y ? [x, y] : [y, x]
    const size = members[i]!.length + members[j]!.length
    const avg = s / (members[i]!.length * members[j]!.length)
    if (size <= TOPIC_MAX && avg >= MERGE_MIN) heapPush(heap, { avg, i, j, vi: version[i]!, vj: version[j]! })
  }
  for (let a = 0; a < n; a++) for (const [b, s] of sum[a]!) if (b > a) offer(a, b, s)
  for (let c = heapPop(heap); c; c = heapPop(heap)) {
    const { i, j } = c
    if (!members[i] || !members[j] || version[i] !== c.vi || version[j] !== c.vj) continue
    // j folds into i: i's links become the sums of both groups' links.
    for (const [k, s] of sum[j]!) {
      if (k === i) continue
      const t = (sum[i]!.get(k) ?? 0) + s
      sum[i]!.set(k, t)
      sum[k]!.delete(j)
      sum[k]!.set(i, t)
    }
    sum[i]!.delete(j)
    sum[j] = new Map()
    members[i] = [...members[i]!, ...members[j]!]
    members[j] = null
    version[i]!++
    for (const k of [...sum[i]!.keys()].sort((x, y) => x - y)) offer(i, k, sum[i]!.get(k)!)
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
type TopicOut = {
  id: string
  name: string
  terms: string[]
  first: string | null
  peak: string | null
  last: string | null
  total: number
  /** Sessions with a prompt holding two of its terms; 1 is a topic noticed once. */
  sessions: number
  /** Those prompts per harness. */
  harnesses: Record<string, number>
  /** For a topic noticed once: its session's first prompt (200 characters at most). */
  firstPrompt?: string
}
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
  const row = (t: TopicOut, caption: boolean) => {
    const sw = `<i class="${color.get(t.id) ?? 'co'}"></i>`
    const terms = esc(t.terms.slice(0, 8).join(', '))
    const sub = caption && t.firstPrompt ? `<div class="cap">“${esc(t.firstPrompt)}”</div>` : ''
    return `<tr><td>${sw}${esc(t.name)}</td><td class="num">${t.total.toFixed(2)}</td><td class="num">${t.sessions}</td><td>${t.first ?? '–'}</td><td>${t.peak ?? '–'}</td><td>${t.last ?? '–'}</td><td class="terms">${terms}${sub}</td></tr>`
  }
  const head = '<thead><tr><th>Topic</th><th>Total</th><th>Sessions</th><th>First</th><th>Peak</th><th>Last</th><th>Terms</th></tr></thead>'
  const topicRows = f.topics.filter(t => t.sessions > 1).map(t => row(t, false)).join('')
  const onceTopics = f.topics.filter(t => t.sessions === 1)
  const onceRows = onceTopics.map(t => row(t, true)).join('')
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
.cap{color:var(--fg);font-style:italic;margin-top:2px}
</style></head><body><main>
<h1>Focus timeline</h1>
<div class="dim">${f.buckets.length} ${f.bucket === 'week' ? 'weeks' : 'days'}${f.since ? ` since ${f.since}` : ''} · ${f.buckets.reduce((s, b) => s + b.prompts, 0)} prompts · newest ${esc(f.generatedAt ?? '–')}</div>
<h2>Topic share per ${f.bucket}</h2>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked topic share over time">${grid}${paths.join('')}${ticks}</svg>
<div class="legend">${legend}</div>
<h2>Topics by total share</h2>
<div class="wrap"><table>${head}<tbody>${topicRows}</tbody></table></div>
<h2>Noticed once</h2>
<div class="dim">${onceTopics.length} topics that showed in a single session, with that session's first prompt.</div>
<div class="wrap"><table>${head}<tbody>${onceRows}</tbody></table></div>
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
  readExports(sinceMs, read)
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

  // Topics over every term seen in two prompts or more.
  const vocab = [...promptsOf.entries()]
    .filter(([, ps]) => ps.length >= VOCAB_MIN_PROMPTS)
    .map(([t]) => t)
    .sort(cmp)
  const termsByPrompt: number[][] = prompts.map(() => [])
  vocab.forEach((t, i) => {
    for (const p of promptsOf.get(t)!) termsByPrompt[p]!.push(i)
  })
  const groups = cluster(
    vocab.map(t => Int32Array.from(promptsOf.get(t)!)),
    termsByPrompt.map(ts => Int32Array.from(ts)),
  )
  const slug = (s: string) => s.replace(/[^\w~./:-]+/g, '-')
  const ids = new Set<string>()
  // A session's first prompt, the caption of a topic noticed only there.
  const firstPrompt = new Map<string, string>()
  for (const p of prompts) if (!firstPrompt.has(`${p.harness}:${p.session}`)) firstPrompt.set(`${p.harness}:${p.session}`, p.text)
  const topicsRaw = groups
    .filter(g => g.length >= 2)
    .map(g => {
      const terms = g.map(i => vocab[i]!).sort((a, b) => score.get(b)! - score.get(a)! || cmp(a, b))
      return { terms, members: g }
    })
    .sort((a, b) => cmp(a.terms[0]!, b.terms[0]!))
    .map(({ terms, members }) => {
      let id = slug(terms[0]!)
      for (let k = 2; ids.has(id); k++) id = `${slug(terms[0]!)}~${k}`
      ids.add(id)
      // Where the topic shows: prompts holding at least two of its terms.
      const hits = new Map<number, number>()
      for (const i of members) for (const p of promptsOf.get(vocab[i]!)!) hits.set(p, (hits.get(p) ?? 0) + 1)
      const where = [...hits.entries()].filter(([, c]) => c >= 2).map(([p]) => prompts[p]!)
      const sessionKeys = [...new Set(where.map(p => `${p.harness}:${p.session}`))].sort(cmp)
      const harnesses: Record<string, number> = {}
      for (const p of where) harnesses[p.harness] = (harnesses[p.harness] ?? 0) + 1
      const sorted = Object.fromEntries(Object.entries(harnesses).sort((x, y) => cmp(x[0], y[0])))
      const caption = sessionKeys.length === 1 ? firstPrompt.get(sessionKeys[0]!)!.replace(/\s+/g, ' ').slice(0, 200) : null
      return { id, name: terms[0]!, terms, sessions: sessionKeys.length, harnesses: sorted, caption }
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
      const out: TopicOut = { id: tp.id, name: tp.name, terms: tp.terms, first, peak, last, total: round(total), sessions: tp.sessions, harnesses: tp.harnesses }
      if (tp.caption !== null) out.firstPrompt = tp.caption
      return out
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
  const tally = (list: Prompt[], key: (p: Prompt) => string) => {
    const m = new Map<string, number>()
    for (const p of list) m.set(key(p), (m.get(key(p)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([k, v]) => `${v} ${k}`).join(', ')
  }
  const once = topics.filter(t => t.sessions === 1).length
  console.log(`${prompts.length} prompts (${tally(prompts, p => p.harness)}), ${nb} ${bucket}s, ${topics.length} topics (${once} noticed once)`)
  const codex = prompts.filter(p => p.harness === 'codex')
  if (codex.length) console.log(`codex by thread source: ${tally(codex, p => p.source)}`)
  for (const b of buckets) {
    const top = b.topics[0]
    const what = top ? `${names.get(top.id)} (${(top.share * 100).toFixed(0)}%)` : '-'
    console.log(`${b.start}  ${String(b.prompts).padStart(4)} prompts  ${what}  · ${b.terms.slice(0, 5).map(t => t.term).join(', ')}`)
  }
  console.log(`wrote ${join(OUT_DIR, 'focus.json')} and focus.html`)
}

main()
