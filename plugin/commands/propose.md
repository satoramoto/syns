---
description: Propose an epic from an ask into ~/.syns/epics/<id>/ and put it up for Ryan's review
argument-hint: <ask>
---

Turn the ask in `$ARGUMENTS` into an epic, starting with its proposal, which
Ryan reviews and approves through the inbox. The shape and the promise rule
are in `docs/epics.md`; the example is
`~/.syns/epics/proposal-system/epic.json`. Read both first.

1. Pick a short kebab-case `id` for the epic (e.g. `bloom-swarm`) that isn't
   already a folder under `~/.syns/epics/`, and the brain thread it belongs
   to (the brain file is `$SYN_BRAIN`, or `~/.syns/brain.json`).
2. Brief one `developer` agent (Opus) with the ask, the id, the thread and
   the two shape files. Its outcome: two or three real approaches explored
   against the code and docs involved, one chosen, and two files written in
   `~/.syns/epics/<id>/`:
   - `epic.json` with exactly the fields of the example, nothing added:
     `status: "draft"`, `rev: 1`, one `revisions` entry (`"first draft"`),
     `questions` and `decisions` empty, `raisedBy` the agent's model;
   - `proposal.md` holding the argument: the problem, each approach
     considered with what it costs, and why the chosen one wins.

   The brief states the promise rule, and the agent follows it in this
   order. First the promises: each with `by` (`test`, `derivation`,
   `measurement` or `review`), `status: "open"`, `proofs: []`, and its
   proof plan in `proof`, one line naming the artifact Ryan will be able to
   open (a page, a file, a PR, a run) that shows it. Then the jobs (M1, state
   `asked`), which exist to produce those proofs: every promise names in
   `job` one of this epic's jobs that settles it, and every job lists the
   promises it serves. A promise only a later epic can settle is not this
   epic's: drop it here, and name that epic under `links.feeds`. When a job
   reports done, the session records its proofs: the artifact appended to
   the promise's `proofs`, `status` set to `proven` (or `refuted`), and one
   `promise.status` ledger line; the epic is done only when every promise is
   proven or dropped with its reason in the ledger, not when the jobs are.

   It returns its open questions, each with options and a recommendation.
   It writes nothing else and asks Ryan nothing.
3. Append one ledger line to `~/.syns/memory.jsonl` (see the doc for the
   shape): `epic.status`, `from: null`, `to: "draft"`.
4. Raise the inbox items in the brain file, ids continuing from the highest
   id in `inbox` and `answered`:
   - each open question as `kind: "question"`, its recommended option first
     (`recommended: 0`), `reversible: true`, `blocks` naming what waits on it;
   - one `kind: "approval"` for the proposal itself, `reversible: false`,
     `blocks: ["<id> M1"]`, options Approve, Revise, Reject (in that order,
     Approve recommended), and `applies: "~/.syns/epics/<id>/epic.json
     status"`.
   Every item gets `"epic": "<id>"`, `thread`, `raisedBy`, `raisedAt` and
   `status: "open"`. Put the question ids in the epic's `questions` and the
   approval's id in its `approval`.
5. Set the epic's `status` to `"review"` and append the ledger line
   `from: "draft"`, `to: "review"`. If the Artifact tool is available,
   publish the proposal as a private page from `~/.syns/epics/<id>/page.html`
   and record its url under `evidence` (`kind: "page"`).
6. End with one line: the folder path and how many questions are open.

Ryan is the reviewer. Never run a review here; `/syn:review <id>` is his to
ask for.
