---
name: session-housekeeping
description: Keep syns sessions tidy in Claude desktop's sidebar - titles that name what each session is doing now, two groups, stale ones swept. Use right after any mcp__ccd_session__start_session or mcp__ccd_session__hand_off_to_session call in a syns-enabled session, at the start of a syns-enabled session (to file and title itself), whenever this session's scope changes (to retitle it), from /syn:standup and /syn:back, and when Ryan says "file the sessions", "sweep sessions", "fix the titles" or "tidy the sidebar".
---

The one procedure for keeping syns sessions readable in the sidebar: each
titled for what it is doing now, filed in one of two groups, **syns · in
progress** and **syns · done**. Every step is idempotent: moving a session
into the group it's already in, or giving it the title it already has,
changes nothing, so running it twice is harmless. It costs a few tool calls;
don't read transcripts.

## 1. Titles

A session's title names what it is doing **now**, in under 60 characters:
"Orchestrate bloom-swarm lanes", not the ask it opened with. A session started
for an epic's job is titled `<epic>: <job>`, e.g. "bloom-swarm: native
measurements".

- **Retitle the moment scope changes.** A new ask that is not a correction of
  the current one, a new phase (research to build, build to review), or a
  hand-off: call `mcp__ccd_session_mgmt__set_session_title` with
  `{"session_id": "self", "title": …}` before starting the new work. A
  correction or follow-up on the same work keeps the title.
- **Title what you start.** A session that starts another (`start_session`,
  `hand_off_to_session`) gives it such a title, then confirms it with
  `set_session_title` on the new session's id.

## 2. Find the groups

`mcp__ccd_sidebar__list_groups`, then match by name, exactly
`syns · in progress` and `syns · done`. Never hardcode a group id. Create a
missing one with `mcp__ccd_sidebar__create_group`.

## 3. File (after starting a session, and at session start)

`mcp__ccd_session_mgmt__list_sessions` with `{"linked": true}` gives this
session's family. The root is the session with no parent. Move the root into
**syns · in progress** with `mcp__ccd_sidebar__move_sessions` (`"self"` when
the root is this session). Nested sessions move with their family root, so
one move files the whole family, including the session just started. Skip
the move if the root is already in that group.

## 4. Sweep (standup, back, or when asked)

From the same `list_sessions` result, look at each session whose last turn
has ended and which is idle. A session is **stale** when either:

- it is idle, not pinned, and nothing in the brain file (`$SYN_BRAIN`, or
  `~/.syns/brain.json`) names it (by id or title) on a thread, job or inbox
  item that is running, working or blocked; or
- it is already archived.

Move each stale family root in **syns · in progress** to **syns · done**.
Archived sessions don't show in groups and can't be moved: count them as
done and leave them alone. A session that is busy, pinned or named as
running or blocked stays where it is; one in **syns · done** that is busy
again goes back to **syns · in progress**.

Never archive unasked. If any stale session is not archived, offer it in one
line ("Archive 3 done sessions: <titles>?") and archive with
`mcp__ccd_session_mgmt__archive_session` only on a yes.

**Titles.** For each linked, unarchived session, compare its title with its
latest report or current work (the brain file's job or thread that names it,
or `mcp__ccd_session_mgmt__get_session`). A title is **stale** when it names
work the session has finished or moved past. Retitle with
`set_session_title` only sessions this session started itself; the app asks
Ryan before changing a title he set, so flag those instead of retitling.

## 5. Say what changed

One line, e.g. "Filed 'auth fix' in syns · in progress; moved 2 to syns ·
done (lexicon pass, PR 41); 3 titles stale: 'Tests to the epics contract'
(now orchestrating bloom-swarm), …; retitled 1." If nothing changed, say
nothing, or "Sidebar already tidy" when Ryan asked for it.
