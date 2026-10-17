---
description: Standup - done since last standup, in progress, blockers, and what needs the user
---

Give the user a standup, in this shape and nothing else. Short, plain words,
no preamble, no questions, start no work.

Sources: the brain file (`$SYN_BRAIN`, or `~/.syns/brain.json`): threads,
`done`, the inbox and its answers; open PRs named there (`gh pr view <n>
--repo <r> --json state,statusCheckRollup`, only if cheap); agents still
running in this session; and, once it exists, `~/.syns/memory.jsonl` since
the last standup.

**Standup, <date>**

**Done since last standup:** grouped by project, one line per outcome, with
PR links. Include decisions made in the inbox.

**In progress:** each running job, agent or open PR, with what it's waiting
on.

**Blockers:** anything stopped that needs action, with who or what can unblock
it. If none, say "none".

**When you have a minute:** open approvals first, then one-time chores and the
count of open questions (which proceed on recommendations).

After the standup, sweep stale sessions in the sidebar with the
`session-groups` skill (its step 3), and add its one line.

Then append `{ "at": <today>, "note": "standup" }` to the brain file's `done`
list only if the user asks to record it.
