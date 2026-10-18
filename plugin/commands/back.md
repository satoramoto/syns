---
description: Get back into flow after time away - what we're doing, what was decided, what's running, what needs you
---

The user just sat back down and needs to get back into flow in under a
minute. Give them a re-entry brief, nothing else.

Read the brain file (the path in `$SYN_BRAIN`, or `~/.syns/brain.json` when
that's unset). Also check, quickly and only
if cheap, the state of PRs mentioned there (`gh pr view <n> --repo <r> --json
state` per PR) and any agents still running in this session.

Reply in this shape, short, plain words, no preamble:

**What we're doing:** the outcome, then the top one or two threads by
priority, one line each (title, state).

**What you decided recently:** the inbox items answered in the last day or so
(their `answer.at`), newest first, one line each: the decision, not the
question.

**What's running:** jobs, agents and open PRs, with what each is waiting on.

**What needs you:** open approvals first, then the count of open questions
(which proceed on recommendations). If nothing is urgent, say so.

**Next:** the single next step that would put the user back in flow.

After the brief, sweep stale sessions and stale titles in the sidebar with
the `session-housekeeping` skill (its step 4), and add its one line.

Don't ask questions. Don't start any other work. If brain.json is missing, say so
and suggest `/syn:onboard`.
