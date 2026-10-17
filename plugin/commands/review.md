---
description: Optional automated pass over an epic's proposal; its gaps become inbox questions if the user confirms
argument-hint: <epic id>
---

Give the epic `$ARGUMENTS` one automated review. This is optional: Ryan is
the reviewer, and this pass only feeds him.

1. Read `~/.syns/epics/<id>/epic.json` and `proposal.md`. If the folder
   doesn't exist, say so and stop.
2. Send one `reviewer` agent (Sonnet) over both files, with `docs/epics.md`
   for the shape and the promise rule. Its outcome: the real gaps only, each
   one sentence naming the field or promise it is about:
   - promises that break the promise rule: no `job` of this epic settles
     them, no `proof` plan names an artifact Ryan can open, `by` can't
     settle them, or only a later epic could;
   - jobs that serve no promise;
   - risks the approach plainly carries that `risks` leaves out;
   - questions or inbox items without a recommendation;
   - an approach in `proposal.md` that the JSON contradicts.
   No style notes, no rewrites. It edits nothing.
3. Show the user its findings as one numbered list, and ask once whether to
   add them to the inbox (all, some by number, or none).
4. For each one confirmed, add a `kind: "question"` item to the brain file
   (`$SYN_BRAIN`, or `~/.syns/brain.json`), the id continuing from the
   highest in `inbox` and `answered`, with options and the recommended one
   first, `reversible: true`, `"epic": "<id>"`, `thread` from the epic,
   `raisedBy: "/syn:review"`, `status: "open"`, `applies` naming the epic.
   Add its id to the epic's `questions`.
5. End with one line: how many gaps were found and how many went to the
   inbox.

Never change the epic's `status` or `rev`, and write no ledger line.
