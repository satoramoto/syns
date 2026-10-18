---
description: Start an approved epic now, or schedule its start, with the epic-start skill
argument-hint: <epic id> [at <time>] [--door dashboard]
---

Start or schedule an approved epic with the `epic-start` skill
(`plugin/skills/epic-start/SKILL.md` in the syns repo); that skill is the
procedure, this command only picks the epic and the door.

1. **Page requests first.** For every epic in `~/.syns/epics/*/epic.json`
   with `status: "approved"` and a proposal page under `evidence`, read
   `starts/<epic id>` from that page's db (ArtifactData, `action: "get"`,
   `collection: "starts"`, `doc_id` the epic id). A doc with `state:
   "requested"` and `by: "page"` is Ryan's ask: apply it with `epic-start`,
   door `page` (`action: "schedule"` with its `fireAt` is a schedule,
   `start` a start). No doc, any other state, or no ArtifactData tool:
   leave it.
2. **Then the arguments**, `$ARGUMENTS`: the epic id, an optional time
   ("at <time>", "for <time>", "tomorrow 9am"), and the door. The door is
   `dashboard` when the arguments end in `--door dashboard` (the dashboard's
   Start passes it), `schedule` when they say "with the door schedule" (a
   scheduled task's prompt), else `words`. An epic already started by step 1
   is not started again (the guard refuses it). No arguments: step 1 alone,
   and name the approved epics that could start.
3. End with one line per epic touched: started (the session, the ledger
   id), scheduled (when, the task id) or refused (its status).
