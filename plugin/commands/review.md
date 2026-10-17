---
description: Optional automated pass over a proposal; its gaps become inbox questions if the user confirms
argument-hint: <proposal id>
---

Give the proposal `$ARGUMENTS` one automated review. This is optional: Ryan
is the reviewer, and this pass only feeds him.

1. Read `~/.syns/proposals/<id>/proposal.json` and `proposal.md`. If the
   folder doesn't exist, say so and stop.
2. Send one `reviewer` agent (Sonnet) over both files, with
   `docs/proposals.md` for the shape. Its outcome: the real gaps only, each
   one sentence naming the field or claim it is about:
   - claims nobody could verify, or whose verifier can't settle them;
   - risks the approach plainly carries that `risks` leaves out;
   - questions or inbox items without a recommendation;
   - an approach in `proposal.md` that the JSON contradicts.
   No style notes, no rewrites. It edits nothing.
3. Show the user its findings as one numbered list, and ask once whether to
   add them to the inbox (all, some by number, or none).
4. For each one confirmed, add a `kind: "question"` item to the brain file
   (`$SYN_BRAIN`, or `~/.syns/brain.json`), the id continuing from the
   highest in `inbox` and `answered`, with options and the recommended one
   first, `reversible: true`, `thread` from the proposal, `raisedBy:
   "/syn:review"`, `status: "open"`, `applies` naming the proposal. Add its
   id to the proposal's `questions`.
5. End with one line: how many gaps were found and how many went to the
   inbox.

Never change the proposal's `status` or `rev`, and write no ledger line.
