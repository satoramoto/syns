---
description: Close a pod's done task session - check it landed, log it, mark it completed and archive it
argument-hint: "<session id or title>"
---

Arguments: $ARGUMENTS

Close one task session with the `session-housekeeping` skill's close step
(step 5). Run it from the pod's lead session; a lead is never closed.

1. Find the session: `mcp__ccd_session_mgmt__list_sessions`, matching the
   argument as a session id, else as a title (`[<pod id>] <task name>`,
   case-insensitive, a unique substring is enough). No match, or several:
   say so in one line, listing the candidates, and stop. No argument: take
   the task whose report arrived last in this session.
2. Its pod: the pod whose `sessions` (brain file, `$SYN_BRAIN` or
   `~/.syns/brain.json`) holds the id, else the `[<pod id>]` in its title.
   A lead (`[LEAD] …`, or a pod's `lead`): refuse in one line.
3. Apply the close step: check that it landed (the commit or merged PR its
   report names, nothing uncommitted in its worktree, no process left); if
   it landed, write the `task.closed` ledger line, mark it completed,
   archive it and drop it from the pod's `sessions`; if not, raise the
   inbox question (close or continue) and leave it open.

Don't ask anything else. End with one line: closed, with what it left
(commit, PR, page), or not closed, with what's missing and the inbox id.
