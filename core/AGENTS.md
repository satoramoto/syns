<!--
syns core: Ryan's harness-neutral working rules. The source of truth for
every harness. Claude Code imports it from ~/.claude/CLAUDE.md
(`@~/Code/satoramoto/syns/core/AGENTS.md`) and adds the Claude-only rules in
core/claude.md; Codex reads it through the symlink ~/.codex/AGENTS.md.
Anything that names one harness's tools goes in that harness's file, not here.
-->

## Paths

- Repos live in `~/Code/{user or org}/{repo}` (e.g. `~/Code/satoramoto/spacemap`). Clone or create new ones there. `~/The Source` is deprecated: don't put anything new in it; repos still there get moved to `~/Code/...` when convenient.
- Never use absolute paths with backslash-escaped spaces (e.g. `/Users/ryan/The\ Source/trey`); they break harness permission rules.
- Prefer relative paths (e.g. `src/tui/App.tsx`) since the working directory is always the project root.
- If you must use an absolute path, quote it with double quotes (e.g. `"/Users/ryan/The Source/trey"`).

## How I like to work

- **Decide, don't ask.** I rarely have time for questions. Make a reasonable decision: follow the project's reference behaviour or common convention. Record the decision in the PR body and mention it in your summary so I can veto it. For taste calls, show me 2–3 options rather than asking open questions. Still confirm anything irreversible or outward-facing: merges to main, deletions, sharing.
- **Tokens: give me a magic link.** Whenever I need to create a GitHub token, give a prefilled fine-grained token URL (`https://github.com/settings/personal-access-tokens/new?name=…&description=…&target_name=<owner>&expires_in=<days>&<permission>=read|write…`, least privilege), say which repository to pick (that part can't be prefilled), and give the `gh secret set` command if it goes into a secret.
- **Smallest next step.** Don't build a big system up front. Think about the future and write it down, but every iteration is the smallest, simplest, easiest version of the next milestone. Skills, agents and rules grow organically out of the workflow as it develops, not ahead of it. When a rule or process starts restricting us more than it helps, say so and propose removing it.
- **Don't reinvent the wheel.** An axiom. Before building anything, check what already does it: our own repos and skills first (a command, a skill, a script, a doc section), then the tool's own features, then the ecosystem. Say what you found and why it fits or doesn't; build only the gap. The nearest existing thing is the starting point, never a blank file.
- **Dogfood my projects.** Whenever we work on something, look for a way it can push another of my projects along at the same time, for example a UI built on zen, or session tooling built into syns. Prefer my own tools and libraries over outside ones where they fit, and note the gaps it exposes in the project that has them. Say when you see such a chance. Keep it light: don't build anything big just to dogfood unless I say so.
- **State in JSON, prose in markdown.** Structure, state and anything a tool reads or writes goes in JSON (`brain.json`). Proper text (vision, lexicon, specs) goes in markdown. The planned `memory.jsonl` will be the append-only ledger of what happened and when. `~/.syns/` is the canonical home for all of it (brain.json, LEXICON.md, memory.jsonl); each harness's config folder holds symlinks.
- **`~/Code` is for code; `~/.syns` is for everything else.** Temp files, experiments, generated images, intermediate output and other junk go in `~/.syns/scratch/<topic>/`, never in a repo or a system temp folder. Keepers that aren't code (references, renders, exports) go in `~/.syns/files/<topic>/`. Clear scratch you made once its task is done.
- **Brain state.** `~/.syns/brain.json` is what I'm working on this month (threads, shelf, done, and the inbox): each thread's why, priority, state and next step, plus a shelf. It outranks session memory. Read it when a session starts and after compaction. Keep it current: when something changes, propose the edit in one line and apply it once I accept.
- **Never interrupt me; batch.** Interruptions are the biggest anti-pattern: they break flow. Questions wait in the inbox, reports come at a natural pause or when I look, and each permission prompt is a sign that a rule or allowlist is missing.
- **We work together; I'm in the loop.** This is an extension of my brain, not an automation system.
  - Every question for me goes into the inbox in brain.json (with its options, recommendation, whether it's reversible, what it blocks and what answering applies), not scattered through replies. **Approvals** (irreversible or outward-facing) block their job. **Questions** carry your recommendation; reversible ones proceed on it and stay as a veto until I answer.
  - Keep working on everything an item doesn't block, and tell me what's next when a thread runs dry.
  - When I say "inbox", run me through it as a quiz (one item at a time, recommendation first), then apply the answers.
- **Shared vocabulary.** `~/.syns/LEXICON.md` holds the terms we use, like a music theory for the work: names, not rules. Use them exactly, one meaning each. When you coin a new term, flag it in your reply so I can accept, rename or reject it, and add accepted ones to the lexicon. Project-specific terms go in that repo's AGENTS.md.
- **Plain words.** Say "tests", "checks" or "CI" and name the actual command. No invented process jargon (for example "gates"), and no wrapper scripts that bundle or hide what runs.

## Edits and commands

- Make all file changes with the harness's file-editing tools. Don't make code edits with sed, heredocs or one-off Python/shell scripts; the shell is for building, testing, git and gh.
- Don't leave helper scripts or logs in scratch folders.
- Nothing you start outlives your task. Before you report, stop every process you started (watchers such as bacon, dev servers, headless browsers, test runs) and check with `ps` that none is left. Anything that launches a browser or server kills it on every exit path (for example `trap 'kill $pid' EXIT`).
- Every background command gets a human-readable description naming what it is and what it's for, e.g. "Plugin tests for #312". I read these in the task list.
- Pass/fail means exit code 0, not grepping the output. Cap command output (`2>&1 | tail -n 20`).
- No artificial CPU or thread caps on builds.
- **Never touch my browser tab.** Don't navigate, scroll or click in a browser tab I have open. For any check, open your own background tab, act only on it, and close it when done. Put this rule in every subagent brief that might use the browser.

## Testing

- **Tests are written to a spec, by a `test-engineer`, as their own step.** Not as a side effect of a change. The spec is the contract: numbered behaviours plus the exact public API (types, signatures, names). It enumerates cases from boundaries (input partitions and their edges, surfaces, state transitions, failure paths) and writes those, nothing more. No spec yet means it drafts one for me to approve first.
- **TDD in parallel.** Once the contract is agreed, the `test-engineer` and the `developer` start at the same time from it, with no coordination between them. The test engineer never reads the implementation, and the developer doesn't wait for the tests. When both are done, the tests run against the implementation. Each failure is either a bug (back to the developer) or a gap in the contract (fix the spec, then whichever side was wrong).
- Changes made between test passes run only the build and a compile check. If an existing test breaks, CI or the next test pass catches it; fixing it is its own small ask.
- The repo's AGENTS.md is the one place listing the atomic test commands and when to run each. Keep it current.
- While working, use the project's fast feedback loop in your own worktree: a file watcher such as bacon if the project has one, otherwise a compile check plus targeted tests. Read the latest result after your final edit; don't monitor continuously.
- Run each targeted test once. Never run the whole suite locally, and never in overlapping configurations: use the widest configuration plus a cheap compile-only check for the others.
- **CI on the PR is the final check.**

## Git

- Work on a branch in your own worktree, never directly on the default or integration branches. Create it with `git checkout --no-track -b <branch> origin/<base>` and push with `git push -u origin HEAD:refs/heads/<branch>`, so a bare push can never land on the base.
- Commit and push after each meaningful step; worktrees get cleaned up.
- Never change git config.
- If commit signing fails, stop and report it rather than working around it.
- Remove a worktree (and its build output) once its PR has merged and nothing is uncommitted.
- Small PRs, one per lane (see below). Split big work into a contract PR plus lanes, not a stack of dependent PRs.

## Stay conversational

The outcomes I want:
- When I ask for something, you answer quickly and stay available for my next message. You never disappear for minutes on an ask that should take seconds.
- Iterating is fast and cheap in tokens: small asks cost a few tool calls, not a fresh agent re-reading the project.
- Delegation is one way to get there, not a goal in itself.

How:
- **I describe changes; you get started at once and stay responsive.** Sizing an ask is your job: I never have to say "quick" or name an agent type.
- **One or two tool calls: do it yourself.**
- **More than that: hand it to the session's `assistant`** in the background and keep talking to me. Reuse the same assistant for follow-ups, so its context stays warm and its edits queue in order instead of colliding. Manage its context on purpose, on a need-to-know basis:
  - Each message carries only what that ask needs: the outcome, the files, and any fact it can't already see. Not my conversation with you, and not things it already knows.
  - Its earlier turns are a stable, cached prefix, so a follow-up on the same files is cheap.
  - Start a fresh one when what it carries is mostly irrelevant to the next asks: a topic change, or a long stretch of work. Its context, and every turn's cost, grows otherwise.
- **A real feature or a broad investigation goes to a `developer`.**
- No tests, no version bumps and no research beyond the files involved, unless asked.
- **Briefs are short.** Give the outcome and the exact files. Don't send agents to read every skill or doc up front; point at the one section that matters.
- **Don't grow an ask.** No persistence, configurability, extra tests or "while I'm here" generalising unless I ask ("bake it in"). Don't bundle unrelated asks into one long agent.
- **Tests are a separate step** (see Testing), never part of a small ask.

## Multi-agent work (when I have you orchestrate)

The orchestrator (you) spends the reasoning: you plan features into lanes and integrate them. Agents are one-shot. The roles (each harness maps them to its own agents and models):
- `developer`: a lane lead, one per lane. It can launch a swarm of `worker` agents inside its lane;
- `worker`: launched only by a lane lead, for one piece of its lane;
- `assistant`: the main session's hands for anything over a couple of tool calls, reused across follow-ups;
- `test-engineer`: tests written to a spec, as their own step;
- `reviewer`: reviews, on a cheaper model than the one that wrote the code.

Write every brief as an **outcome**: what must be true when the agent is done (the behaviour, the checks passing, the branch pushed), plus the constraints, including the exact files the lane owns. Don't write step-by-step procedures.

**Plan in lanes, not tickets.** A feature is split by where its edits land:
- **Contract first.** The feature's shared surface (the files every part would otherwise touch: API types and commands, their docs, command lists, mocks, tooltips; AGENTS.md names them for the project) lands as one small PR, with stubs so it's green on its own. It merges before the lanes start, so lanes branch from the plain base and never stack.
- **Lanes own disjoint files.** Each lane (for example DSP, mapping, wiring, UI) owns a set of files no other lane touches, so lane PRs merge in any order without conflicts. If two lanes need the same file, the split is wrong: move that file into the contract or into one lane.
- **Integrate as you go.** Keep a local integration worktree whose branch is the base merged with every open lane branch; rebuild it as lanes push and run the core checks there, so the feature is tested whole. Fixes go to the lane that owns the file, never into the integration branch. It's never pushed.
- **Concurrency follows the machine.** Run as many lanes at once as AGENTS.md's build limits allow (for example one lane building Rust at a time while UI and docs lanes run); queue the rest.

1. **Lane leads** get one lane in their own worktree. They swarm workers on its independent pieces, run the lane's checks once, push the branch (no PR yet), and send ONE final report: branch, head SHA, what they ran and the result, decisions, follow-ups, and any contract change they need. No progress messages. A needed contract change goes in as its own small PR; lanes then merge the base.
2. **Review before the PR.** When a branch is pushed, send a separate one-shot `reviewer` over its diff against the base. Never review it yourself. It flags only real bugs and project rules, never style, and reports findings back to you; it posts nothing on GitHub.
3. **Triage before fixing.** Read the review yourself and push back on weak findings. Only then send ONE targeted fix agent to the branch. Edge cases become follow-up issues, not blockers.
4. **The PR is for CI, then it auto-merges.** Once the review is addressed, open the PR (body: what changed, **Decisions**, **Follow-ups**) and turn on auto-merge. No review happens on the PR. When parallel PRs conflict, merge the updated base into the later one and let CI run again, and fix the lane split so it doesn't recur.

**Never:**
- polling (sleep, tail or grep loops, "check back" wakeups);
- long-lived steward or queue agents: their context grows every turn, so cost grows quadratically;
- labels, READY comments or other handoff rituals;
- running the same tests twice.
