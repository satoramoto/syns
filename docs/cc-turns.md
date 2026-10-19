# Claude Code turns in Elasticsearch

`bun analysis/cc-turns.ts` reads every Claude Code transcript on this Mac and
indexes one document per turn into the `cc-turns` index on the homelab
Elasticsearch (`https://es.newegypt.io`, on tokyo behind Traefik), so
sessions, projects, models, days, tokens and cost can be aggregated with
plain `_search` aggregations. It is one-shot and idempotent: a re-run
overwrites each document by id and never duplicates.

## Running it

```sh
bun analysis/cc-turns.ts                      # everything (about 80 s for 3.7k files, 4.7 GB)
bun analysis/cc-turns.ts --since 2026-10-18   # only files modified since (a few seconds)
bun analysis/cc-turns.ts --dry-run            # parse and count, no Elasticsearch
bun analysis/cc-turns.ts --out turns.ndjson   # also write every document as a JSON line
```

Options: `--es URL` (default `https://es.newegypt.io`), `--index NAME`
(default `cc-turns`), `--insecure` (skip TLS verification).

Connection:

- The password is read at run time with
  `op read op://Infrastructure/Elasticsearch/elastic_password` (1Password asks
  for Touch ID; if `op` is signed out the script says so and stops). Set
  `ES_PASSWORD` in the environment to skip `op`. The password is never written
  anywhere.
- Traefik serves a mkcert wildcard certificate, so the script loads the homelab
  root CA from `mkcert -CAROOT`/`rootCA.pem`. On a machine without it, pass
  `--insecure`: the connection is still encrypted, but the server is not
  verified.

The index is created with the explicit mapping in the script
(`dynamic: strict`) when missing. When it exists, the script adds any new
fields to the mapping; a changed field type is refused by Elasticsearch, so
then delete the index (`DELETE /cc-turns`) and run again.

`--since` filters by the transcript file's modification time, so a running
session is picked up whole; documents already indexed are overwritten with the
same content.

## What is read

- `~/.claude/projects/<slug>/<sessionId>.jsonl`: the main transcript of each
  session.
- `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl`: each
  session's subagent transcripts (most of the token volume). A resumed or
  forked session carries copies of its parent's subagent files; the copies
  produce the same document ids and are skipped (the summary counts them).
- `~/Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json`:
  the desktop app's record of each session, which maps the CLI session id to
  the app's `local_<id>`, its title and its parent session.
- `~/.syns/brain.json` and `~/.syns/memory.jsonl`: which `local_<id>` belongs
  to which pod (a pod's `lead` and `sessions`, plus any ledger line under the
  pod or one of its epics that mentions a `local_<id>`).

The transcript reading shares `analysis/transcripts.ts` with `focus.ts`
(file walking, `repoOf`, `cleanClaude`).

## A document

One document is either an **assistant turn** (one API response: the
transcript writes one line per content block, all carrying the same
`message.id`, folded into one document) or a **user turn** that carries text.
Tool results are not documents: each folds into the `tool_uses` entry of the
assistant turn that asked for it. Document id: `<session_id>:<uuid>` of the
turn's first line.

