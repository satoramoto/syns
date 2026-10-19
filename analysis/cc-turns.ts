// Every Claude Code transcript turn, one document each, into Elasticsearch,
// so sessions, projects, models, days, tokens and cost can be aggregated with
// plain `_search` aggregations.
//
//   bun analysis/cc-turns.ts [--since YYYY-MM-DD] [--dry-run] [--insecure] [--es URL] [--index NAME] [--out FILE.ndjson]
//
// Reads `~/.claude/projects/<slug>/<sessionId>.jsonl` and each session's
// subagents (`<slug>/<sessionId>/subagents/agent-<id>.jsonl`). A document is
// one API response (an assistant message: the transcript writes one line per
// content block, all carrying the same `message.id` and usage, so the lines
// are folded into one) or one user message that carries text (tool results
// are folded into the assistant document that asked for them). The document
// id is `<sessionId>:<uuid of the first line>`, so a re-run overwrites and
// never duplicates. See docs/cc-turns.md.
//
// The password comes from `op read` at run time (or `ES_PASSWORD` in the
// environment); the homelab root CA from `mkcert -CAROOT`, else `--insecure`.

import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createInterface } from 'node:readline'
import { HOME, PROJECTS_DIR, cleanClaude, mtime, repoOf, sortedDir, walk } from './transcripts'

// ---- arguments ----

const usage = () => {
  console.error('usage: bun analysis/cc-turns.ts [--since YYYY-MM-DD] [--dry-run] [--insecure] [--es URL] [--index NAME] [--out FILE.ndjson]')
  process.exit(2)
}

const args = { since: 0, dryRun: false, insecure: false, es: 'https://es.newegypt.io', index: 'cc-turns', out: '' }
{
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const v = argv[i + 1]
    if (a === '--since' && v && /^\d{4}-\d{2}-\d{2}$/.test(v)) (args.since = Date.parse(v)), i++
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--insecure') args.insecure = true
    else if (a === '--es' && v) (args.es = v.replace(/\/$/, '')), i++
    else if (a === '--index' && v) (args.index = v), i++
    else if (a === '--out' && v) (args.out = v), i++
    else usage()
  }
}

// ---- rates ----

/** List prices in USD per million tokens (Anthropic first-party API, 2026-10). Cache writes: 5-minute at 1.25x input, 1-hour at 2x input. */
const RATES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
}

/** The rate row for a model id, with a date suffix or `[1m]` stripped (`claude-haiku-4-5-20251001` is `claude-haiku-4-5`). */
const rateOf = (model: string) => {
  const base = model.replace(/\[1m\]$/, '').replace(/-\d{8}$/, '')
  return RATES[base] ?? null
}

type Usage = { input: number; output: number; cache_read: number; cache_write: number; cache_write_5m: number; cache_write_1h: number; thinking: number }

const costOf = (model: string, u: Usage): number | null => {
  const r = rateOf(model)
  if (!r) return null
  const perTok = 1e-6
  return (
    (u.input * r.input + u.output * r.output + u.cache_read * r.cacheRead + u.cache_write_5m * r.input * 1.25 + u.cache_write_1h * r.input * 2) *
    perTok
  )
}

// ---- pods ----

/** App session id (`local_<id>`) -> pod id, from brain.json's pods (lead and sessions) and ledger lines mentioning a `local_<id>` under a pod or one of its epics. */
const readPods = (): Map<string, string> => {
  const out = new Map<string, string>()
  const podOfEpic = new Map<string, string>()
  const pods = new Set<string>()
  let brain: any
  try {
    brain = JSON.parse(readFileSync(join(HOME, '.syns', 'brain.json'), 'utf8'))
  } catch {
    return out
  }
  const id = (s: unknown) => (typeof s === 'string' && s.startsWith('local_') ? s : null)
  for (const pod of Array.isArray(brain?.pods) ? brain.pods : []) {
    if (typeof pod?.id !== 'string') continue
    pods.add(pod.id)
    for (const e of Array.isArray(pod.epics) ? pod.epics : []) if (typeof e === 'string') podOfEpic.set(e, pod.id)
    const lead = id(pod.lead)
    if (lead) out.set(lead, pod.id)
    for (const s of Array.isArray(pod.sessions) ? pod.sessions : []) {
      const sid = id(s)
      if (sid) out.set(sid, pod.id)
    }
  }
  let ledger = ''
  try {
    ledger = readFileSync(join(HOME, '.syns', 'memory.jsonl'), 'utf8')
  } catch {
    return out
  }
  for (const line of ledger.split('\n')) {
    if (!line.includes('local_')) continue
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const parent = typeof d?.parent === 'string' ? d.parent : ''
    const pod = pods.has(parent) ? parent : podOfEpic.get(parent)
    if (!pod) continue
    for (const m of line.matchAll(/local_[0-9a-f-]{36}/g)) if (!out.has(m[0])) out.set(m[0], pod)
  }
  return out
}

