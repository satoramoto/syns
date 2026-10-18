// What Ryan was focused on, over time, from his own prompts across harnesses.
//
//   bun analysis/focus.ts [--since YYYY-MM-DD] [--bucket day|week] [--seed]
//
// Reads the person's prompts (never the agent's replies) from Claude Code
// transcripts (`~/.claude/projects/*/<uuid>.jsonl`), Codex rollouts, live and
// archived (`~/.codex/sessions/**`, `~/.codex/archived_sessions/**`), and chat
// exports (`~/.syns/files/exports/<harness>/**/conversations.json`, in
// ChatGPT's or Claude.ai's export format), buckets them by local day
// or week (weeks start Monday), stems words (Snowball/Porter2), joins
// adjacent stems that go together (PMI) into phrases, weighs each bucket's
// concepts by TF-IDF (the bucket is the document, all buckets the corpus),
// links concepts by normalized PMI over prompts (the raw term view), groups
// co-occurring concepts into topics and topics into categories (seeded with
// `--seed`), and writes `~/.syns/files/focus/focus.json` and `focus.html` (the
// term view with search and term cards, a share chart, a topic cloud, the
// tables), plus a one-line-per-bucket summary on stdout.
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
  console.error('usage: bun analysis/focus.ts [--since YYYY-MM-DD] [--bucket day|week] [--seed]')
  console.error('  --seed  seed categories from ~/.syns/brain.json ids and ~/.syns/LEXICON.md terms (off by default)')
  console.error(`chat exports: put each conversations.json under ${EXPORTS_DIR}/<harness>/ (chatgpt, claude-ai, ...)`)
  process.exit(2)
}

const parseArgs = (argv: string[]): { since: string | null; bucket: BucketKind; seed: boolean } => {
  let since: string | null = null
  let bucket: BucketKind = 'week'
  let seed = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const v = argv[i + 1]
    if (a === '--since' && v && /^\d{4}-\d{2}-\d{2}$/.test(v)) (since = v), i++
    else if (a === '--bucket' && (v === 'day' || v === 'week')) (bucket = v), i++
    else if (a === '--seed') seed = true
    else usage()
  }
  return { since, bucket, seed }
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

// ---- Snowball (Porter2) English stemmer ----

