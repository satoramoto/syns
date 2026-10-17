---
description: Draft a proposal from an ask into ~/.syns/proposals/<id>/ and put it up for Ryan's review
argument-hint: <ask>
---

Turn the ask in `$ARGUMENTS` into a proposal Ryan can review and approve
through the inbox. The shape is `docs/proposals.md`; the example is
`~/.syns/proposals/proposal-system/proposal.json`. Read both first.

1. Pick a short kebab-case `id` for the bet (e.g. `bloom-swarm`) that isn't
   already a folder under `~/.syns/proposals/`, and the brain thread it
   belongs to (the brain file is `$SYN_BRAIN`, or `~/.syns/brain.json`).
2. Brief one `developer` agent (Opus) with the ask, the id, the thread and
   the two shape files. Its outcome: two or three real approaches explored
   against the code and docs involved, one chosen, and two files written in
   `~/.syns/proposals/<id>/`:
   - `proposal.json` with exactly the fields of the example, nothing added:
     `status: "draft"`, `rev: 1`, one `revisions` entry (`"first draft"`),
     every claim with a verifier (`test`, `proof`, `measurement` or
     `review`) and `status: "open"`, M1 as `jobs` in state `asked`,
     `questions` and `decisions` empty, `raisedBy` the agent's model;
   - `proposal.md` holding the argument: the problem, each approach
     considered with what it costs, and why the chosen one wins.
   It returns its open questions, each with options and a recommendation.
   It writes nothing else and asks Ryan nothing.
3. Append one ledger line to `~/.syns/memory.jsonl` (see the doc for the
   shape): `proposal.status`, `from: null`, `to: "draft"`.
4. Raise the inbox items in the brain file, ids continuing from the highest
   id in `inbox` and `answered`:
   - each open question as `kind: "question"`, its recommended option first
     (`recommended: 0`), `reversible: true`, `blocks` naming what waits on it;
   - one `kind: "approval"` for the proposal itself, `reversible: false`,
     `blocks: ["<id> M1"]`, options Approve, Revise, Reject (in that order,
     Approve recommended), and `applies:
     "~/.syns/proposals/<id>/proposal.json status"`.
   Every item gets `"proposal": "<id>"`, `thread`, `raisedBy`, `raisedAt`
   and `status: "open"`. Put the question ids in the proposal's `questions`
   and the approval's id in its `approval`.
5. Set the proposal's `status` to `"review"` and append the ledger line
   `from: "draft"`, `to: "review"`. If the Artifact tool is available,
   publish the proposal as a private page and record its url under
   `evidence` (`kind: "page"`).
6. End with one line: the folder path and how many questions are open.

Ryan is the reviewer. Never run a review here; `/syn:review <id>` is his to
ask for.
