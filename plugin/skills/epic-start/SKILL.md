---
name: epic-start
description: Start an approved epic now, or schedule its start, through one procedure - the brief generated from epic.json, a fresh session, status approved → active, the ledger line and the page's starts doc. Use when Ryan says "start <epic id>", "start the <x> epic", "schedule <id> for <time>", "start <id> at <time>", when /syn:inbox or /syn:start finds a Start requested on an epic's page (starts/<id> in its db), when the dashboard's Start runs /syn:start, when a scheduled task runs /syn:start <id> with the door schedule, and for /syn:start itself.
argument-hint: <epic id> [at <time>]
---

The one procedure for starting an approved epic. Four doors lead here and
all apply it the same way: Ryan in words ("start bloom-swarm", "schedule
<id> for tomorrow 9am"), the Start row on the epic's page (read by
`/syn:inbox` and `/syn:start`), the dashboard's Start button (it runs
`/syn:start <id> --door dashboard`) and a scheduled task that fires (it runs
`/syn:start <id>` with the door `schedule`). The shape of `epic.json`, the
`starts/<id>` doc and the ledger is in the syns repo's `docs/epics.md`
(Commands, Starting on the page, Ledger lines).

## Inputs

- the epic id, and its folder `~/.syns/epics/<id>/` (no folder: say so,
  stop);
- the door: `words`, `page`, `dashboard` or `schedule`;
- an optional time: "at <time>" or "for <time>" in words, `fireAt` on a page
  doc whose `action` is `schedule`. A time makes it a schedule; none makes
  it a start. Read the time in Ryan's local zone and turn it into ISO time
  with the offset (`2026-10-19T09:00:00+02:00`). A time already past is a
  start now; say so.

The brain file is `$SYN_BRAIN`, or `~/.syns/brain.json`; the ledger is
`~/.syns/memory.jsonl`. The page is the `evidence` entry with `kind: "page"`
whose note begins "the proposal page"; its db doc is `starts/<id>`
(ArtifactData, `collection: "starts"`, `doc_id` the epic id).

Words take this procedure only when they name an epic that has a folder;
"start" alone is ambiguous when more than one epic is `approved`, so name
those and start none.

## 1. Guard

Read `epic.json`. `status` must be `approved`. Anything else (`draft`,
`review`, `rejected`, `active`, `done`, `dropped`) is refused in one line
naming the status ("bloom-swarm is active, not approved: nothing started"),
and nothing changes: no brief, no session, no task, no ledger line, no
`epic.json` write. For the page door only, set `starts/<id>` to the same
doc with `state: "refused"` and `note` that line, so the page shows why.

## 2. Brief

Run `bun ~/Code/satoramoto/syns/plugin/skills/epic-start/brief.ts <id>`. It
reads `epic.json` alone, writes `~/.syns/epics/<id>/brief.md` and prints its
path. Exit not 0: say so and stop; nothing else changes.

A schedule goes on to step 5 now; a start goes on to step 3.

## 3. Session

Call `mcp__ccd_session__start_session` with:

- `context: "fresh"`, `initiation: "user_asked"` (Ryan's words, click or
  earlier schedule are the ask), local, `use_worktree: false`;
- `cwd`: the first job's `repo` with `~` expanded, else `~/.syns` expanded;
- `title`: "<id>: run the epic", and the session's name the epic id;
- `prompt`: "Read ~/.syns/epics/<id>/brief.md first; it is your brief. Its
  text follows." and then brief.md's text, whole;
- the background: the epic's `goal` and `why`, one line each.

Then file and title it with the `session-housekeeping` skill. The model is
the starting session's (no model override).

If the tool is missing or refuses (a scheduled run often cannot start a
session, or the app shows a card instead), say so in one line: this session
becomes the epic's session. Read brief.md and work from it after step 4,
and name this session in the record. The ledger names the door either way.

## 4. Record

Re-read `epic.json`, the ledger and (if the doc is written) `starts/<id>`
right before each write; append, never rewrite.

1. **epic.json**: `status: "active"`. Job states are untouched (the epic's
   session moves them with `job.state` lines).
2. **ledger**: append one line, `id` `<id>-NNNN` (the next count of that
   epic's lines in the ledger, four digits), `parent` the id, `at` now in
   UTC:
   `{"event": "epic.status", "from": "approved", "to": "active", "by":
   "Ryan", "via": "inbox <approval>", "door": "<door>", "session": "<the
   started session's name>", "note": "started <door>"}`. `approval` is
   `epic.json`'s `approval`.
3. **page db**: when the epic has a page under `evidence`, set
   `starts/<id>` with ArtifactData (`action: "set"`, `url` the page) to
   `{ action: "start", state: "started", rev, at, by: "<door>", session }`.
   No page, or no ArtifactData tool: skip it and say so in one line.

Say in one line what changed: the session, the ledger id, the doc.

## 5. Schedule

After steps 1 and 2:

1. **task**: `mcp__scheduled-tasks__create_scheduled_task` with `taskId`
   `epic-start-<id>`, `fireAt` the ISO time with offset, and the prompt,
   self-contained: "Run /syn:start <id> with the door schedule; the skill
   is ~/Code/satoramoto/syns/plugin/skills/epic-start/SKILL.md, the epic
   ~/.syns/epics/<id>/". If a task with that id exists
   (`mcp__scheduled-tasks__list_scheduled_tasks`),
   `mcp__scheduled-tasks__update_scheduled_task` it instead, so the epic has
   one task. No scheduled-tasks tools: say so and stop before the ledger.
2. **ledger**: append one line, ids as in step 4, `by: "Ryan"`, `via:
   "inbox <approval>"`: `{"event": "epic.scheduled", "fireAt": "<ISO with
   offset>", "task": "epic-start-<id>", "door": "<door>"}`. A second
   schedule writes another line. `status` stays `approved`.
3. **page db**: as in step 4, `starts/<id>` set to `{ action: "schedule",
   state: "scheduled", fireAt, rev, at, by: "<door>" }`, or skipped with a
   line.

Say in one line when it fires and the task id. When it fires, the task's
run comes back here with the door `schedule` and does steps 1 to 4.

## Page requests

`/syn:inbox` (step 2b) and `/syn:start` read `starts/<id>` for every
`approved` epic with a page. A doc with `state: "requested"` and `by:
"page"` is Ryan's ask: run this procedure with the door `page`; `action`
`schedule` (with its `fireAt`) is a schedule, `start` a start. A `rev`
older than the epic's still counts (approval is what allows the start); say
so. Any other state is already applied; leave it.