// ---- the app's session records ----

type AppRecord = { app: string; title: string | null; parent: string | null }

/** CLI session id -> the Claude desktop app's record of it (its `local_<id>`, title and parent session), as the Tasks tab reads them. */
const readAppRecords = (): Map<string, AppRecord> => {
  const out = new Map<string, AppRecord>()
  const root = join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
  for (const path of walk(root, '.json')) {
    let d: any
    try {
      d = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    if (typeof d?.cliSessionId !== 'string' || typeof d?.sessionId !== 'string') continue
    out.set(d.cliSessionId, { app: d.sessionId, title: str(d.title), parent: str(d.parentSessionId) })
  }
  return out
}

// ---- documents ----

const TEXT_MAX = 4000
const SUMMARY_MAX = 200
const SUMMARY_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'description', 'url', 'prompt', 'skill', 'message', 'text', 'recap', 'to']

type ToolUse = { id: string; name: string; summary: string; input_chars: number; is_error: boolean | null; result_chars: number | null; tool_ms: number | null }

type Doc = {
  session_id: string
  agent_id: string | null
  is_sidechain: boolean
  project: string
  project_dir: string
  app_session_id: string | null
  parent_session_id: string | null
  cwd: string
  git_branch: string | null
  session_title: string | null
  pod: string | null
  timestamp: string
  day: string
  role: 'user' | 'assistant'
  uuid: string
  parent_uuid: string | null
  prompt_id: string | null
  request_id: string | null
  message_id: string | null
  model: string | null
  version: string | null
  entrypoint: string | null
  effort: string | null
  stop_reason: string | null
  is_meta: boolean
  is_person: boolean
  text: string
  text_chars: number
  tool_uses: ToolUse[]
  tool_use_count: number
  usage: Usage | null
  cost_usd: number | null
  since_parent_ms: number | null
  lines: number
  file: string
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const localDay = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const summarize = (input: any): string => {
  if (!input || typeof input !== 'object') return ''
  for (const k of SUMMARY_KEYS) {
    const v = input[k]
    if (typeof v === 'string' && v) return v.length > SUMMARY_MAX ? v.slice(0, SUMMARY_MAX) : v
  }
  const first = Object.entries(input).find(([, v]) => typeof v === 'string' && v)
  return first ? `${first[0]}=${(first[1] as string).slice(0, SUMMARY_MAX)}` : ''
}

const usageOf = (u: any): Usage | null => {
  if (!u || typeof u !== 'object') return null
  const n = (v: unknown) => (typeof v === 'number' ? v : 0)
  const w5 = n(u.cache_creation?.ephemeral_5m_input_tokens)
  const w1 = n(u.cache_creation?.ephemeral_1h_input_tokens)
  const write = n(u.cache_creation_input_tokens)
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cache_read: n(u.cache_read_input_tokens),
    cache_write: write,
    // The split is missing on older lines: count the whole write as 5-minute then.
    cache_write_5m: w5 + w1 > 0 ? w5 : write,
    cache_write_1h: w1,
    thinking: n(u.output_tokens_details?.thinking_tokens),
  }
}

const blocksOf = (content: unknown): any[] => (Array.isArray(content) ? content.filter(b => b && typeof b === 'object') : [])