| Field | Type | Meaning |
| --- | --- | --- |
| `session_id` | keyword | the CLI session id (the transcript's file name); a subagent's is its parent session's |
| `agent_id` | keyword | the subagent id for a subagent turn, else null |
| `is_sidechain` | boolean | the line's `isSidechain` (subagent work) |
| `project` | keyword | `owner/name` for a cwd under `~/Code/`, else its last two segments (same as the focus analyzer and the Tasks tab) |
| `project_dir` | keyword | the raw folder name under `~/.claude/projects/` |
| `app_session_id` | keyword | the desktop app's `local_<id>` for the session, when it has a record |
| `parent_session_id` | keyword | the app's parent session (`local_<id>`), when recorded |
| `cwd`, `git_branch` | keyword | from the line |
| `session_title` | keyword | the app's title, else the transcript's custom or AI title |
| `pod` | keyword | the syns pod the session belongs to, when brain.json or the ledger names it |
| `timestamp` | date | the line's time |
| `day` | keyword | the local calendar day (`YYYY-MM-DD`, this Mac's time zone) |
| `role` | keyword | `assistant` or `user` |
| `uuid`, `parent_uuid` | keyword | the turn's first line and its parent line |
| `prompt_id` | keyword | the app's prompt id, when present, which ties turns to the prompt that started them |
| `request_id`, `message_id` | keyword | the API request and message ids (assistant) |
| `model` | keyword | the model id as the API returned it; `<synthetic>` for a turn Claude Code made up (an API error message) |
| `version`, `entrypoint`, `effort`, `stop_reason` | keyword | Claude Code's version, how it was launched (`claude-desktop`, `cli`, `sdk-cli`), the effort, the API stop reason |
| `is_meta` | boolean | a user line the app injected (`isMeta`) |
| `is_person` | boolean | a user turn that is the person's own words (not meta, not a sidechain, not a system prompt source or an SDK run, and not empty once the app's tags are stripped), as `focus.ts` decides |
| `text` | text | the turn's text, truncated at 4000 characters; `text_chars` is the full length |
| `tool_uses` | object[] | per tool call: `id`, `name`, `summary` (the first of `command`, `file_path`, `path`, `pattern`, `query`, `description`, `url`, `prompt`, ..., 200 characters), `input_chars`, and from the result `is_error`, `result_chars`, `tool_ms` (result time minus the turn's time) |
| `tool_use_count` | integer | |
| `usage` | object | `input`, `output`, `cache_read`, `cache_write` (total), `cache_write_5m`, `cache_write_1h`, `thinking` (part of output). Later lines of a response carry grown usage: the largest of each is kept |
| `cost_usd` | double | estimated at list rates (below); null for a user turn, a synthetic turn or an unknown model |
| `since_parent_ms` | long | the turn's time minus its parent line's: for an assistant turn, roughly the API latency; for a user turn, the gap since the previous message |
| `lines` | integer | transcript lines folded into the document |
| `file` | keyword | the transcript path under `~/.claude/projects/` |

### Rates

List prices, USD per million tokens, Anthropic first-party API as of
2026-10. Cache writes cost 1.25x input for the 5-minute TTL and 2x input for
the 1-hour TTL (the transcript records both). A model id's date suffix and
`[1m]` are stripped before the lookup.

| Model | Input | Output | Cache read |
| --- | --- | --- | --- |
| claude-fable-5-1, claude-mythos-5-1 | 10 | 50 | 0.25 |
| claude-fable-5 | 10 | 50 | 1.00 |
| claude-opus-5-5 | 4 | 20 | 0.20 |
| claude-opus-5, -4-8, -4-7, -4-6, -4-5 | 5 | 25 | 0.50 |
| claude-sonnet-5-5, claude-sonnet-5 | 2 | 10 | 0.20 |
| claude-sonnet-4-6, -4-5 | 3 | 15 | 0.30 |
| claude-haiku-5-5 | 0.10 | 0.50 | 0.01 |
| claude-haiku-4-5 | 1 | 5 | 0.10 |

Check against Claude Code's own figure: the transcripts also hold
`cost-state` lines with Claude Code's running `totalCostUSD` per session.
Over the 265 sessions that have one, Claude Code says $11,790 and this
estimate says $10,335 (12% under); 13 sessions differ by more than 1.5x
either way. Not reconciled: see follow-ups.

## Example aggregations

Results from the first full run (2026-10-19, 164,805 documents: 150,056
assistant and 14,749 user turns, from 3,665 files and 395 sessions).

Tokens and cost per session (the five costliest):

```sh
curl -s --cacert "$(mkcert -CAROOT)/rootCA.pem" -u "elastic:$(op read op://Infrastructure/Elasticsearch/elastic_password)" \
  -H 'content-type: application/json' 'https://es.newegypt.io/cc-turns/_search?size=0' -d '{
  "query": {"term": {"role": "assistant"}},
  "aggs": {"sessions": {"terms": {"field": "session_id", "size": 5, "order": {"cost": "desc"}}, "aggs": {
    "title": {"terms": {"field": "session_title", "size": 1}},
    "input": {"sum": {"field": "usage.input"}}, "cache_read": {"sum": {"field": "usage.cache_read"}},
    "cache_write": {"sum": {"field": "usage.cache_write"}}, "output": {"sum": {"field": "usage.output"}},
    "cost": {"sum": {"field": "cost_usd"}}}}}}'
```

| session | title | turns | input | cache read | cache write | output | cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4a49d55d | Orchestrator handoff documentation | 10,469 | 21,342 | 2,239,448,768 | 177,058,188 | 5,000,963 | $1,450.64 |
| f9b13a93 | Genos clone feature planning | 15,442 | 30,912 | 2,812,743,723 | 51,488,528 | 12,192,108 | $1,071.32 |
| 99266efc | /clear clear | 3,404 | 6,806 | 652,478,964 | 11,899,631 | 2,834,344 | $486.29 |
| 806bdee8 | Repository status check | 2,842 | 10,786 | 593,049,829 | 32,816,543 | 606,149 | $385.42 |
| 95a72ce6 | [yahaha] Sounds and racks redesign | 6,094 | 12,216 | 1,121,706,045 | 19,385,391 | 1,608,104 | $352.12 |

Cost per project per day (the five costliest projects since 2026-10-13):

```sh
... -d '{
  "query": {"range": {"day": {"gte": "2026-10-13"}}},
  "aggs": {"projects": {"terms": {"field": "project", "size": 5, "order": {"cost": "desc"}}, "aggs": {
    "cost": {"sum": {"field": "cost_usd"}},
    "days": {"terms": {"field": "day", "size": 30, "order": {"_key": "asc"}}, "aggs": {"cost": {"sum": {"field": "cost_usd"}}}}}}}}'
```

| project | 10-13 | 10-14 | 10-15 | 10-16 | 10-17 | 10-18 | 10-19 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| satoramoto/awesome-claude | 52.51 | 165.06 | 53.71 | 11.35 | 56.36 | 82.48 | |
| satoramoto/syns | | 0 | 6.90 | 32.15 | 91.70 | 42.72 | 3.41 |
| satoramoto/zen | 147.02 | 22.10 | | | | 0.41 | 1.93 |
| satoramoto/bloom | | | | | | 54.48 | 3.60 |
| maya/stereogram | | | | | 31.14 | 4.89 | |

Turns per model:

```sh
... -d '{
  "query": {"term": {"role": "assistant"}},
  "aggs": {"models": {"terms": {"field": "model", "size": 20}, "aggs": {
    "cost": {"sum": {"field": "cost_usd"}}, "output": {"sum": {"field": "usage.output"}}}}}}'
```

| model | turns | output tokens | cost |
| --- | --- | --- | --- |
| claude-opus-5-5 | 109,147 | 43,570,679 | $7,791.96 |
| claude-opus-5 | 23,828 | 20,820,734 | $4,129.98 |
| claude-sonnet-5-5 | 6,602 | 640,484 | $204.61 |
| claude-fable-5-1 | 6,547 | 6,631,244 | $1,468.46 |
| claude-fable-5 | 1,852 | 1,810,480 | $630.31 |
| claude-sonnet-5 | 1,736 | 459,437 | $54.54 |
| `<synthetic>` | 171 | 0 | 0 |
| claude-haiku-4-5-20251001 | 150 | 33,511 | $1.44 |
| claude-haiku-5-5 | 23 | 170 | $0.05 |

Also handy: `terms` on `pod`, `tool_uses.name` or `is_sidechain`;
`percentiles` on `since_parent_ms` (first run: median 2.8 s, p90 11.1 s, p99
48.7 s per assistant turn) and on `tool_uses.tool_ms`; a `filter` on
`is_person` for the person's own prompts.

## Decisions

- **One document per API response, not per transcript line.** A line is a
  content block; its usage is the whole response's, so per-line documents
  would count tokens several times over.
- **Subagent transcripts are in.** They hold most of the tokens (111k of the
  165k turns are sidechain). `agent_id` and `is_sidechain` tell them apart;
  `session_id` is the parent session's, so a per-session sum includes its
  agents.
- **`project` comes from the line's `cwd`, not the folder name.** The folder
  name (`project_dir`) is the cwd with every `/` and ` ` turned into `-`,
  which can't be decoded back; the cwd is on every line.
- **`day` is the local day**, matching how the focus analyzer buckets.
- **Text is truncated at 4000 characters**, enough to search and read, small
  enough to keep the index around 200 MB.
- **The mapping is strict**, so a new transcript field is a deliberate change
  here, not a surprise in the index.
- **Pods are looked up by the app's `local_<id>`**, since that is what
  brain.json and the ledger record; the app's session records give the
  mapping to the CLI id.

## Not indexed, and why

- `tool_result` content and `toolUseResult` objects: most of a transcript's
  bytes (command output, file contents); only the size, error flag and timing
  are kept on the tool use.
- Thinking text: empty in the transcripts of current models; the token count
  is in `usage.thinking`.
- `attachment`, `system`, `queue-operation`, `file-history-*`, `pr-link`,
  `worktree-state`, `permission-mode`, `mode`, `atis-latch`, `bridge-session`
  and the other bookkeeping line types: not turns. `custom-title`, `ai-title`
  and `agent-name` feed `session_title`; the rest are skipped.
- `cost-state` lines (Claude Code's own running cost and duration per
  session): a per-session figure, not a turn; used above only as a check.
- Images in user messages: only their text blocks are kept.
- `api-request*` lines (request shapes): nothing a turn doesn't already say.

## Follow-ups

- Codex transcripts (`~/.codex/sessions/**`): a second reader into the same
  index with `harness: codex`, or its own.
- A scheduled run (`--since` the last run) so the index stays current.
- A dashboard pane over the index (the Analysis tab, or a new one).
- Reconcile the cost estimate with `cost-state` per session: find why 13
  sessions differ by more than 1.5x (resumed sessions, retries, or a rate
  difference) and index `cost-state` as a per-session document.
- Lineage below the pod (ask > job > agent > turn): `prompt_id` and
  `parent_session_id` are in; the ledger's job ids are not yet tied to
  sessions.
