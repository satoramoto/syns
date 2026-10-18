# Epics

An epic is one ambitious goal that needs planning: its approach, the
outcomes that say it worked, the jobs that prove them, the open questions.
One folder from proposal through review, approval, delivery and revision.
State in JSON, prose in markdown.

## Where they live

`~/.syns/epics/<id>/`, one folder per epic:

`epic.json` (the state the commands read and write), `proposal.md` (the
argument: problem, approaches considered, why the chosen one) and
`page.html` (the published page, its url under `evidence`).

Example: `~/.syns/epics/proposal-system/`; keep the shape equal to it.

## The shape

| Field | Holds |
| --- | --- |
| `id`, `thread`, `mode` | kebab-case name, the brain thread, the work mode |
| `rev`, `revisions` | current revision; `{ rev, at, note }` per revision |
| `status` | see the lifecycle below |
| `goal`, `why` | what is true when it's done, and why it matters |
| `approach` | `chosen`, plus `alternatives` as `{ what, whyNot }` |
| `assumptions`, `dependencies` | plain strings |
| `risks` | `{ what, then }`: the risk and what we do if it lands |
| `approval` | the inbox item id of its approval |
| `questions` | inbox item ids of its questions (never the approval) |
| `decisions` | inbox item ids answered for it |
| `outcomes` | `{ id, text, by, job, proof, status, proofs }`, the acceptance |
| `jobs` | `{ id, what, owner, mode, state, outcomes, commit?, repo?, files?, at }` |
| `evidence` | `{ kind, url, note }` |
| `links` | `parent`, `supersedes`, `feeds` (other epic ids) |
| `raisedBy`, `raisedAt` | who drafted it and when |

An outcome's `by` is how it is settled: `test`, `derivation`, `measurement`
or `review`. `job` is the job that settles it; `proof` is the plan, one line
naming the artifact that will show it. `status` is `open`, `proven`,
`refuted` or `dropped`. `proofs` are the artifacts that did settle it, each
`{ kind: page|file|pr|run, url | path, note, at }`, something Ryan can open.
Every job names at least one outcome (`outcomes`, by id) it serves.

Every inbox item raised for an epic (its questions and its approval) carries
`"epic": "<id>"`. That field is how `/syn:inbox` knows an approval belongs to
an epic; an `applies` naming its `epic.json` is only the fallback.

## The outcome rule

- An outcome is settled by this epic's own jobs, and names the job and the
  proof that will settle it.
- Anything only a later epic can settle belongs to that epic: link it under
  `links.feeds` and make it an outcome there.
- The proof plan comes before the job list: jobs exist to produce proofs.
- Jobs done is not the epic done. An epic is done when every outcome is
  `proven`, or `dropped` with its reason in the ledger.

Bad: "the next epic is drafted with this shape" (only a later epic shows
it). Good: "a test-run page shows every epic.json's jobs name an outcome".

When a job reports done, the session records its proofs: each outcome it
settles gets the artifact appended to `proofs`, its `status` set to `proven`
(or `refuted`), and one `outcome.status` ledger line.

## Lifecycle

`draft` → `review` → `approved` | `rejected`; then `approved` → `active` →
`done` | `dropped`. `draft` and `review` are the proposal phase; the rest is
delivery. A revision keeps `review` and raises `rev`. Every status change is
one ledger line.

## Commands

- `/syn:propose <ask>`: a developer agent explores two or three approaches,
  writes the folder (proof plan first, then jobs), raises its questions and
  one approval (not reversible, blocks M1) in the inbox, and sets `review`.
  It never reviews.
- `/syn:review <id>`: optional. One reviewer agent lists real gaps; the ones
  Ryan confirms become inbox questions. Never changes `status`.
- `/syn:inbox`: answering an epic's approval sets its `status` (Approve →
  `approved`, Reject → `rejected`, Revise → `review`, rev + 1) and writes the
  ledger line. It first takes any decision already made on the page.
- `epic-decision` (a skill, no command): "approve <id>", "reject <id>" or
  "revise <id>: <note>" in any session applies the same decision.
- `/syn:start <id> [at <time>]`: starts an approved epic now, or schedules
  the start. It first takes any Start requested on the page (`starts/<id>`,
  below), as `/syn:inbox` does.
