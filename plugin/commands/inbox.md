---
description: Run through the inbox in BRAIN.md as a quiz, then apply the answers
---

Run the user through their inbox, then apply what they decide. This is M1 of
syn: the smallest version of the approval loop.

1. Read `inbox` in the brain file (the path in `$SYN_BRAIN`, or
   `~/.syns/brain.json` when that's unset), taking the items with `status: "open"`. Order them: approvals first, then
   questions whose `blocks` isn't empty, then the rest.
2. Before asking: for every open approval with an `epic` whose epic has a
   proposal page under `evidence`, read `approvals/<epic id>` from that
   artifact's db (ArtifactData, `action: "get"`, `collection: "approvals"`,
   `doc_id` the epic id). A document with `by: "page"`, `inbox` equal to the
   item's id and a `decision` of approve or reject is Ryan's answer: apply it
   with the `epic-decision` skill (door `page`) without asking, and leave
   the item out of the quiz. Anything else (no document, an earlier
   approval's, no ArtifactData tool) leaves the item for the quiz.
2b. Then, still before asking: for every epic in `~/.syns/epics/*/epic.json`
   with `status: "approved"` and a proposal page under `evidence`, read
   `starts/<epic id>` from that page's db (ArtifactData, `action: "get"`,
   `collection: "starts"`, `doc_id` the epic id). A document with `state:
   "requested"` and `by: "page"` is Ryan's Start: apply it with the
   `epic-start` skill (door `page`; `action: "schedule"` with its `fireAt`
   is a schedule, `start` a start) without asking. Any other state, no
   document, or no ArtifactData tool: leave it. Epics approved in step 2
   are swept too.
3. Ask with the question tool, up to 4 items per call, using each item exactly
   as stored:
   - the question is its `question`;
   - the header is its kind and id (e.g. "Approval 14");
   - the options are its `options`, in order, with the one at `recommended`
     first and labelled "(Recommended)".
   The user can always answer "Other".
4. After each batch, apply the answers right away:
   - do what the item's `applies` names, using the chosen option;
   - set the item's `status` to "answered" and its `answer` to
     `{ choice, note?, at }`, then move it from `inbox` to `answered`;
   - an approval (`reversible: false`) means the action may now happen, so do
     it, or hand it to an assistant.
   - an item whose `pod` is not this session's pod is applied by that pod's
     lead: send it the answer (SendMessage to the lead's session id, from
     brain.json `pods[].lead`) and let the lead do or start the work, so any
     task session nests under its own lead. Never start another pod's task
     from here; if the pod has no lead, say so in the closing line and leave
     the item answered but unapplied.
   - an approval with an `epic` field (or, failing that, whose `applies`
     names an epic's `epic.json`) is applied by the `epic-decision` skill
     (door `inbox`): the epic's `status` and `decisions`, the ledger line,
     the item answered, and the page's db document written so the page
     shows it.
   A dismissed batch changes nothing.
5. Keep going batch by batch until the inbox is empty or the user stops.
   Never ask anything outside the inbox during the run.
6. End with one line: how many were answered (and how many on a page),
   what's left, what each answer unblocked, and any epic started or
   scheduled from its page.
