<!--
syn working rules. Paste into ~/.claude/CLAUDE.md (or append below your own
rules). Agent definitions live in templates/agents/; copy them to
~/.claude/agents/.
-->

## Brain state

- `~/.syns/brain.json` holds what I'm working on this month: threads with
  their why, priority, state and next step, a shelf, done, and the inbox. It's
  the source of truth; your memory of the session is not.
- Read it at the start of a session. Keep it current as work moves: propose
  each change in one line and write it once I accept or correct it.

## The inbox: never interrupt, batch

- Interruptions are the biggest anti-pattern. Never stop work mid-flow to ask
  me something; batch it.
- Every open question for me goes in the inbox in `brain.json`, never only in
  the transcript.
- **Approvals** block their job: anything irreversible or outward-facing
  (merges to main, pushing to a new remote, publishing, deleting, sharing).
- **Questions** carry your recommendation. If the decision is reversible,
  proceed on it and leave the item as a veto. For taste calls, offer two or
  three options.
- Keep working on everything an item doesn't block. Raise a blocking approval
  only when nothing else is left to do. When I ask, run the inbox as a quiz:
  one item at a time, recommendation first.
- Relay agent reports and completions at a natural pause, batched, not one
  message each.
- A permission prompt that keeps recurring means a rule or allowlist entry is
  missing: propose one in the inbox.

## Stay conversational

- When I ask for something, answer quickly and stay available for my next
  message. Sizing an ask is your job; I never have to say "quick" or name an
  agent.
- One or two tool calls: do it yourself.
- More: hand it to an `assistant` in the background and keep talking. Every
  assistant opens with the repo's `.claude/base-context.md` word for word,
  then its ask, so they share one cached prefix. Reuse the same assistant for
  follow-ups on the same files; start a fresh one on a topic change.
- A real feature or a broad investigation goes to a `developer`.
- Sessions started here (and this one, at its start) are filed in the
  sidebar's "syns · in progress" group by the `session-housekeeping` skill;
  stale ones move to "syns · done".
- Session titles name what the session is doing now: retitle this one the
  moment its scope changes, and title every session you start (the
  `session-housekeeping` skill, step 1).
- Briefs are short: the outcome and the exact files.
- Don't grow an ask: no persistence, configurability, extra tests or
  generalising unless I ask.

## Testing

- Tests are written to a spec by a `test-engineer`, as their own step. The
  spec is the contract: numbered behaviours plus the exact public API.
- TDD in parallel: once the contract is agreed, the test-engineer and the
  developer start at once, with no coordination. When both are done, the
  tests run; each failure is a bug or a gap in the contract.
- Between test passes, a change runs only the build and one compile check.
- The repo's `AGENTS.md` lists the atomic check commands and when to run each.
- CI on the PR is the final check.

## Shared vocabulary

- `~/.syns/LEXICON.md` names things so we can point at them, like music
  theory: names, not rules. One term, one meaning.
- When you coin a term, say so and add it to the inbox as a **term**; it goes
  in the lexicon once I accept it.

## Where things go

- `~/Code` is for code; `~/.syns` is for everything else.
- `~/.syns` holds syn's state: `brain.json` (also `$SYN_BRAIN`),
  `LEXICON.md` and, later, `memory.jsonl`.
- Temp files, experiments, generated images and intermediate output go in
  `~/.syns/scratch/<topic>/`, never in a repo or `/tmp`.
- Non-code keepers (notes, exports, images worth keeping) go in
  `~/.syns/files/<topic>/`.

## Working together

- Decide, don't ask, for reversible calls: follow the project's conventions,
  record the decision, and tell me so I can veto it.
- Pass/fail is an exit code, not grepping output.
- Nothing you start outlives your task: stop watchers, servers and browsers,
  and check with `ps`.
- Never handle secret values. Refer to them as `op://…` references; tools
  resolve them through the 1Password CLI with my approval.

## Dogfood

- Prefer using my own projects to move my other projects along, and note what
  that teaches about each.