- `epic-start` (the skill behind `/syn:start`): "start <id>" or "schedule
  <id> for <time>" in any session, Start on the epic's page and Start on the
  dashboard all run it. A start is, in order: the guard (`status` must be
  `approved`; anything else is refused in one line and nothing changes), the
  brief (`brief.md` in the epic's folder, generated from `epic.json` alone),
  the session (fresh, local, in the first job's `repo`, else `~/.syns`, on
  the starting session's model), and the record (`status: "active"`, one
  `epic.status` line, the page's `starts/<id>` doc). A schedule is the guard
  and the brief now, one one-time desktop scheduled task (`fireAt`, task id
  `epic-start-<id>`) whose prompt is `/syn:start <id>` with the door
  `schedule`, one `epic.scheduled` line, and the doc; scheduling the same
  epic again replaces its task and writes another `epic.scheduled` line.

## Deciding on the page

The proposal page (`page.html`, filled from `templates/epic-page.html`,
published with the capabilities `comments` (composer only), `db` and `user`)
has an Approval row. Approve and reject arm on the first click and save on
the second, to the artifact's db document `approvals/<epic id>`:

| Field | Holds |
| --- | --- |
| `decision` | `approve` or `reject` (a session may also write `revise`) |
| `rev` | the epic's rev the decision is on |
| `inbox` | the approval item's id; the page shows only its current one |
| `at` | when, ISO time |
| `by` | `page`, or the door a session decided through: `inbox`, `words` |
| `note` | optional, Ryan's note |

Revise opens a comment on the row instead; comments reach the session that
published the page. The page, the quiz in `/syn:inbox` and the spoken
decision are three doors to one procedure, the plugin's `epic-decision`
skill: `status` and `decisions` in `epic.json`, one ledger line (`via:
"inbox <id>"`, the door in `note`), the approval item answered, and, for the
quiz and words, the db document written so the page shows it.

## Starting on the page

An approved epic's page has a Start row (start now, or at a time). It arms
on the first click and saves on the second, to the db document
`starts/<epic id>`; the next `/syn:inbox` or `/syn:start` reads it and runs
`epic-start` with the door `page`. A session that starts another way writes
the same document so the page shows it:

| Field | Holds |
| --- | --- |
| `action` | `start` or `schedule` |
| `state` | `requested` (the page wrote it), `started` or `scheduled` (a session applied it), `refused` (with `note`) |
| `fireAt` | for a schedule: when, ISO time with offset |
| `rev` | the epic's rev |
| `at` | when, ISO time |
| `by` | the door: `page`, `words`, `dashboard`, `schedule` |
| `session` | once started: the started session's name |
| `note` | optional |

## Ledger lines

`~/.syns/memory.jsonl` is append-only, one JSON object per line:

```json
{"id":"<epic id>-0004","parent":"<epic id>","at":"2026-10-17T06:48:18Z",
 "event":"epic.status","from":"review","to":"approved","by":"Ryan","via":"inbox 29","note":"..."}
```

`id` is `<epic id>-NNNN`, a four-digit count of that epic's lines (the first
seven lines, `ps-0001`…`ps-0007`, predate this); `parent` is the epic id;
`at` is UTC; `via` names the inbox item that caused it; `note` is optional
(for a dropped outcome, the reason). Events: `epic.status`, `epic.revised`
(adds `rev`), `job.state` (`job`, `owner`, `outcomes`), `outcome.status`
(`outcome`, `from`, `to`, `proof`: the artifact's url or path),
`epic.scheduled` (`fireAt`, `task`, `door`).

A start is the `epic.status` line `approved` → `active`, `via` the epic's
approval, with `door` (`words`, `page`, `dashboard`, `schedule`, or `hand`
for a start made without the skill) and `session` (the started session's
name). It never comes without an `approved` line before it. A schedule is
one `epic.scheduled` line, `via` the approval, with `fireAt` (ISO time with
offset), `task` (the scheduled task's id) and `door`; when it fires, the
start line follows it and the gap between its `at` and the `fireAt` is the
scheduler's lag. A start line written before this rule (`bloom-swarm-0009`,
`epic-start-0004`) carries the door and session in `note` instead ("started
by hand …, session …") and may lack `via`.
