---
description: Where are we, what are we doing, and why - three short paragraphs for this channel, from state on disk
allowed-tools: Read, mcp__ccd_session_mgmt__get_session
---

The user wants to know, for this channel, where we are, what we are doing,
and why. Answer in three short paragraphs, from state on disk, in a few
seconds. No preamble, no questions, no other work, no sidebar tidying.

## Read

- The brain file: `$SYN_BRAIN`, or `~/.syns/brain.json` when that's unset.
  Read it once; it is the only file you need unless the pod has an epic.
- This session's id: `mcp__ccd_session_mgmt__get_session` with
  `{"session_id": "self"}`.
- The channel is the pod whose `lead` equals this id, or whose `sessions`
  contains it. If neither matches, the pod whose `repos` contains the
  current working directory's repo (a worktree counts as its main checkout).
- If the pod lists `epics`, read `~/.syns/epics/<id>/epic.json` for the
  newest one that isn't `done`, `dropped` or `rejected` (else the newest),
  and the `## Intent` section of its `blueprint.md` (or `proposal.md` when
  there is no blueprint) for Ryan's words.

Read nothing else: no transcripts, no `gh`, no other sessions.

## Answer

Three paragraphs, each under 80 words, plain words, in this order and with
these bold leads:

**Where we are.** The pod (id and title), this session's role in it (lead,
or task with its title), the epic if any with its `status` and `rev`, and
which step of the loop the current work is in, in one phrase. Infer the
step from the epic:

| Epic state | Step |
| --- | --- |
| `status` is `draft` or `review`, or `approved` and not started | Plan |
| `active` with jobs in `asked` or `running` (or `working`) | Refract |
| `active`, every job landed (`committed`, `merged`, `done`) and the checks over the whole are what's left | Integrate |
| `active`, reviews and outcome verdicts in flight (outcomes `open` with proofs arriving) | Score |
| outcomes being proven and the epic closing (`done`, or every outcome settled) | Merge |

Without an epic, read the pod's `state` and `next` for the same phrase (a
pod that is only planning is in Plan; one with task sessions running is in
Refract) and say it is inferred from the pod, not an epic.

**What we are doing.** The pod's `state` (its latest entry only) and
`next`, the running jobs (an epic's jobs not `done`, each with the outcome
ids it proves) or, without an epic, the pod's task sessions by count, and
what waits on Ryan from the inbox for this pod: every item with `status`
not `answered` whose `pod` is this pod or whose `epic` is one of the pod's
epics, by id, approvals first, one short clause each.

**Why.** The pod's `why`, then the epic's Intent: Ryan's verbatim words
from the blueprint, quoted (`>`), trimmed to the first few lines if long.
Without an epic, the pod's `why` alone.

## No pod

If this session is in no pod, say so in one line, then answer the three
questions for the board as a whole: the brain's `outcome` and `period`,
and the pods by `priority`, one line each (id, state's latest entry, next).
Open inbox items by count only.

If the brain file is missing, say so and suggest `/syn:onboard`.
