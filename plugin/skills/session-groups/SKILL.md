---
name: session-groups
description: File syns sessions in Claude desktop's sidebar and sweep stale ones. Use right after any mcp__ccd_session__start_session or mcp__ccd_session__hand_off_to_session call in a syns-enabled session, at the start of a syns-enabled session (to file itself), from /syn:standup and /syn:back, and when Ryan says "file the sessions", "sweep sessions" or "tidy the sidebar".
---

The one procedure for keeping syns sessions in two sidebar groups:
**syns · in progress** and **syns · done**. Every step is idempotent: moving
a session into the group it's already in changes nothing, so running it
twice is harmless. It costs a few tool calls; don't read transcripts.

## 1. Find the groups

`mcp__ccd_sidebar__list_groups`, then match by name, exactly
`syns · in progress` and `syns · done`. Never hardcode a group id. Create a
missing one with `mcp__ccd_sidebar__create_group`.

## 2. File (after starting a session, and at session start)

`mcp__ccd_session_mgmt__list_sessions` with `{"linked": true}` gives this
session's family. The root is the session with no parent. Move the root into
**syns · in progress** with `mcp__ccd_sidebar__move_sessions` (`"self"` when
the root is this session). Nested sessions move with their family root, so
one move files the whole family, including the session just started. Skip
the move if the root is already in that group.

## 3. Sweep (standup, back, or when asked)

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

## 4. Say what moved

One line, e.g. "Filed 'auth fix' in syns · in progress; moved 2 to syns ·
done (lexicon pass, PR 41)." If nothing moved, say nothing, or "Sidebar
already tidy" when Ryan asked for it.