type FileInfo = { path: string; project_dir: string; session_id: string; agent_id: string | null }

/** Every transcript: `<slug>/<sessionId>.jsonl` and `<slug>/<sessionId>/subagents/agent-<id>.jsonl`. */
const listFiles = (): FileInfo[] => {
  const out: FileInfo[] = []
  for (const dir of sortedDir(PROJECTS_DIR)) {
    const root = join(PROJECTS_DIR, dir)
    for (const f of sortedDir(root)) {
      if (f.endsWith('.jsonl')) out.push({ path: join(root, f), project_dir: dir, session_id: f.slice(0, -6), agent_id: null })
      else
        for (const p of walk(join(root, f, 'subagents'), '.jsonl')) {
          const name = p.split('/').pop()!.slice(0, -6)
          out.push({ path: p, project_dir: dir, session_id: f, agent_id: name.replace(/^agent-/, '') })
        }
    }
  }
  return out
}

/** The documents of one transcript, in file order. */
const readFile = async (f: FileInfo): Promise<{ docs: Doc[]; title: string | null }> => {
  const docs: Doc[] = []
  const byMessage = new Map<string, Doc>()
  const at = new Map<string, number>()
  const toolUse = new Map<string, { doc: Doc; use: ToolUse }>()
  let title: string | null = null
  const rl = createInterface({ input: createReadStream(f.path), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const type = d?.type
    if (type === 'custom-title' || type === 'ai-title' || type === 'agent-name') {
      const t = str(d.customTitle) ?? str(d.aiTitle) ?? str(d.agentName)
      if (t && (type === 'custom-title' || !title)) title = t
      continue
    }
    const uuid = str(d.uuid)
    const timestamp = str(d.timestamp)
    if (!uuid || !timestamp) continue
    const t = Date.parse(timestamp)
    // Every line in the chain keeps its time (`system` and `attachment` lines are parents too), so `since_parent_ms` is the gap to whatever came before.
    at.set(uuid, t)
    if (type !== 'user' && type !== 'assistant') continue
    const msg = d.message ?? {}
    const blocks = blocksOf(msg.content)
    const parent = str(d.parentUuid)
    const sincePrev = parent && at.has(parent) ? Math.max(0, t - at.get(parent)!) : null

    if (type === 'user') {
      // Tool results fold into the assistant document that asked.
      const results = blocks.filter(b => b.type === 'tool_result')
      for (const r of results) {
        const hit = toolUse.get(str(r.tool_use_id) ?? '')
        if (!hit) continue
        hit.use.is_error = r.is_error === true
        hit.use.result_chars = typeof r.content === 'string' ? r.content.length : JSON.stringify(r.content ?? '').length
        hit.use.tool_ms = Math.max(0, t - Date.parse(hit.doc.timestamp))
      }
      const text = typeof msg.content === 'string' ? msg.content : blocks.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
      if (!text) continue
      const isMeta = d.isMeta === true
      const person = !isMeta && !d.isSidechain && d.promptSource !== 'system' && d.entrypoint !== 'sdk-cli' && cleanClaude(text) !== ''
      docs.push({
        session_id: str(d.sessionId) ?? f.session_id,
        agent_id: str(d.agentId) ?? f.agent_id,
        is_sidechain: d.isSidechain === true,
        project: repoOf(str(d.cwd) ?? ''),
        project_dir: f.project_dir,
        app_session_id: null,
        parent_session_id: null,
        cwd: str(d.cwd) ?? '',
        git_branch: str(d.gitBranch),
        session_title: null,
        pod: null,
        timestamp,
        day: localDay(timestamp),
        role: 'user',
        uuid,
        parent_uuid: parent,
        prompt_id: str(d.promptId),
        request_id: null,
        message_id: null,
        model: null,
        version: str(d.version),
        entrypoint: str(d.entrypoint),
        effort: null,
        stop_reason: null,
        is_meta: isMeta,
        is_person: person,
        text: text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text,
        text_chars: text.length,
        tool_uses: [],
        tool_use_count: 0,
        usage: null,
        cost_usd: null,
        since_parent_ms: sincePrev,
        lines: 1,
        file: relative(PROJECTS_DIR, f.path),
      })
      continue
    }

    // Assistant: the lines of one API response share a message id.
    const key = str(msg.id) ?? str(d.requestId) ?? uuid
    let doc = byMessage.get(key)
    if (!doc) {
      const model = str(msg.model)
      const usage = usageOf(msg.usage)
      doc = {
        session_id: str(d.sessionId) ?? f.session_id,
        agent_id: str(d.agentId) ?? f.agent_id,
        is_sidechain: d.isSidechain === true,
        project: repoOf(str(d.cwd) ?? ''),
        project_dir: f.project_dir,
        app_session_id: null,
        parent_session_id: null,
        cwd: str(d.cwd) ?? '',
        git_branch: str(d.gitBranch),
        session_title: null,
        pod: null,
        timestamp,
        day: localDay(timestamp),
        role: 'assistant',
        uuid,
        parent_uuid: parent,
        prompt_id: str(d.promptId),
        request_id: str(d.requestId),
        message_id: str(msg.id),
        model,
        version: str(d.version),
        entrypoint: str(d.entrypoint),
        effort: str(d.effort) ?? str(d.perTurnEffort),
        stop_reason: str(msg.stop_reason),
        is_meta: false,
        is_person: false,
        text: '',
        text_chars: 0,
        tool_uses: [],
        tool_use_count: 0,
        usage,
        cost_usd: model && usage && model !== '<synthetic>' ? costOf(model, usage) : null,
        since_parent_ms: sincePrev,
        lines: 0,
        file: relative(PROJECTS_DIR, f.path),
      }
      byMessage.set(key, doc)
      docs.push(doc)
    }
    doc.lines++
    // Later lines of the same response carry the stop reason and the usage as they grew: keep the largest of each.
    if (!doc.stop_reason) doc.stop_reason = str(msg.stop_reason)
    const later = usageOf(msg.usage)
    if (later && doc.usage) {
      for (const k of Object.keys(doc.usage) as (keyof Usage)[]) doc.usage[k] = Math.max(doc.usage[k], later[k])
      doc.cost_usd = doc.model && doc.model !== '<synthetic>' ? costOf(doc.model, doc.usage) : null
    }
    for (const b of blocks) {
      if (b.type === 'text' && typeof b.text === 'string') {
        doc.text_chars += b.text.length
        if (doc.text.length < TEXT_MAX) doc.text = (doc.text ? `${doc.text}\n` : '') + b.text.slice(0, TEXT_MAX - doc.text.length)
      } else if (b.type === 'tool_use') {
        const use: ToolUse = {
          id: str(b.id) ?? '',
          name: str(b.name) ?? '',
          summary: summarize(b.input),
          input_chars: JSON.stringify(b.input ?? {}).length,
          is_error: null,
          result_chars: null,
          tool_ms: null,
        }
        doc.tool_uses.push(use)
        doc.tool_use_count++
        if (use.id) toolUse.set(use.id, { doc, use })
      }
    }
  }
  return { docs, title }
}

// ---- Elasticsearch ----

const MAPPING = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
    dynamic: 'strict',
    properties: {
      session_id: { type: 'keyword' },
      agent_id: { type: 'keyword' },
      is_sidechain: { type: 'boolean' },
      project: { type: 'keyword' },
      project_dir: { type: 'keyword' },
      app_session_id: { type: 'keyword' },
      parent_session_id: { type: 'keyword' },
      cwd: { type: 'keyword' },
      git_branch: { type: 'keyword' },
      session_title: { type: 'keyword', ignore_above: 512 },
      pod: { type: 'keyword' },
      timestamp: { type: 'date' },
      day: { type: 'keyword' },
      role: { type: 'keyword' },
      uuid: { type: 'keyword' },
      parent_uuid: { type: 'keyword' },
      prompt_id: { type: 'keyword' },
      request_id: { type: 'keyword' },
      message_id: { type: 'keyword' },
      model: { type: 'keyword' },
      version: { type: 'keyword' },
      entrypoint: { type: 'keyword' },
      effort: { type: 'keyword' },
      stop_reason: { type: 'keyword' },
      is_meta: { type: 'boolean' },
      is_person: { type: 'boolean' },
      text: { type: 'text' },
      text_chars: { type: 'integer' },
      tool_uses: {
        properties: {
          id: { type: 'keyword' },
          name: { type: 'keyword' },
          summary: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
          input_chars: { type: 'integer' },
          is_error: { type: 'boolean' },
          result_chars: { type: 'integer' },
          tool_ms: { type: 'integer' },
        },
      },
      tool_use_count: { type: 'integer' },
      usage: {
        properties: {
          input: { type: 'long' },
          output: { type: 'long' },
          cache_read: { type: 'long' },
          cache_write: { type: 'long' },
          cache_write_5m: { type: 'long' },
          cache_write_1h: { type: 'long' },
          thinking: { type: 'long' },
        },
      },
      cost_usd: { type: 'double' },
      since_parent_ms: { type: 'long' },
      lines: { type: 'integer' },
      file: { type: 'keyword' },
    },
  },
}

