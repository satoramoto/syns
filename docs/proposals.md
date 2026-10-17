# Proposals

A proposal is one bet: a goal, the approach chosen for it, the claims that
say it worked, and the questions still open. It stays one file from draft
through review, approval, execution and revision. State in JSON, prose in
markdown.

## Where they live

`~/.syns/proposals/<id>/`, one folder per proposal:

- `proposal.json`: the state, read and written by the commands;
- `proposal.md`: the argument (problem, approaches considered, why the
  chosen one);
- a published page, when there is one, recorded under `evidence`.

The example is `~/.syns/proposals/proposal-system/`. Keep the shape equal to
it until a second proposal disagrees.

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
| `claims` | `{ id, text, verifier, status }`, the acceptance |
| `jobs` | `{ id, what, owner, mode, state, claims, repo?, files?, at }` |
| `evidence` | `{ kind, url, note }` |
| `links` | `parent`, `supersedes`, `feeds` (other proposal ids) |
| `raisedBy`, `raisedAt` | who drafted it and when |

A claim's `verifier` is how it gets settled: `test`, `proof`, `measurement`
or `review`. Its `status` is `open`, `verified` or `refuted`. Every job names
at least one claim it serves.

Every inbox item raised for a proposal (its questions and its approval)
carries `"proposal": "<id>"`. That field is how `/syn:inbox` knows an
approval belongs to a proposal; an `applies` naming its `proposal.json` is
only the fallback.

## Lifecycle

`draft` → `review` → `approved` | `rejected`; then `approved` → `active` →
`done` | `dropped`. A revision keeps `review` and raises `rev`. Every status
change is one ledger line.

## Commands

- `/syn:propose <ask>`: a developer agent explores two or three approaches,
  writes the folder, raises its questions and one approval (not reversible,
  blocks M1) in the inbox, and sets `review`. It never reviews.
- `/syn:review <id>`: optional. One reviewer agent lists real gaps; the ones
  Ryan confirms become inbox questions. Never changes `status`.
- `/syn:inbox`: answering a proposal's approval sets its `status`
  (Approve → `approved`, Reject → `rejected`, Revise → `review`, rev + 1)
  and writes the ledger line.

## Ledger lines

`~/.syns/memory.jsonl` is append-only, one JSON object per line:

```json
{"id":"<proposal id>-0004","parent":"<proposal id>","at":"2026-10-17T06:48:18Z",
 "event":"proposal.status","from":"review","to":"approved","by":"Ryan","via":"inbox 29","note":"..."}
```

`id` is `<proposal id>-NNNN`, a four-digit count of that proposal's lines
(the first seven lines, `ps-0001`…`ps-0007`, predate this); `parent` is the
proposal id; `at` is UTC. `via` names the inbox item when
one caused it; `note` is optional. Other events (`proposal.revised`,
`job.state`) add their own fields (`rev`, `job`, `claims`, `owner`).
