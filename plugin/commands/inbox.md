---
description: Run through the inbox in BRAIN.md as a quiz, then apply the answers
---

Run the user through their inbox, then apply what they decide. This is M1 of
syn: the smallest version of the approval loop.

1. Read `inbox` in the brain file (the path in `$SYN_BRAIN`, or
   `~/.syns/brain.json` when that's unset), taking the items with `status: "open"`. Order them: approvals first, then
   questions whose `blocks` isn't empty, then the rest.
2. Ask with the question tool, up to 4 items per call, using each item exactly
   as stored:
   - the question is its `question`;
   - the header is its kind and id (e.g. "Approval 14");
   - the options are its `options`, in order, with the one at `recommended`
     first and labelled "(Recommended)".
   The user can always answer "Other".
3. After each batch, apply the answers right away:
   - do what the item's `applies` names, using the chosen option;
   - set the item's `status` to "answered" and its `answer` to
     `{ choice, note?, at }`, then move it from `inbox` to `answered`;
   - an approval (`reversible: false`) means the action may now happen, so do
     it, or hand it to an assistant.
   - an approval with a `proposal` field (or, failing that, whose `applies`
     names a proposal's `proposal.json`) also sets that proposal's `status`: Approve → `"approved"`, Reject →
     `"rejected"`, Revise → stays `"review"` with `rev` raised by one and a
     `revisions` entry `{ rev, at, note }` carrying the answer's note. Add
     the item's id to the proposal's `decisions`, and append one line to
     `~/.syns/memory.jsonl`: `event: "proposal.status"`, `from`, `to`,
     `by: "Ryan"`, `via: "inbox <id>"` (shape in `docs/proposals.md`).
   A dismissed batch changes nothing.
4. Keep going batch by batch until the inbox is empty or the user stops.
   Never ask anything outside the inbox during the run.
5. End with one line: how many were answered, what's left, and what each
   answer unblocked.