const VOWEL = /[aeiouy]/
const isV = (c: string | undefined) => c !== undefined && VOWEL.test(c)
const STEM_EXCEPTIONS: Record<string, string> = {
  skis: 'ski', skies: 'sky', dying: 'die', lying: 'lie', tying: 'tie', idly: 'idl', gently: 'gentl', ugly: 'ugli', early: 'earli',
  only: 'onli', singly: 'singl', sky: 'sky', news: 'news', howe: 'howe', atlas: 'atlas', cosmos: 'cosmos', bias: 'bias', andes: 'andes',
}
const AFTER_1A = new Set(['inning', 'outing', 'canning', 'herring', 'earring', 'proceed', 'exceed', 'succeed'])
const DOUBLES = new Set(['bb', 'dd', 'ff', 'gg', 'mm', 'nn', 'pp', 'rr', 'tt'])
const LI_ENDING = new Set(['c', 'd', 'e', 'g', 'h', 'k', 'm', 'n', 'r', 't'])
const STEP2: [string, string][] = [
  ['ization', 'ize'], ['ational', 'ate'], ['fulness', 'ful'], ['ousness', 'ous'], ['iveness', 'ive'], ['tional', 'tion'], ['biliti', 'ble'],
  ['lessli', 'less'], ['entli', 'ent'], ['ation', 'ate'], ['alism', 'al'], ['aliti', 'al'], ['ousli', 'ous'], ['iviti', 'ive'], ['fulli', 'ful'],
  ['enci', 'ence'], ['anci', 'ance'], ['abli', 'able'], ['izer', 'ize'], ['ator', 'ate'], ['alli', 'al'], ['bli', 'ble'], ['ogi', 'og'], ['li', ''],
]
const STEP3: [string, string][] = [
  ['ational', 'ate'], ['tional', 'tion'], ['alize', 'al'], ['icate', 'ic'], ['iciti', 'ic'], ['ative', ''], ['ical', 'ic'], ['ness', ''], ['ful', ''],
]
const STEP4 = ['ement', 'ance', 'ence', 'able', 'ible', 'ment', 'ant', 'ent', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize', 'ion', 'al', 'er', 'ic']

/** Where R1 or R2 starts: after the first non-vowel that follows a vowel, from `from`. */
const region = (w: string, from: number): number => {
  for (let i = from + 1; i < w.length; i++) if (!isV(w[i]) && isV(w[i - 1])) return i + 1
  return w.length
}

/** A short syllable ends at `i` (inclusive). */
const shortSyllableAt = (w: string, i: number): boolean =>
  (i === 1 && isV(w[0]) && !isV(w[1])) ||
  (i >= 2 && !isV(w[i - 2]) && isV(w[i - 1]) && !isV(w[i]) && !'wxY'.includes(w[i]!))

const stem = (word: string): string => {
  if (word.length <= 2) return word
  if (STEM_EXCEPTIONS[word]) return STEM_EXCEPTIONS[word]!
  let w = word.replace(/^'/, '')
  w = w.replace(/^y/, 'Y').replace(/([aeiouy])y/g, '$1Y')
  const r1 = /^(gener|commun|arsen)/.test(w) ? (/^(gener|arsen)/.test(w) ? 5 : 6) : region(w, 0)
  // R1 and R2 are fixed positions; later steps only shorten the word (or add back an `e`).
  const R2 = region(w, r1)
  const r2 = () => R2
  // Step 0
  for (const s of ["'s'", "'s", "'"]) if (w.endsWith(s)) {
    w = w.slice(0, -s.length)
    break
  }
  // Step 1a
  if (w.endsWith('sses')) w = w.slice(0, -2)
  else if (w.endsWith('ied') || w.endsWith('ies')) w = w.length > 4 ? w.slice(0, -2) : w.slice(0, -1)
  else if (w.endsWith('us') || w.endsWith('ss')) {
    // unchanged
  } else if (w.endsWith('s') && /[aeiouy]/.test(w.slice(0, -2))) w = w.slice(0, -1)
  if (AFTER_1A.has(w)) return w
  // Step 1b
  const s1b = ['eedly', 'ingly', 'edly', 'eed', 'ing', 'ed'].find(s => w.endsWith(s))
  if (s1b === 'eed' || s1b === 'eedly') {
    if (w.length - s1b.length >= r1) w = `${w.slice(0, -s1b.length)}ee`
  } else if (s1b) {
    const stemPart = w.slice(0, -s1b.length)
    if (/[aeiouy]/.test(stemPart)) {
      w = stemPart
      if (/(at|bl|iz)$/.test(w)) w += 'e'
      else if (DOUBLES.has(w.slice(-2))) w = w.slice(0, -1)
      else if (r1 >= w.length && shortSyllableAt(w, w.length - 1)) w += 'e'
    }
  }
  // Step 1c
  if (/[yY]$/.test(w) && w.length > 2 && !isV(w[w.length - 2])) w = `${w.slice(0, -1)}i`
  // Step 2
  const s2 = STEP2.find(([s]) => w.endsWith(s))
  if (s2 && w.length - s2[0].length >= r1) {
    const [s, r] = s2
    const before = w[w.length - s.length - 1]
    if (s === 'ogi') {
      if (before === 'l') w = w.slice(0, -s.length) + r
    } else if (s === 'li') {
      if (before && LI_ENDING.has(before)) w = w.slice(0, -2)
    } else w = w.slice(0, -s.length) + r
  }
  // Step 3
  const s3 = STEP3.find(([s]) => w.endsWith(s))
  if (s3 && w.length - s3[0].length >= r1) {
    const [s, r] = s3
    if (s === 'ative') {
      if (w.length - s.length >= r2()) w = w.slice(0, -s.length)
    } else w = w.slice(0, -s.length) + r
  }
  // Step 4
  const s4 = STEP4.find(s => w.endsWith(s))
  if (s4 && w.length - s4.length >= r2()) {
    if (s4 !== 'ion') w = w.slice(0, -s4.length)
    else if (/[st]$/.test(w.slice(0, -3))) w = w.slice(0, -3)
  }
  // Step 5
  if (w.endsWith('e')) {
    const at = w.length - 1
    if (at >= r2() || (at >= r1 && !shortSyllableAt(w, at - 1))) w = w.slice(0, -1)
  } else if (w.endsWith('ll') && w.length - 1 >= r2()) w = w.slice(0, -1)
  return w.replace(/Y/g, 'y')
}

/** One kept word: its stem (the key it's counted under) and its surface form (what's shown). */
type Word = { stem: string; surface: string }
/** A prompt cut into runs of adjacent kept words (a dropped word or punctuation ends a run), plus its paths, repos and slash commands. */
type Tokens = { runs: Word[][]; specials: string[] }

/** A prompt's tokens: words lowercased and stemmed, and file paths, repo names and slash commands kept whole. */
const tokenize = (text: string, repos: Set<string>): Tokens => {
  const specials = new Set<string>()
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
      specials.add(p)
      return ' . '
    }
    return m.replace(/\//g, ' ')
  })
  t = t.replace(SLASH, (_m: string, pre: string, cmd: string) => {
    specials.add(cmd.toLowerCase())
    return `${pre} . `
  })
  // A run ends at a dropped word or at punctuation between clauses (the `.` left where a path or command was).
  const runs: Word[][] = []
  let run: Word[] = []
  const end = () => {
    if (run.length) runs.push(run)
    run = []
  }
  for (const clause of t.toLowerCase().split(/[.,;:!?()[\]{}"`|\n]+/)) {
    for (const w of clause.split(/[^\w-]+/)) {
      if (!w) continue
      // A hyphenated word is one token ("multi-band" → "multiband"); a repo name keeps its hyphen.
      const whole = repos.has(w)
      for (const x of [whole ? w : w.replace(/-+/g, '')]) {
        // Ids, hashes and timestamp shards (`26t17`, `4a02`, `01m`) have as many digits as letters.
        const digits = x.replace(/\D/g, '').length
        const ok = x.length >= 3 && digits * 2 < x.length && !STOPWORDS.has(x) && !/^_|_$/.test(x)
        if (ok) run.push({ stem: whole ? x : stem(x), surface: x })
        else end()
      }
    }
    end()
  }
  return { runs, specials: [...specials].sort(cmp) }
}

/** Phrases: adjacent stems that go together more than chance (normalized PMI over prompts) become one concept. */
const PHRASE_MIN_PROMPTS = 3
const PHRASE_NPMI = 0.35

/**
 * Each prompt's concepts, keyed by stems (`multiband compress`), with every
 * key's surface forms counted. A pair of adjacent stems seen in at least
 * PHRASE_MIN_PROMPTS prompts whose normalized PMI reaches PHRASE_NPMI is a
 * phrase; a passing pair plus its neighbour is a trigram when that triple
 * passes the same test against the pair. Runs are read left to right,
 * longest phrase first, and a phrase replaces its words in that prompt.
 */
const concepts = (all: Tokens[]): { perPrompt: Set<string>[]; surfaces: Map<string, Map<string, number>> } => {
  const n = all.length
  const df = new Map<string, number>()
  const bump = (keys: Set<string>) => {
    for (const k of keys) df.set(k, (df.get(k) ?? 0) + 1)
  }
  for (const tk of all) {
    const keys = new Set<string>()
    for (const r of tk.runs)
      for (let i = 0; i < r.length; i++) {
        keys.add(r[i]!.stem)
        if (i + 1 < r.length) keys.add(`${r[i]!.stem} ${r[i + 1]!.stem}`)
        if (i + 2 < r.length) keys.add(`${r[i]!.stem} ${r[i + 1]!.stem} ${r[i + 2]!.stem}`)
      }
    bump(keys)
  }
  const npmi = (x: string, y: string, xy: string): number => {
    const cxy = df.get(xy) ?? 0
    if (cxy < PHRASE_MIN_PROMPTS) return -1
    const pxy = cxy / n
    if (pxy >= 1) return 1
    return Math.log(pxy / (((df.get(x) ?? 0) / n) * ((df.get(y) ?? 0) / n))) / -Math.log(pxy)
  }
  const pair = new Map<string, boolean>()
  const pairOk = (a: string, b: string) => {
    const k = `${a} ${b}`
    let v = pair.get(k)
    if (v === undefined) pair.set(k, (v = a !== b && npmi(a, b, k) >= PHRASE_NPMI))
    return v
  }
  const triOk = (a: string, b: string, c: string) => {
    const k = `${a} ${b} ${c}`
    return (pairOk(a, b) && npmi(`${a} ${b}`, c, k) >= PHRASE_NPMI) || (pairOk(b, c) && npmi(a, `${b} ${c}`, k) >= PHRASE_NPMI)
  }
  const surfaces = new Map<string, Map<string, number>>()
  const see = (key: string, surface: string) => {
    const m = surfaces.get(key) ?? new Map<string, number>()
    m.set(surface, (m.get(surface) ?? 0) + 1)
    surfaces.set(key, m)
  }
  const perPrompt = all.map(tk => {
    const out = new Set<string>()
    for (const s of tk.specials) {
      out.add(s)
      see(s, s)
    }
    for (const r of tk.runs) {
      for (let i = 0; i < r.length; ) {
        const len = i + 2 < r.length && triOk(r[i]!.stem, r[i + 1]!.stem, r[i + 2]!.stem) ? 3 : i + 1 < r.length && pairOk(r[i]!.stem, r[i + 1]!.stem) ? 2 : 1
        const ws = r.slice(i, i + len)
        const key = ws.map(w => w.stem).join(' ')
        out.add(key)
        see(key, ws.map(w => w.surface).join(' '))
        i += len
      }
    }
    return out
  })
  return { perPrompt, surfaces }
}

// ---- weighting and topics ----

const round = (x: number, d = 4) => {
  const f = 10 ** d
  return Math.round(x * f) / f
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** A term a topic can hold is seen in at least this many prompts. */
const VOCAB_MIN_PROMPTS = 2
/** Two terms are linked only when they share at least this many prompts (once is a coincidence of one prompt)... */
const MIN_SHARED = 2
/** ...and average-linkage merges stop below this mean Jaccard between two groups' terms. */
const MERGE_MIN = 0.03
/** A topic holds at most this many terms. */
const TOPIC_MAX = 25
/** Categories: the same merge run again from the topics (each topic one group), looser and with room for more terms. */
const CATEGORY_MERGE_MIN = 0.01
const CATEGORY_MAX = 250
/** Term links are kept from the looser of the two thresholds. */
const LINK_MIN = Math.min(MERGE_MIN, CATEGORY_MERGE_MIN)
type Merge = { mergeMin: number; maxSize: number }
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
 * Each term's Jaccard (over the prompts holding it) with the terms it shares
 * prompts with. Candidates come only through shared prompts (a term's
 * prompts, then those prompts' terms), so no all-pairs pass; pairs never
 * linked count as 0 in a group's average.
 */
/** Each term's Jaccard with every term it shares at least `minShared` prompts with, from `linkMin` up. */
const links = (sets: Int32Array[], byPrompt: Int32Array[], minShared: number, linkMin: number): Map<number, number>[] => {
  const n = sets.length
  const out: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  const co = new Int32Array(n)
  const touched: number[] = []
  for (let a = 0; a < n; a++) {
    for (const p of sets[a]!) for (const b of byPrompt[p]!) if (b > a && co[b]!++ === 0) touched.push(b)
    touched.sort((x, y) => x - y)
    for (const b of touched) {
      const c = co[b]!
      co[b] = 0
      if (c < minShared) continue
      const j = c / (sets[a]!.length + sets[b]!.length - c)
      if (j < linkMin) continue
      out[a]!.set(b, j)
      out[b]!.set(a, j)
    }
    touched.length = 0
  }
  return out
}

/**
 * Average-linkage merge of `groups` (lists of term indices) over term links:
 * a pair of groups' average is their summed links over the product of their
 * sizes. Repeatedly merge the pair with the highest average (ties to the
 * lower group indices) until none reaches `mergeMin` or every candidate would
 * hold more than `maxSize` terms. Groups come back in their merged order.
 */
const cluster = (link: Map<number, number>[], groups: number[][], opt: Merge): number[][] => {
  const MERGE_MIN = opt.mergeMin
  const TOPIC_MAX = opt.maxSize
  const n = groups.length
  const groupOf = new Map<number, number>()
  groups.forEach((g, gi) => {
    for (const t of g) groupOf.set(t, gi)
  })
  // sum[a]: group a's summed pairwise Jaccard with each linked group.
  const sum: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  for (let a = 0; a < link.length; a++) {
    const ga = groupOf.get(a)
    if (ga === undefined) continue
    for (const [b, j] of link[a]!) {
      const gb = groupOf.get(b)
      if (b <= a || gb === undefined || gb === ga) continue
      sum[ga]!.set(gb, (sum[ga]!.get(gb) ?? 0) + j)
      sum[gb]!.set(ga, (sum[gb]!.get(ga) ?? 0) + j)
    }
  }
  const members: (number[] | null)[] = groups.map(g => [...g])
  const version = new Int32Array(n)
  const heap: Cand[] = []
  const offer = (x: number, y: number, s: number) => {
    const [i, j] = x < y ? [x, y] : [y, x]
    const size = members[i]!.length + members[j]!.length
    const avg = s / (members[i]!.length * members[j]!.length)
    if (size <= TOPIC_MAX && avg >= MERGE_MIN) heapPush(heap, { avg, i, j, vi: version[i]!, vj: version[j]! })
  }
  for (let a = 0; a < n; a++) for (const b of [...sum[a]!.keys()].sort((x, y) => x - y)) if (b > a) offer(a, b, sum[a]!.get(b)!)
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
  /** The category it was merged into (`categories[].id`). */
  category: string
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
/** `seed`: the brain id or lexicon term the category was seeded from; null for one the merge discovered. */
type CategoryOut = { id: string; name: string; seed: string | null; topics: string[]; total: number }

/**
 * Category seeds, read at run time from `~/.syns/brain.json` (`pods`, then
 * `shelf`, then `done` ids) and `~/.syns/LEXICON.md` (each `**Term:**`, the
 * part before any parenthesis), in that order, first spelling of a name kept.
 * Each is stemmed like a prompt: `parts` are its words' stems, `joined` its
 * hyphen-joined stem, `phrase` its stems as a phrase key.
 */
type Seed = { name: string; parts: string[]; joined: string; phrase: string }
/** A seed matches against a topic's leading terms only (its highest-weight ones). */
const SEED_TERMS = 8

const readSeeds = (): Seed[] => {
  const names: string[] = []
  try {
    const brain = JSON.parse(readFileSync(join(HOME, '.syns', 'brain.json'), 'utf8'))
    for (const list of [brain?.pods, brain?.shelf, brain?.done])
      if (Array.isArray(list)) for (const x of list) if (typeof x?.id === 'string' && x.id.trim()) names.push(x.id.trim())
  } catch {
    // No brain: no pod seeds.
  }
  try {
    const lex = readFileSync(join(HOME, '.syns', 'LEXICON.md'), 'utf8')
    for (const m of lex.matchAll(/\*\*([^*\n]+?):\*\*/g)) names.push(m[1]!.replace(/\s*\(.*$/, '').trim())
  } catch {
    // No lexicon: no term seeds.
  }
  const seen = new Set<string>()
  const out: Seed[] = []
  for (const name of names) {
    const lower = name.toLowerCase()
    if (!lower || seen.has(lower)) continue
    seen.add(lower)
    // Stopwords stay in `parts`: a name like "the-source" then matches only as a whole, never by its one content word.
    const words = lower.split(/[^a-z0-9]+/).filter(w => w.length >= 3)
    if (!words.some(w => !STOPWORDS.has(w))) continue
    const parts = words.map(stem)
    const joinedWord = lower.replace(/[^a-z0-9]+/g, '')
    out.push({ name, parts, joined: stem(joinedWord), phrase: parts.join(' ') })
  }
  return out
}

/**
 * How well a topic (its concept keys, and the words in them) matches a seed:
 * the seed's whole name as a concept (joined or as a phrase) scores its part
 * count plus one; otherwise every part present scores the part count; less
 * than every part scores 0, so one generic word of a long name doesn't claim
 * a topic.
 */
const seedScore = (s: Seed, keys: Set<string>, words: Set<string>): number => {
  if (keys.has(s.joined) || keys.has(s.phrase)) return s.parts.length + 1
  return s.parts.every(p => words.has(p)) ? s.parts.length : 0
}
type Focus = {
  generatedAt: string | null
  since: string | null
  bucket: BucketKind
  /** The least prompts a concept needs to be in `terms`. */
  termMin: number
  buckets: BucketOut[]
  terms: TermOut[]
  edges: EdgeOut[]
  categories: CategoryOut[]
  topics: TopicOut[]
}

// ---- the raw term view ----

/** A concept is a term in the view from this many prompts (raised until focus.json fits FOCUS_MAX_BYTES). */
const TERM_MIN = 3
const FOCUS_MAX_BYTES = 5_000_000
/** Two terms are neighbours from this many shared prompts; each keeps its closest NEIGHBOURS. */
const NEIGHBOUR_SHARED = 2
const NEIGHBOURS = 30
/** An edge is drawn (and listed in `edges`) from this NPMI and shared-prompt count, and only among each end's EDGE_TOP closest. */
const EDGE_NPMI = 0.3
const EDGE_SHARED = 3
const EDGE_TOP = 3
const TERM_W = 1200
const TERM_H = 900
const TERM_ITERATIONS = 200
/** Card details: closest terms shown, latest prompts shown and how much of each. */
const CARD_NEIGHBOURS = 15
const CARD_PROMPTS = 5
const CARD_CHARS = 160

type Neighbour = { term: string; npmi: number; jaccard: number; shared: number }
type TermOut = { term: string; surface: string; count: number; perBucket: number[]; harnesses: Record<string, number>; neighbours: Neighbour[] }
type EdgeOut = { a: string; b: string; npmi: number; jaccard: number; shared: number }
type TermView = { terms: TermOut[]; edges: EdgeOut[]; draw: CloudEdge[]; recent: number[][] }

/**
 * Every concept in at least `min` prompts (largest first, then by key), its
 * prompts per bucket and per harness, its closest terms by normalized PMI
 * over prompts (sharing at least NEIGHBOUR_SHARED; ties to more shared, then
 * the key), the edges drawn, and its latest prompts.
 */
const termView = (
  prompts: Prompt[],
  promptsOf: Map<string, number[]>,
  bucketIndex: number[],
  nb: number,
  show: (k: string) => string,
  min: number,
): TermView => {
  const keys = [...promptsOf.entries()]
    .filter(([, ps]) => ps.length >= min)
    .sort((a, b) => b[1].length - a[1].length || cmp(a[0], b[0]))
    .map(([k]) => k)
  const n = keys.length
  const N = prompts.length
  const sets = keys.map(k => promptsOf.get(k)!)
  const byPrompt: number[][] = prompts.map(() => [])
  sets.forEach((ps, i) => {
    for (const p of ps) byPrompt[p]!.push(i)
  })
  const near: { b: number; npmi: number; jaccard: number; shared: number }[][] = keys.map(() => [])
  const co = new Int32Array(n)
  const touched: number[] = []
  for (let a = 0; a < n; a++) {
    for (const p of sets[a]!) for (const b of byPrompt[p]!) if (b > a && co[b]!++ === 0) touched.push(b)
    touched.sort((x, y) => x - y)
    for (const b of touched) {
      const s = co[b]!
      co[b] = 0
      if (s < NEIGHBOUR_SHARED) continue
      const ca = sets[a]!.length
      const cb = sets[b]!.length
      const pab = s / N
      const npmi = pab >= 1 ? 1 : Math.log((s * N) / (ca * cb)) / -Math.log(pab)
      const jaccard = s / (ca + cb - s)
      near[a]!.push({ b, npmi: round(npmi), jaccard: round(jaccard), shared: s })
      near[b]!.push({ b: a, npmi: round(npmi), jaccard: round(jaccard), shared: s })
    }
    touched.length = 0
  }
  for (const list of near) list.sort((x, y) => y.npmi - x.npmi || y.shared - x.shared || cmp(keys[x.b]!, keys[y.b]!))
  const top = near.map(list => new Set(list.filter(x => x.shared >= EDGE_SHARED && x.npmi >= EDGE_NPMI).slice(0, EDGE_TOP).map(x => x.b)))
  const edges: EdgeOut[] = []
  const draw: CloudEdge[] = []
  for (let a = 0; a < n; a++)
    for (const x of near[a]!)
      if (x.b > a && x.shared >= EDGE_SHARED && x.npmi >= EDGE_NPMI && (top[a]!.has(x.b) || top[x.b]!.has(a))) {
        edges.push({ a: keys[a]!, b: keys[x.b]!, npmi: x.npmi, jaccard: x.jaccard, shared: x.shared })
        draw.push({ a, b: x.b, w: x.npmi })
      }
  edges.sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b))
  draw.sort((x, y) => x.a - y.a || x.b - y.b)
  const terms: TermOut[] = keys.map((k, i) => {
    const perBucket = new Array<number>(nb).fill(0)
    const h: Record<string, number> = {}
    for (const p of sets[i]!) {
      perBucket[bucketIndex[p]!]!++
      h[prompts[p]!.harness] = (h[prompts[p]!.harness] ?? 0) + 1
    }
    const harnesses = Object.fromEntries(Object.entries(h).sort((x, y) => cmp(x[0], y[0])))
    const neighbours = near[i]!.slice(0, NEIGHBOURS).map(x => ({ term: keys[x.b]!, npmi: x.npmi, jaccard: x.jaccard, shared: x.shared }))
    return { term: k, surface: show(k), count: sets[i]!.length, perBucket, harnesses, neighbours }
  })
  const recent = sets.map(ps => ps.slice(-CARD_PROMPTS).reverse())
  return { terms, edges, draw, recent }
}

/** The term view's page section: an SVG drawn from inline data, a search box and a card for the clicked term. */
const termSection = (f: Focus, tv: TermView & { pos: [number, number][] }, prompts: Prompt[]): string => {
  const idx = new Map(tv.terms.map((t, i) => [t.term, i]))
  const used = [...new Set(tv.recent.flat())].sort((a, b) => a - b)
  const pAt = new Map(used.map((p, i) => [p, i]))
  const data = {
    weeks: f.buckets.map(b => b.start),
    nodes: tv.terms.map((t, i) => [t.surface, t.count, tv.pos[i]![0], tv.pos[i]![1]]),
    per: tv.terms.map(t => t.perBucket),
    harness: tv.terms.map(t => t.harnesses),
    near: tv.terms.map(t => t.neighbours.slice(0, CARD_NEIGHBOURS).map(x => [idx.get(x.term)!, x.npmi, x.shared])),
    recent: tv.recent.map(ps => ps.map(p => pAt.get(p)!)),
    prompts: used.map(p => [ymd(new Date(prompts[p]!.at)), prompts[p]!.harness, prompts[p]!.text.replace(/\s+/g, ' ').slice(0, CARD_CHARS)]),
    edges: tv.draw.map(e => [e.a, e.b, e.w]),
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<h2>Terms</h2>
<div class="dim">${tv.terms.length} concepts (stemmed words and phrases in at least ${f.termMin} prompts), sized by prompt count; a line joins two that go together (normalized PMI ≥ ${EDGE_NPMI} over ≥ ${EDGE_SHARED} shared prompts, each term's ${EDGE_TOP} closest). Click a term for its card.</div>
<div class="tools"><input id="q" type="search" placeholder="Search terms" aria-label="Search terms"><span id="qn" class="dim"></span></div>
<div class="termwrap"><svg id="terms" viewBox="0 0 ${TERM_W} ${TERM_H}" role="img" aria-label="Term relationship view"></svg>
<div id="card" class="card dim">Click a term.</div></div>
<script id="termdata" type="application/json">${json}</script>`
}

/** The page's script for the term view, the shared week slider and the topic cloud. */
const pageScript = (bucket: BucketKind): string => `<script>
(() => {
  const D = JSON.parse(document.getElementById('termdata').textContent)
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.getElementById('terms')
  const el = (name, attrs, parent) => {
    const e = document.createElementNS(NS, name)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    parent.appendChild(e)
    return e
  }
  const max = Math.max(1, ...D.nodes.map(n => n[1]))
  const r = c => 1.5 + 11 * Math.sqrt(c / max)
  const ge = el('g', { class: 'edges' }, svg)
  const lines = D.edges.map(([a, b, w]) => el('line', { x1: D.nodes[a][2], y1: D.nodes[a][3], x2: D.nodes[b][2], y2: D.nodes[b][3], 'stroke-width': (0.3 + 2 * w).toFixed(2) }, ge))
  const gn = el('g', {}, svg)
  const dots = D.nodes.map(([s, c, x, y], i) => {
    const d = el('circle', { cx: x, cy: y, r: r(c).toFixed(1), 'data-i': i }, gn)
    el('title', {}, d).textContent = s + ' (' + c + ')'
    return d
  })
  const gl = el('g', { class: 'labels' }, svg)
  const labels = D.nodes.slice(0, 60).map(([s, c, x, y]) => {
    const t = el('text', { x, y: (y - r(c) - 2).toFixed(1), 'text-anchor': 'middle' }, gl)
    t.textContent = s
    return t
  })
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const card = document.getElementById('card')
  let picked = -1
  const show = i => {
    picked = i
    dots.forEach((d, j) => d.classList.toggle('pick', j === i))
    const [s, c] = D.nodes[i]
    const per = D.per[i]
    const pm = Math.max(1, ...per)
    const w = 220, h = 36
    const pts = per.map((v, k) => (per.length < 2 ? w / 2 : (k * w) / (per.length - 1)).toFixed(1) + ',' + (h - 2 - (v / pm) * (h - 4)).toFixed(1)).join(' ')
    const harn = Object.entries(D.harness[i]).map(([k, v]) => esc(k) + ' ' + v).join(' · ')
    const near = D.near[i].map(([j, npmi, shared]) => '<tr><td><a href="#" data-i="' + j + '">' + esc(D.nodes[j][0]) + '</a></td><td class="bar"><span style="width:' + Math.max(0, npmi * 100).toFixed(0) + '%"></span></td><td class="num">' + npmi.toFixed(2) + '</td><td class="num">' + shared + '</td></tr>').join('')
    const recent = D.recent[i].map(p => { const [d, hn, t] = D.prompts[p]; return '<li><span class="dim">' + d + ' · ' + esc(hn) + '</span> ' + esc(t) + '</li>' }).join('')
    card.classList.remove('dim')
    card.innerHTML = '<h3>' + esc(s) + '</h3><div class="dim">' + c + ' prompts · ' + harn + '</div>' +
      '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts + '"/></svg><div class="dim">prompts per ${bucket}, ' + esc(D.weeks[0] || '') + ' to ' + esc(D.weeks[D.weeks.length - 1] || '') + '</div>' +
      '<h4>Closest</h4><table><thead><tr><th>Term</th><th>NPMI</th><th></th><th>Shared</th></tr></thead><tbody>' + near + '</tbody></table>' +
      '<h4>Latest prompts</h4><ul>' + recent + '</ul>'
  }
  svg.addEventListener('click', e => { const i = e.target.getAttribute && e.target.getAttribute('data-i'); if (i !== null && i !== undefined) show(+i) })
  card.addEventListener('click', e => { const i = e.target.getAttribute('data-i'); if (i !== null) { e.preventDefault(); show(+i) } })
  const q = document.getElementById('q')
  const qn = document.getElementById('qn')
  const input = document.getElementById('wk')
  const label = document.getElementById('wkl')
  const nodes = [...document.querySelectorAll('#cloud .node')]
  const shares = nodes.map(n => n.dataset.s.split(',').map(Number))
  const cloudLines = [...document.querySelectorAll('#cloud .edges line')]
  const update = () => {
    const w = Number(input.value)
    const all = w >= D.weeks.length
    label.textContent = all ? 'all ${bucket}s' : '${bucket} of ' + D.weeks[w]
    const on = shares.map(s => all || s[w] >= ${PRESENT})
    nodes.forEach((n, i) => n.classList.toggle('off', !on[i]))
    cloudLines.forEach(l => l.classList.toggle('off', !(on[+l.dataset.a] && on[+l.dataset.b])))
    const needle = q.value.trim().toLowerCase()
    let hits = 0
    const vis = D.nodes.map(([s], i) => {
      const inWeek = all || D.per[i][w] > 0
      const match = !needle || s.toLowerCase().includes(needle)
      if (needle && match) hits++
      dots[i].classList.toggle('off', !inWeek || !match)
      dots[i].classList.toggle('hit', !!needle && match)
      return inWeek && match
    })
    labels.forEach((t, i) => t.classList.toggle('off', !vis[i]))
    lines.forEach((l, k) => { const [a, b] = D.edges[k]; l.classList.toggle('off', !(vis[a] && vis[b])) })
    qn.textContent = needle ? hits + ' match' + (hits === 1 ? '' : 'es') : ''
  }
  input.addEventListener('input', update)
  q.addEventListener('input', update)
  update()
})()
</script>`

/** The relationship cloud's topics drawn (the largest by total) and the least overlap drawn as an edge (Jaccard of their prompts). */
const CLOUD_NODES = 120
const CLOUD_EDGE_MIN = 0.08
type CloudEdge = { a: number; b: number; w: number }
type Cloud = { nodes: string[]; edges: CloudEdge[]; pos: [number, number][] }
const CLOUD_W = 960
const CLOUD_H = 640
const LAYOUT_ITERATIONS = 400
/** Above this many nodes the layout approximates far repulsion (Barnes–Hut, opening angle BH_THETA), so it stays fast. */
const GRID_FROM = 400
const BH_THETA = 0.8

type Quad = { x0: number; y0: number; size: number; mass: number; mx: number; my: number; bodies: number[]; kids: (Quad | null)[] | null; depth: number }

const quad = (x: Float64Array, y: Float64Array, n: number, W: number, H: number): Quad => {
  const make = (x0: number, y0: number, size: number, depth: number): Quad => ({ x0, y0, size, mass: 0, mx: 0, my: 0, bodies: [], kids: null, depth })
  const root = make(0, 0, Math.max(W, H), 0)
  const insert = (q: Quad, i: number) => {
    q.mx = (q.mx * q.mass + x[i]!) / (q.mass + 1)
    q.my = (q.my * q.mass + y[i]!) / (q.mass + 1)
    q.mass++
    if (!q.kids) {
      q.bodies.push(i)
      if (q.bodies.length === 1 || q.depth >= 24) return
      q.kids = [null, null, null, null]
      const held = q.bodies
      q.bodies = []
      for (const j of held) place(q, j)
      return
    }
    place(q, i)
  }
  const place = (q: Quad, i: number) => {
    const h = q.size / 2
    const right = x[i]! >= q.x0 + h ? 1 : 0
    const down = y[i]! >= q.y0 + h ? 1 : 0
    const at = down * 2 + right
    const kid = (q.kids![at] ??= make(q.x0 + right * h, q.y0 + down * h, h, q.depth + 1))
    insert(kid, i)
  }
  for (let i = 0; i < n; i++) insert(root, i)
  return root
}

/** The repulsion on body i at (px, py) from the tree: k²/d per unit of mass, far cells as their centre of mass. */
const farForce = (q: Quad, i: number, x: Float64Array, y: Float64Array, kk: number): [number, number] => {
  const px = x[i]!
  const py = y[i]!
  let fx = 0
  let fy = 0
  const stack: Quad[] = [q]
  while (stack.length) {
    const c = stack.pop()!
    if (!c.mass) continue
    if (!c.kids) {
      for (const j of c.bodies) {
        if (j === i) continue
        const ex = px - x[j]!
        const ey = py - y[j]!
        const d = Math.max(0.01, Math.hypot(ex, ey))
        fx += (ex / d) * (kk / d)
        fy += (ey / d) * (kk / d)
      }
      continue
    }
    const ex = px - c.mx
    const ey = py - c.my
    const d = Math.hypot(ex, ey)
    if (d > 0 && c.size / d < BH_THETA) {
      fx += (ex / d) * ((kk * c.mass) / d)
      fy += (ey / d) * ((kk * c.mass) / d)
      continue
    }
    for (let k = 3; k >= 0; k--) if (c.kids[k]) stack.push(c.kids[k]!)
  }
  return [fx, fy]
}

/**
 * A deterministic force layout (Fruchterman–Reingold): nodes start on a
 * golden-angle spiral in their fixed order (no random seed needed), repel
 * each other, pull along edges by weight and gently toward the middle, and
 * cool linearly over a fixed number of iterations.
 */
const layout = (n: number, edges: CloudEdge[], W = CLOUD_W, H = CLOUD_H, iterations = LAYOUT_ITERATIONS): [number, number][] => {
  const CLOUD_W = W
  const CLOUD_H = H
  const cx = CLOUD_W / 2
  const cy = CLOUD_H / 2
  // A big graph is mostly loose terms: a shorter spring and firmer gravity keep them off the border.
  const big = n > GRID_FROM
  const k = Math.sqrt((CLOUD_W * CLOUD_H) / Math.max(1, n)) * (big ? 0.45 : 0.75)
  // Gravity g·k·d balances the whole graph's repulsion k²·n/d at d = √(k·n/g): about 380 for 2,200 terms.
  const g = big ? 0.15 : 0.012
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const r = (Math.min(W, H) / 2 - 30) * Math.sqrt((i + 1) / n)
    const t = i * 2.399963229728653
    x[i] = cx + r * Math.cos(t)
    y[i] = cy + r * Math.sin(t)
  }
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  for (let it = 0; it < iterations; it++) {
    const temp = 40 * (1 - it / iterations) + 0.5
    dx.fill(0)
    dy.fill(0)
    const repel = (i: number, j: number) => {
      const ex = x[i]! - x[j]!
      const ey = y[i]! - y[j]!
      const d = Math.max(0.01, Math.hypot(ex, ey))
      const f = (k * k) / d
      dx[i]! += (ex / d) * f
      dy[i]! += (ey / d) * f
      dx[j]! -= (ex / d) * f
      dy[j]! -= (ey / d) * f
    }
    if (n <= GRID_FROM) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) repel(i, j)
    } else {
      // Many nodes: Barnes–Hut, a quadtree built in node order whose far cells repel as one mass.
      const root = quad(x, y, n, W, H)
      for (let i = 0; i < n; i++) {
        const [fx, fy] = farForce(root, i, x, y, k * k)
        dx[i]! += fx
        dy[i]! += fy
      }
    }
    for (const e of edges) {
      const ex = x[e.a]! - x[e.b]!
      const ey = y[e.a]! - y[e.b]!
      const d = Math.max(0.01, Math.hypot(ex, ey))
      const f = ((d * d) / k) * Math.min(1, e.w * 5)
      dx[e.a]! -= (ex / d) * f
      dy[e.a]! -= (ey / d) * f
      dx[e.b]! += (ex / d) * f
      dy[e.b]! += (ey / d) * f
    }
    for (let i = 0; i < n; i++) {
      dx[i]! += (cx - x[i]!) * g * k
      dy[i]! += (cy - y[i]!) * g * k
      const d = Math.max(0.01, Math.hypot(dx[i]!, dy[i]!))
      const step = Math.min(d, temp)
      x[i] = Math.min(CLOUD_W - 30, Math.max(30, x[i]! + (dx[i]! / d) * step))
      y[i] = Math.min(CLOUD_H - 20, Math.max(20, y[i]! + (dy[i]! / d) * step))
    }
  }
  return Array.from({ length: n }, (_, i) => [round(x[i]!, 1), round(y[i]!, 1)] as [number, number])
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Topics drawn in the chart: every bucket's leader, then the largest totals. */
const CHART_TOPICS = 10

const html = (f: Focus, cloud: Cloud, tv: TermView & { pos: [number, number][] }, prompts: Prompt[]): string => {
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

  // The relationship cloud: topics sized by total, coloured by category, edges by shared prompts.
  const byTopic = new Map(f.topics.map(t => [t.id, t]))
  // Categories have their own palette (k0–k9), so a colour never means a topic in the chart and a category here.
  const catColor = new Map(f.categories.slice(0, CHART_TOPICS).map((c, k) => [c.id, `k${k}`]))
  const maxTotal = Math.max(1e-9, ...cloud.nodes.map(id => byTopic.get(id)!.total))
  const radius = (id: string) => 3 + 15 * Math.sqrt(byTopic.get(id)!.total / maxTotal)
  const lines = cloud.edges
    .map(e => {
      const [x1, y1] = cloud.pos[e.a]!
      const [x2, y2] = cloud.pos[e.b]!
      return `<line data-a="${e.a}" data-b="${e.b}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${(0.5 + 6 * e.w).toFixed(2)}"/>`
    })
    .join('')
  const dots = cloud.nodes
    .map((id, i) => {
      const t = byTopic.get(id)!
      const [x, y] = cloud.pos[i]!
      const s = f.buckets.map(b => b.topics.find(x => x.id === id)?.share ?? 0).join(',')
      const label = i < 30 ? `<text x="${x}" y="${(y - radius(id) - 3).toFixed(1)}" text-anchor="middle">${esc(t.name)}</text>` : ''
      return `<g class="node" data-s="${s}"><circle class="${catColor.get(t.category) ?? 'co'}" cx="${x}" cy="${y}" r="${radius(id).toFixed(1)}"><title>${esc(t.name)}: ${esc(t.terms.slice(0, 8).join(', '))}</title></circle>${label}</g>`
    })
    .join('')
  const catLegend = f.categories
    .slice(0, CHART_TOPICS)
    .map((c, k) => `<span class="key"><i class="k${k}"></i>${esc(c.name)}</span>`)
    .join('')
  const catRows = f.categories
    .filter(c => c.topics.length > 1 || c.seed !== null)
    .map(c => `<tr><td><i class="${catColor.get(c.id) ?? 'co'}"></i>${esc(c.name)}${c.seed !== null ? ' <span class="dim">seed</span>' : ''}</td><td class="num">${c.total.toFixed(2)}</td><td class="num">${c.topics.length}</td><td class="terms">${esc(c.topics.slice(0, 12).map(id => byTopic.get(id)!.name).join(', '))}</td></tr>`)
    .join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Focus Timeline</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1f;--dim:#6e6e73;--rule:#e2e2e0;
--c0:#4e79a7;--c1:#f28e2b;--c2:#59a14f;--c3:#e15759;--c4:#76b7b2;--c5:#edc948;--c6:#b07aa1;--c7:#ff9da7;--c8:#9c755f;--c9:#3b9ab2;--co:#c9c9c6;
--k0:#0e7c7b;--k1:#c2410c;--k2:#6d28d9;--k3:#be185d;--k4:#4d7c0f;--k5:#a16207;--k6:#0369a1;--k7:#7c2d12;--k8:#a21caf;--k9:#334155;
--node:#5b6b7f;--hit:#d97706}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececec;--dim:#9a9aa0;--rule:#2c2c30;
--c0:#6f9fd0;--c1:#f5a55a;--c2:#7cc271;--c3:#ee7a7c;--c4:#8fd0cb;--c5:#f2d76b;--c6:#c99bc0;--c7:#ffb6be;--c8:#b8937c;--c9:#5bb6cc;--co:#4a4a4e;
--k0:#2dd4bf;--k1:#fb923c;--k2:#a78bfa;--k3:#f472b6;--k4:#a3e635;--k5:#facc15;--k6:#38bdf8;--k7:#d6a26a;--k8:#e879f9;--k9:#cbd5e1;
--node:#9aa8b8;--hit:#fbbf24}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:32px 0 8px}
.dim{color:var(--dim)}
svg{width:100%;height:auto;display:block}
svg text{fill:var(--dim);font-size:11px}svg line{stroke:var(--rule)}
svg path{stroke:var(--bg);stroke-width:.5}
${[...Array(CHART_TOPICS).keys()].map(k => `.c${k}{fill:var(--c${k});background:var(--c${k})}.k${k}{fill:var(--k${k});background:var(--k${k})}`).join('')}.co{fill:var(--co);background:var(--co)}
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
#cloud .edges line{stroke:var(--dim);stroke-opacity:.35}
#cloud circle{stroke:var(--bg);stroke-width:1}
#cloud text{fill:var(--fg);font-size:10px;pointer-events:none}
#cloud .off{opacity:.12}
.slider{display:flex;gap:10px;align-items:center;margin:8px 0}
.slider input{flex:1;max-width:420px}
.slider{position:sticky;top:0;background:var(--bg);padding:6px 0;z-index:1}
.tools{display:flex;gap:10px;align-items:center;margin:8px 0}
.tools input{flex:1;max-width:320px;font:inherit;padding:4px 8px;border:1px solid var(--rule);border-radius:4px;background:var(--bg);color:var(--fg)}
.termwrap{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
#terms{flex:1 1 560px;min-width:0}
#terms .edges line{stroke:var(--dim);stroke-opacity:.3}
#terms circle{fill:var(--node);stroke:var(--bg);stroke-width:.5;cursor:pointer}
#terms circle.hit{fill:var(--hit)}
#terms circle.pick{stroke:var(--fg);stroke-width:2}
#terms text{fill:var(--fg);font-size:10px;pointer-events:none}
#terms .off{opacity:.08}
.card{flex:0 1 320px;min-width:260px;font-size:13px}
.card h3{font-size:15px;margin:0 0 2px}.card h4{font-size:12px;color:var(--dim);margin:12px 0 4px}
.card ul{margin:0;padding-left:16px}.card li{margin:0 0 6px}
.card a{color:var(--fg)}
.card td{padding:2px 6px}
.card td.bar{width:90px}.card td.bar span{display:block;height:6px;border-radius:3px;background:var(--node)}
.spark{width:220px;height:36px;margin-top:6px}.spark polyline{fill:none;stroke:var(--node);stroke-width:1.5}
</style></head><body><main>
<h1>Focus timeline</h1>
<div class="dim">${f.buckets.length} ${f.bucket === 'week' ? 'weeks' : 'days'}${f.since ? ` since ${f.since}` : ''} · ${f.buckets.reduce((s, b) => s + b.prompts, 0)} prompts · newest ${esc(f.generatedAt ?? '–')}</div>
<div class="slider"><input id="wk" type="range" min="0" max="${f.buckets.length}" value="${f.buckets.length}" aria-label="${f.bucket}"><span id="wkl">all ${f.bucket}s</span></div>
${termSection(f, tv, prompts)}
<h2>Topic share per ${f.bucket}</h2>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked topic share over time">${grid}${paths.join('')}${ticks}</svg>
<div class="legend">${legend}</div>
<h2>Topic cloud</h2>
<div class="dim">The ${cloud.nodes.length} largest topics, sized by total share and coloured by category (the ${CHART_TOPICS} largest; grey for the rest); a line joins two that show in the same prompts (Jaccard ≥ ${CLOUD_EDGE_MIN}). The ${f.bucket} slider at the top dims the topics under ${PRESENT * 100}% of that ${f.bucket}.</div>
<svg id="cloud" viewBox="0 0 ${CLOUD_W} ${CLOUD_H}" role="img" aria-label="Topic relationship cloud"><g class="edges">${lines}</g>${dots}</svg>
<div class="legend">${catLegend}</div>
<h2>Categories</h2>
<div class="wrap"><table><thead><tr><th>Category</th><th>Total</th><th>Topics</th><th>Its topics</th></tr></thead><tbody>${catRows}</tbody></table></div>
<h2>Topics by total share</h2>
<div class="wrap"><table>${head}<tbody>${topicRows}</tbody></table></div>
<h2>Noticed once</h2>
<div class="dim">${onceTopics.length} topics that showed in a single session, with that session's first prompt.</div>
<div class="wrap"><table>${head}<tbody>${onceRows}</tbody></table></div>
<h2>${f.bucket === 'week' ? 'Weeks' : 'Days'}</h2>
<div class="wrap"><table><thead><tr><th>Start</th><th>Prompts</th><th>Sessions</th><th>Top topic</th><th>Top terms</th></tr></thead><tbody>${bucketRows}</tbody></table></div>
</main>
${pageScript(f.bucket)}
</body></html>
`
}

// ---- main ----

const main = () => {
  const { since, bucket, seed } = parseArgs(process.argv.slice(2))
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
  // Concepts are keyed by stems; each shows as its most frequent surface form.
  const { perPrompt, surfaces } = concepts(prompts.map(p => tokenize(p.text, repos)))
  const shown = new Map<string, string>()
  for (const [key, m] of surfaces) shown.set(key, [...m.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]![0])
  const show = (key: string) => shown.get(key) ?? key
  prompts.forEach((p, pi) => {
    const b = index.get(bucketOf(p.at, bucket))!
    promptCount[b]!++
    sessions[b]!.add(`${p.harness}:${p.session}`)
    repoCounts[b]!.set(p.repo, (repoCounts[b]!.get(p.repo) ?? 0) + 1)
    for (const t of perPrompt[pi]!) {
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
  const termLinks = links(
    vocab.map(t => Int32Array.from(promptsOf.get(t)!)),
    termsByPrompt.map(ts => Int32Array.from(ts)),
    MIN_SHARED,
    LINK_MIN,
  )
  const groups = cluster(
    termLinks,
    vocab.map((_, i) => [i]),
    { mergeMin: MERGE_MIN, maxSize: TOPIC_MAX },
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
      const name = show(terms[0]!)
      let id = slug(name)
      for (let k = 2; ids.has(id); k++) id = `${slug(name)}~${k}`
      ids.add(id)
      // Where the topic shows: prompts holding at least two of its terms.
      const hits = new Map<number, number>()
      for (const i of members) for (const p of promptsOf.get(vocab[i]!)!) hits.set(p, (hits.get(p) ?? 0) + 1)
      const at = [...hits.entries()].filter(([, c]) => c >= 2).map(([p]) => p).sort((x, y) => x - y)
      const where = at.map(p => prompts[p]!)
      const sessionKeys = [...new Set(where.map(p => `${p.harness}:${p.session}`))].sort(cmp)
      const harnesses: Record<string, number> = {}
      for (const p of where) harnesses[p.harness] = (harnesses[p.harness] ?? 0) + 1
      const sorted = Object.fromEntries(Object.entries(harnesses).sort((x, y) => cmp(x[0], y[0])))
      const caption = sessionKeys.length === 1 ? firstPrompt.get(sessionKeys[0]!)!.replace(/\s+/g, ' ').slice(0, 200) : null
      return { id, name, terms, members, at, sessions: sessionKeys.length, harnesses: sorted, caption }
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
      const out: TopicOut = {
        id: tp.id,
        name: tp.name,
        category: '',
        terms: tp.terms.map(show),
        first,
        peak,
        last,
        total: round(total),
        sessions: tp.sessions,
        harnesses: tp.harnesses,
      }
      if (tp.caption !== null) out.firstPrompt = tp.caption
      return out
    })
  const topicAt = new Map(topicsRaw.map(tp => [tp.id, tp.at]))
  topics.sort((a, b) => b.total - a.total || cmp(a.id, b.id))

  // Categories: the merge continued from the topics, looser; each named by its largest topic.
  const topicMembers = new Map(topicsRaw.map(tp => [tp.id, tp.members]))
  const topicOfTerm = new Map<number, number>()
  topics.forEach((t, i) => {
    for (const m of topicMembers.get(t.id)!) topicOfTerm.set(m, i)
  })
  const catGroups = cluster(
    termLinks,
    topics.map(t => topicMembers.get(t.id)!),
    { mergeMin: CATEGORY_MERGE_MIN, maxSize: CATEGORY_MAX },
  )
  // Seeds first: a topic joins the seed it matches best (ties to the seed read first); the rest keep their discovered category.
  const seeds = seed ? readSeeds() : []
  const topicKeys = new Map(topicsRaw.map(tp => [tp.id, tp.terms]))
  const seedOf = topics.map(t => {
    // Only a topic's leading terms count, so a generic seed word deep in a big topic doesn't claim it.
    const keys = new Set(topicKeys.get(t.id)!.slice(0, SEED_TERMS))
    const words = new Set([...keys].flatMap(k => k.split(' ')))
    let best = -1
    let bestScore = 0
    seeds.forEach((s, i) => {
      const score = seedScore(s, keys, words)
      if (score > bestScore) (best = i), (bestScore = score)
    })
    return best
  })
  const catIds = new Set<string>()
  const category = (ts: TopicOut[], name: string, seed: string | null): CategoryOut => {
    const base = seed === null ? ts[0]!.id : `seed:${slug(seed.toLowerCase())}`
    let id = base
    for (let k = 2; catIds.has(id); k++) id = `${base}~${k}`
    catIds.add(id)
    for (const t of ts) t.category = id
    return { id, name, seed, topics: ts.map(t => t.id), total: round(ts.reduce((s, t) => s + t.total, 0)) }
  }
  const seeded: CategoryOut[] = seeds
    .map((s, si) => ({ s, ts: topics.filter((_, i) => seedOf[i] === si) }))
    .filter(x => x.ts.length)
    .map(x => category(x.ts, x.s.name, x.s.name))
  const discovered: CategoryOut[] = catGroups
    .map(g => [...new Set(g.map(m => topicOfTerm.get(m)!))].filter(i => seedOf[i]! < 0).sort((x, y) => x - y).map(i => topics[i]!))
    .filter(ts => ts.length)
    .map(ts => category(ts, ts[0]!.name, null))
  const categories = [...seeded, ...discovered].sort((a, b) => b.total - a.total || cmp(a.id, b.id))
  const seededTopics = seedOf.filter(s => s >= 0).length

  // The relationship cloud: the largest topics, linked by how often they show in the same prompts.
  const cloudTopics = topics.slice(0, CLOUD_NODES)
  const edges: CloudEdge[] = []
  for (let i = 0; i < cloudTopics.length; i++)
    for (let j = i + 1; j < cloudTopics.length; j++) {
      const a = topicAt.get(cloudTopics[i]!.id)!
      const b = topicAt.get(cloudTopics[j]!.id)!
      let x = 0
      let y = 0
      let both = 0
      while (x < a.length && y < b.length) {
        if (a[x] === b[y]) both++, x++, y++
        else if (a[x]! < b[y]!) x++
        else y++
      }
      const jac = both / (a.length + b.length - both)
      if (jac >= CLOUD_EDGE_MIN) edges.push({ a: i, b: j, w: jac })
    }
  const cloud: Cloud = { nodes: cloudTopics.map(t => t.id), edges, pos: layout(cloudTopics.length, edges) }

  const buckets: BucketOut[] = starts.map((start, b) => {
    const minCount = promptCount[b]! >= 30 ? 2 : 1
    const terms = [...weights[b]!.entries()]
      .filter(([t]) => counts[b]!.get(t)! >= minCount)
      .map(([term, v]) => ({ term: show(term), tfidf: round(v), count: counts[b]!.get(term)! }))
      .sort((x, y) => y.tfidf - x.tfidf || y.count - x.count || cmp(x.term, y.term))
      .slice(0, 40)
    const ts = topicsRaw
      .map((tp, k) => ({ id: tp.id, share: round(shares[b]![k]!) }))
      .filter(t => t.share > 0)
      .sort((x, y) => y.share - x.share || cmp(x.id, y.id))
    const rc = Object.fromEntries([...repoCounts[b]!.entries()].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0])))
    return { start, prompts: promptCount[b]!, sessions: sessions[b]!.size, repos: rc, terms, topics: ts }
  })

  // The raw term view; its floor rises until focus.json fits FOCUS_MAX_BYTES.
  const bucketIndex = prompts.map(p => index.get(bucketOf(p.at, bucket))!)
  let termMin = TERM_MIN
  let tv = termView(prompts, promptsOf, bucketIndex, nb, show, termMin)
  const build = (): Focus => ({
    generatedAt: prompts.length ? new Date(prompts[prompts.length - 1]!.at).toISOString() : null,
    since,
    bucket,
    termMin,
    buckets,
    terms: tv.terms,
    edges: tv.edges,
    categories,
    topics,
  })
  let focus = build()
  let json = `${JSON.stringify(focus)}\n`
  while (json.length > FOCUS_MAX_BYTES && tv.terms.length) {
    termMin++
    tv = termView(prompts, promptsOf, bucketIndex, nb, show, termMin)
    focus = build()
    json = `${JSON.stringify(focus)}\n`
  }
  const pos = layout(tv.terms.length, tv.draw, TERM_W, TERM_H, TERM_ITERATIONS)
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'focus.json'), json)
  writeFileSync(join(OUT_DIR, 'focus.html'), html(focus, cloud, { ...tv, pos }, prompts))

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
  const big = categories.filter(c => c.topics.length > 1)
  console.log(
    `${categories.length} categories (${big.length} with more than one topic): ${seededTopics} topics seeded into ${seeded.length} seed categories (of ${seeds.length} seeds), ${topics.length - seededTopics} discovered; largest:`,
  )
  for (const c of categories.slice(0, 12))
    console.log(`  ${c.name} (${c.topics.length} topics, ${c.total.toFixed(2)}): ${c.topics.slice(0, 6).map(id => names.get(id)).join(', ')}`)
  console.log(
    `${tv.terms.length} terms (in ${termMin}+ prompts${termMin > TERM_MIN ? `, floor raised from ${TERM_MIN} to fit ${FOCUS_MAX_BYTES / 1e6} MB` : ''}), ${tv.edges.length} edges; focus.json ${(json.length / 1e6).toFixed(1)} MB${seed ? '' : '; categories unseeded (--seed seeds them)'}`,
  )
  console.log(`wrote ${join(OUT_DIR, 'focus.json')} and focus.html`)
}

main()
