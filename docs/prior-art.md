# Prior art: SINS

**SINS Is Not Scrum** (April 2026) was the first attempt at this idea, built
inside an earlier project, trey. It wrapped a set of personas (PM, architect,
engineer) in autonomous **loop drivers** so a project moved while its owner was
away, run on a timer (`/loop`) or as cloud routines (`/schedule`):

- **triage** refined issues and planned them;
- **build** picked ready issues and dispatched engineers in worktrees to open
  PRs;
- **review** posted architect reviews and ran feedback rounds on PRs;
- **autopilot** ran the whole pipeline end to end for an ad-hoc brief, capped
  at five issues;
- **rsi** ("recursive self-improvement") profiled a session's transcript for
  its biggest token costs and proposed edits to the skills and agent specs.

The drivers skipped the personas' per-step approvals. Anything they shouldn't
decide alone was parked under a `human-needed` label, cleared by the owner at a
stand-up. Concurrency was capped per driver (5 / 2 / 3), work was claimed with
a `wip:claude` soft lock that went stale after 60 minutes, and drivers never
merged: a `ready-to-merge` label was the owner's signal to sweep the queue.

## What carries over

| SINS | syn |
| --- | --- |
| `human-needed` parking | the **inbox** |
| drivers never merge | **approvals** block their job |
| stop early at questions, conflicts with the owner's vision, or scope blow-ups | the same, as inbox items with a recommendation |
| concurrency caps per driver | concurrency follows the machine's build limits, per repo `AGENTS.md` |
| 60-minute stale lock | jobs carry state and an owner; a stale job is visible in the pane |
| `/sins-rsi` token profiling | the **routing log**: every transition and its token usage, per job and mode |

## What changes

SINS ran while its owner was away; syn keeps you in the loop. SINS coordinated
through GitHub labels and comments; syn keeps its state in plain local files
(brain state, the inbox, the log) and in code-level guards, with no handoff
rituals. SINS's personas each had their own process; syn has one machine with
modes as presets. Hence the name: **SYNS Is Not SINS**.