const run = (cmd: string[]): string | null => {
  const p = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] })
  if (p.status !== 0) console.error(p.stderr.trim() || `${cmd[0]} exited ${p.status}`)
  return p.status === 0 ? p.stdout.trim() : null
}

type Es = { fetch: (path: string, init?: RequestInit) => Promise<Response> }

const connect = (): Es => {
  const password = process.env.ES_PASSWORD || run(['op', 'read', 'op://Infrastructure/Elasticsearch/elastic_password'])
  if (!password) {
    console.error('no password: `op read op://Infrastructure/Elasticsearch/elastic_password` failed (is 1Password signed in?) and ES_PASSWORD is unset')
    process.exit(1)
  }
  const auth = `Basic ${Buffer.from(`elastic:${password}`).toString('base64')}`
  let tls: Record<string, unknown> | undefined
  if (args.insecure) tls = { rejectUnauthorized: false }
  else {
    const caroot = run(['mkcert', '-CAROOT'])
    const ca = caroot ? join(caroot, 'rootCA.pem') : null
    if (!ca || mtime(ca) < 0) {
      console.error('no root CA: `mkcert -CAROOT` has no rootCA.pem; pass --insecure to skip verification')
      process.exit(1)
    }
    tls = { ca: readFileSync(ca, 'utf8') }
  }
  return {
    fetch: (path, init = {}) =>
      fetch(`${args.es}${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', ...(init.headers ?? {}) }, tls } as RequestInit),
  }
}

/** Creates the index with the mapping, or adds any new fields to an existing one (a changed field type is refused by Elasticsearch: delete the index and run again). */
const ensureIndex = async (es: Es) => {
  const head = await es.fetch(`/${args.index}`, { method: 'HEAD' })
  if (head.status === 200) {
    const put = await es.fetch(`/${args.index}/_mapping`, { method: 'PUT', body: JSON.stringify(MAPPING.mappings) })
    if (!put.ok) throw new Error(`PUT ${args.index}/_mapping: ${put.status} ${await put.text()}`)
    return false
  }
  if (head.status !== 404) throw new Error(`HEAD ${args.index}: ${head.status} ${await head.text()}`)
  const put = await es.fetch(`/${args.index}`, { method: 'PUT', body: JSON.stringify(MAPPING) })
  if (!put.ok) throw new Error(`PUT ${args.index}: ${put.status} ${await put.text()}`)
  return true
}

const BULK_DOCS = 2000
const BULK_BYTES = 8_000_000

class Bulk {
  private lines: string[] = []
  private bytes = 0
  indexed = 0
  failed = 0
  constructor(private es: Es | null) {}
  async add(doc: Doc) {
    const head = JSON.stringify({ index: { _index: args.index, _id: `${doc.session_id}:${doc.uuid}` } })
    const body = JSON.stringify(doc)
    this.lines.push(head, body)
    this.bytes += head.length + body.length + 2
    if (this.lines.length >= BULK_DOCS * 2 || this.bytes >= BULK_BYTES) await this.flush()
  }
  async flush() {
    if (!this.lines.length) return
    const n = this.lines.length / 2
    if (this.es) {
      const res = await this.es.fetch('/_bulk?refresh=false', { method: 'POST', body: `${this.lines.join('\n')}\n`, headers: { 'content-type': 'application/x-ndjson' } })
      if (!res.ok) throw new Error(`bulk: ${res.status} ${(await res.text()).slice(0, 500)}`)
      const out: any = await res.json()
      let bad = 0
      for (const item of out.items ?? []) {
        const r = item.index ?? {}
        if (r.error) {
          bad++
          if (bad <= 3) console.error(`  ${r._id}: ${JSON.stringify(r.error).slice(0, 300)}`)
        }
      }
      this.failed += bad
      this.indexed += n - bad
    } else this.indexed += n
    this.lines = []
    this.bytes = 0
  }
}

// ---- main ----

const main = async () => {
  const started = Date.now()
  const pods = readPods()
  const apps = readAppRecords()
  const es = args.dryRun ? null : connect()
  if (es) console.error(`index ${args.index} at ${args.es}: ${(await ensureIndex(es)) ? 'created' : 'exists'}`)
  const files = listFiles().filter(f => mtime(f.path) >= args.since)
  const bulk = new Bulk(es)
  // `--out`: every document as one JSON line, for a look at the shape or a diff between runs.
  const out = args.out ? createWriteStream(args.out) : null
  const sessions = new Set<string>()
  // A resumed or forked session copies its parent's subagent transcripts under its own folder: the same documents again, skipped.
  const seen = new Set<string>()
  let copies = 0
  const byRole = { user: 0, assistant: 0 }
  let cost = 0
  const byModel = new Map<string, number>()
  const unpriced = new Map<string, number>()
  // A subagent's title is its parent session's: main transcripts come first in each project (sorted), so titles are known by then.
  const titles = new Map<string, string>()
  for (const [i, f] of files.entries()) {
    const { docs, title } = await readFile(f)
    if (title && !f.agent_id) titles.set(f.session_id, title)
    for (const doc of docs) {
      const id = `${doc.session_id}:${doc.uuid}`
      if (seen.has(id)) {
        copies++
        continue
      }
      seen.add(id)
      const rec = apps.get(doc.session_id)
      doc.app_session_id = rec?.app ?? null
      doc.parent_session_id = rec?.parent ?? null
      doc.session_title = rec?.title ?? titles.get(doc.session_id) ?? null
      doc.pod = rec ? (pods.get(rec.app) ?? null) : null
      sessions.add(doc.session_id)
      byRole[doc.role]++
      if (doc.cost_usd != null) (cost += doc.cost_usd), byModel.set(doc.model!, (byModel.get(doc.model!) ?? 0) + doc.cost_usd)
      else if (doc.role === 'assistant' && doc.model && doc.model !== '<synthetic>') unpriced.set(doc.model, (unpriced.get(doc.model) ?? 0) + 1)
      if (out) out.write(`${JSON.stringify(doc)}\n`)
      await bulk.add(doc)
    }
    if ((i + 1) % 500 === 0) console.error(`  ${i + 1}/${files.length} files, ${bulk.indexed} docs`)
  }
  await bulk.flush()
  if (out) await new Promise(r => out.end(r))
  if (es) {
    const r = await es.fetch(`/${args.index}/_refresh`, { method: 'POST' })
    if (!r.ok) console.error(`refresh: ${r.status}`)
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `${args.dryRun ? 'parsed' : 'indexed'} ${bulk.indexed} documents (${byRole.assistant} assistant, ${byRole.user} user) from ${files.length} files, ${sessions.size} sessions, in ${secs}s; estimated cost $${cost.toFixed(2)}` +
      (copies ? `; ${copies} copies skipped` : "") +
      (bulk.failed ? `; ${bulk.failed} failed` : ""),
  )
  for (const [m, c] of [...byModel].sort((a, b) => b[1] - a[1])) console.error(`  ${m.padEnd(28)} $${c.toFixed(2)}`)
  for (const [m, n] of unpriced) console.error(`no rate for ${m}: ${n} documents without cost`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
