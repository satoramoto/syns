---
description: syn at a glance (inbox count), or `/syn onboard` (stub)
argument-hint: "[onboard]"
allowed-tools: Read
---

Arguments: $ARGUMENTS

If the arguments are `onboard`, reply with exactly this and do nothing else:

> syn onboarding isn't built yet. It will walk through: 1. code roots (audit
> your repos' agent setup), 2. notes (read-only), 3. 1Password vault
> (references only, never values), 4. an interview on your current mindstate,
> 5. drafts of BRAIN.md, LEXICON.md and a base context per repo, each approved
> before it's written. Until then, copy syns' `templates/` by hand.

Otherwise, Read `~/.claude/BRAIN.md` (in this session's config directory). If
it doesn't exist, reply `No BRAIN.md yet: copy syns' templates/BRAIN.md to
~/.claude/BRAIN.md, or run /syn onboard.` and stop.

Count the rows of the table under its `## Inbox` heading (data rows only, not
the header or the `---` separator). Reply with one line and nothing else:

`syn · inbox <n> (<a> approvals, <q> questions, <t> terms)`
