---
name: session-housekeeping
description: Keep syns sessions tidy in Claude desktop's sidebar - each pod's lead and task sessions titled by convention and filed in the pod's group, stale titles fixed, done tasks closed (checked, logged, archived). Use right after any mcp__ccd_session__start_session or mcp__ccd_session__hand_off_to_session call in a syns-enabled session, at the start of a syns-enabled session (to file and title itself), whenever this session's scope changes (to retitle it), when a task session's report note arrives at its lead, from /syn:standup, /syn:back, /syn:close and /syn:sweep, and when Ryan says "file the sessions", "fix the titles", "tidy the sidebar" or "close <session>".
---

The one procedure for keeping syns sessions readable in the sidebar. Work is
organised by **pod** (brain.json `pods`): each pod has one **lead session**,
long-lived, the one Ryan talks to, and its **tasks**, each its own session,
started by the lead, reporting back to it, and **closed** (archived) by it
when done. Every step is idempotent: moving a session into the group it's
already in, or giving it the title it already has, changes nothing, so
running it twice is harmless. It costs a few tool calls; don't read
transcripts.

The brain file is `$SYN_BRAIN`, or `~/.syns/brain.json`; the ledger is
`~/.syns/memory.jsonl` beside it.

## 1. Titles

Under 60 characters, by role:

- **Lead:** `[LEAD] <pod id>`, e.g. `[LEAD] syn`. It never changes.
- **Task:** `[<pod id>] <task name>`, e.g. `[syn] Tasks tab on the dashboard`.
  The task name says what the task is doing **now**, not the ask it opened
  with. A task for an epic's job is `[<pod id>] <epic>: <job>`.
- A session in no pod keeps a plain title naming what it is doing now.

- **Retitle the moment scope changes.** A new phase (research to build, build
  to review) or a hand-off: call `mcp__ccd_session_mgmt__set_session_title`
  with `{"session_id": "self", "title": …}` before starting the new work. A
  correction or follow-up on the same work keeps the title. A lead's title
  doesn't change; work that leaves its pod is a task, started as one.
- **Title what you start.** A lead that starts a task (`start_session`,
  `hand_off_to_session`) gives it such a title, then confirms it with
  `set_session_title` on the new session's id.

## 2. Record it in the brain

- A lead, at its first turn, sets its pod's `lead` to its session id (if
  `lead` already names another live session, say so in one line and leave
  it).
- A lead that starts a task appends the new session id to its pod's
  `sessions`.

## 2a. Who starts what (the nesting rule)

Sessions nest under the session that started them (the app's
`parentSessionId`), and a nested session moves with its parent in the
sidebar, so where a session is started decides where it lives:

- The top session (the `syn` lead) talks to leads only. It starts leads, and
  never a pod's task.
- A lead starts only its own pod's tasks. Work for another pod, whatever
  door it came through (an inbox answer, a report, a request), goes to that
  pod's lead by SendMessage; the lead starts the task, so it nests under its
  own lead and reports back to it.
- A task starts no sessions; its parallel pieces are agents inside it.

A session started in the wrong place cannot be re-parented: its starter
hands its report to the right lead when it lands, closes it, and says so.

## 3. Find the pod's group

`mcp__ccd_sidebar__list_groups`, then match by name, exactly the pod's id
(e.g. `syn`). Never hardcode a group id. Create a missing one with
`mcp__ccd_sidebar__create_group`.

## 4. File (after starting a session, and at session start)

Move the lead and each task just started into its pod's group with
`mcp__ccd_sidebar__move_sessions` (`"self"` for this session). Skip any
already there. `mcp__ccd_session_mgmt__list_sessions` with `{"linked":
true}` gives this session's family when you need the ids.

## 5. Close a task

When a task session's report note arrives at the lead, or on `/syn:close
<session>`, or from `/syn:sweep`. The lead closes tasks; a lead itself is
never closed (when heavy it is cleared and re-reads its pod folder).

1. **Check it landed**, from the report and the session
   (`mcp__ccd_session_mgmt__get_session`):
   - the commit (`git -C <repo> branch --contains <sha>` on the base) or
     merged PR (`gh pr view <n> --repo <r> --json state` is `MERGED`) the
     report names;
   - nothing uncommitted in its worktree (`git -C <worktree> status
     --porcelain` is empty), when it had one;
   - no process it started still running (`ps`, by its worktree path or the
     commands its report names).
   A task whose report names no commit, PR or page (an investigation, a
   question answered) lands with its report.
2. **Didn't land:** don't close it. Raise an inbox question (`kind:
   "question"`, `pod`, the session id and title, what's missing; options
   "Close anyway" and "Continue it", the recommendation first, `reversible:
   true`, `applies: "session-housekeeping close"`) and stop here for that
   task.
3. **Landed:** append one ledger line to `memory.jsonl`:
   `{"id": "<pod>-<nnnn>", "parent": "<pod>", "at": <ISO time>, "event":
   "task.closed", "session": <session id>, "pod": <pod id>, "title":
   <title>, "left": {"commit"?, "pr"?, "page"?}, "by": <who closed it>}`,
   the number continuing from the highest for that parent.
4. Mark it completed (`mcp__ccd_sidebar__mark_completed`), archive it
   (`mcp__ccd_session_mgmt__archive_session`), and remove its id from the
   pod's `sessions`.

## 6. Tidy (standup, back, or when asked)

From `list_sessions` (`{"linked": true}`, or all sessions for a lead):

- File any lead or task not in its pod's group (step 4).
- **Titles.** For each unarchived task, compare its title with its latest
  report or current work (the brain file's job that names it, or
  `get_session`). A title is **stale** when it names work the session has
  finished or moved past, or breaks the convention. Retitle with
  `set_session_title` only sessions this session started itself; the app
  asks Ryan before changing a title he set, so flag those instead.
- **Done tasks.** A task whose last turn ended with its report and that is
  idle is offered for closing in one line ("Close 3 done tasks: <titles>?");
  close (step 5) only on a yes. The full audit of pods and sessions is
  `/syn:sweep`.

## 7. Say what changed

One line, e.g. "Filed '[syn] auth fix' in syn; closed 2 (lexicon pass, PR
41); 1 didn't land (inbox 52); 3 titles stale: …; retitled 1." If nothing
changed, say nothing, or "Sidebar already tidy" when Ryan asked for it.
