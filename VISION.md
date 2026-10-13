syns enables the user to manifest their ideas by maintaining a blissful and effortless flow state.

# Vision

## First principle: never interrupt, batch

Interruptions are the biggest anti-pattern. syn never interrupts; it batches.

- **Questions** go to the inbox and never stop work mid-flow. Reversible ones
  proceed on Claude's recommendation.
- **Approvals** block only their own job, and wait in the inbox rather than
  popping up, unless you're idle and nothing else is left to do.
- **Reports and completions** arrive when you look, or at a natural pause,
  not as a stream.
- **Each permission prompt is an interruption too**, and a signal that a rule
  or an allowlist entry should exist so it doesn't recur.

The anti-patterns, plainly:

- interruptions;
- re-explaining context;
- waiting on long turns in the main session;
- ambiguous words.

## Why each part exists

Everything below exists for that one outcome. Each part removes one thing
that breaks flow:

- **brain state** means you never re-explain;
- **the inbox and quizzes** keep you out of interruptions;
- **routing** keeps the session conversational;
- **modes** match the work's rigour to your mood;
- **shared vocabulary** removes ambiguity.

## What syn is

syn is one long-lived Claude Code session that works as an extension of your
brain. You open it at the start of the month and keep talking to it until the
month turns over. It knows what you're working on and why, keeps your open
questions in one place, sends the heavy work to background agents, and stays
free to talk to you the whole time.

This repo, **syns**, is the proof of concept.

## One session, a month long

Most Claude Code sessions are short: a task, a fix, a question, then a fresh
start that has forgotten everything. syn is the opposite. One session holds the
thread of your work for weeks. Its memory is not the transcript (that gets
compacted and lost) but a small set of plain files you can read and edit:

- **brain state** (`BRAIN.md`): what you're working on, why, in what order,
  and what's next;
- **the inbox**: every open question for you, in one place;
- **the lexicon** (`LEXICON.md`): the words you and Claude share;
- **the base context**: a curated brief per repo, shared by every agent the
  session starts.

Because those files are the source of truth, the session can restart, compact
or crash and pick up where it was. **You never re-explain**, so you stay in
flow.

## Working together, not automation

syn is not an autonomous agent swarm that works while you sleep and hands you
a pile of PRs in the morning. You stay in the loop. You describe changes; syn
starts on them at once and stays responsive to your next message. Decisions
that need you wait for you; decisions that don't are made, recorded, and left
open to your veto.

The goal is the feel of pairing with someone who never loses the thread: you
think out loud, it keeps track, does the legwork and tells you what it decided.

## Brain state

Brain state is a board of **threads**. Each thread is one idea or workstream
and carries four things:

- **why** it matters;
- its **priority** (its place on the board);
- its **state** (where it stands now);
- its **next** step.

Below the board sit a **shelf** (parked threads) and **done** (what finished
this month). Claude keeps the file current during the session: it proposes
each change in one line, and you accept or correct it. It exists so you never
have to re-explain what you're doing or why.

## The inbox

Every open question for you goes into one inbox, never scattered through the
transcript. There are two kinds of item:

- **Approvals** block their job. Anything irreversible or outward-facing
  (pushing to a new remote, publishing, deleting, merging to main) waits here.
- **Questions** carry Claude's recommendation. When the decision is
  reversible, work proceeds on the recommendation and the item stays in the
  inbox as a veto until you answer.

Work continues on everything an item doesn't block. You answer whenever you
have time, **as a quiz**: one question at a time, recommendation first, pick or
override. Clearing ten items takes a minute.

The inbox exists to **keep you out of interruptions**: nothing pings you
mid-thought, and nothing stalls waiting for you unless it truly must.

## Onboarding

syn starts by getting to know you. `/syn onboard` walks through five steps and
can be re-run whenever your brain state turns over (monthly, say):

1. **Code.** Where do your repos live? syn scans them as an audit: which have
   an agent setup that fits this approach (an `AGENTS.md` with a check table, a
   base context, tests to a contract) and which deviate, so it can propose
   normalizing them. Recently active repos become candidate threads.
2. **Notes.** Where are your notes (an Obsidian vault, or any folder of
   markdown)? syn reads them, and never writes to them unless you ask, to seed
   threads, their why, and the vocabulary you already use.
3. **Secrets.** Which 1Password vault holds your project secrets? syn stores
   only the vault name and item references (`op://vault/item/field`), never a
   value. It never reads or prints a secret; tools resolve references at run
   time through the 1Password CLI, and you approve each item there.
4. **Interview.** A quiz on your current mindstate: what you're working on,
   why it matters, the priority, what's next, and what's on the shelf. It uses
   Claude Code's question UI, with recommendations drafted from steps 1 and 2.
5. **Output.** A `BRAIN.md` (board, shelf, and an inbox holding whatever the
   interview couldn't settle), a `LEXICON.md` seeded with your own terms, and a
   base-context draft for each active repo. You approve each before it's
   written.

## Modes: presets of one machine

Under the conversation runs one state machine: an ask becomes a job, the job is
routed to an owner, worked, checked, committed, and maybe reviewed, PR'd and
merged. Working styles are **modes**, presets of policies on that one machine:

| | scrappy | normal | production |
| --- | --- | --- | --- |
| checks | build | build + compile | build + compile |
| tests | skipped | on request | required |
| review | skipped | skipped | required |
| PR | never | on request | every change |
| commit to main | allowed | allowed | denied |

A new mode is a new record, not new code. Every transition is logged, so modes
and routing rules can be compared on real numbers.

Modes exist to **match the work's rigour to your mood**: sketching an idea
late at night shouldn't feel like shipping to production, and shipping
shouldn't feel like a sketch.

## Routing

- **The main session stays conversational.** One or two tool calls it does
  itself. Anything more goes to a background agent, so you're never waiting
  minutes on an ask that should take seconds.
- **The assistant** does the session's legwork. Every assistant opens with the
  same curated **base context**, word for word, then its own ask. Because the
  prefix is identical, it's cached once and shared by every fork: starting a
  new assistant is cheap, and several can run in parallel on disjoint files.
- **Developers** take real features: one lane of files each, in their own
  worktree and branch, with workers for the parallel parts.
- **Reviewers** read a pushed branch before a PR is opened.

Routing is decided by explicit rules in code (tool-call counts, agent spawns,
guards), not by the model reinterpreting prose every turn.

Routing exists to **keep the session conversational**: you think out loud and
the work happens beside you, never instead of the conversation.

## Tests to a contract, TDD in parallel

Tests are their own step, not a side effect of a change. A **contract** is a
spec's numbered behaviours plus its exact public API. Once it's agreed, a
test-engineer and a developer start from it at the same time, with no
coordination: the test-engineer never reads the implementation, and the
developer doesn't wait for the tests. When both are done the tests run, and
each failure is either a bug or a gap in the contract.

Between test passes, a change is an edit plus the build and one compile check.
CI on the PR is the final check.

## Shared vocabulary: language games

Working well together needs words you both mean the same thing by. The lexicon
is like music theory: **names, not rules**. It names things (a thread, a job, a
mode, a trace) so you can point at them; the rules live elsewhere. One term,
one meaning. When Claude coins a term it says so, and you accept, rename or
reject it before it goes in.

The vocabulary exists to **remove ambiguity**: a short word you both mean
the same thing by replaces a paragraph of clarification.

## The circuit underneath

The structure under all of this goes loops → graphs → circuits. An agent loop
is the simplest thing; a workflow is a graph of loops; a circuit adds modules,
pins, traces and buses, so the same structure describes an agent workflow, an
app's node graph and syn's own state machine. The model is defined in zen's
[Circuit model](https://github.com/satoramoto/zen/blob/main/docs/circuit-model.md).
In circuit terms, threads are chips, their links are traces, the month is the
board, and the base context is a bus every assistant taps.

## The name

**syn**: Greek *syn-*, "together"; short for synergy; a nod to the synapse,
where two cells meet. And a wink at the "sin" of merging your thinking with an
AI, which we don't think is one.

Two recursive expansions:

- **SYNS Is Not SINS.** SINS ("SINS Is Not Scrum") was an earlier experiment
  in autonomous loop drivers that moved a project while its owner was away.
  syn keeps you in the loop instead. See [prior art](docs/prior-art.md).
- **SYNS Yields Nirvanic Software.** What it's for.

## What syn is not

- Not an autonomous agent that works unattended and merges on its own.
- Not a ticket system, a scrum board or a project manager.
- Not a rule book: rules live in your `CLAUDE.md` and each repo's `AGENTS.md`;
  syn's files hold state and vocabulary.
- Not a model-based classifier of your asks: routing uses observable signals.
- Not a secrets manager: it holds references, never values.
- Not a fork of Claude Code: it's templates plus a plugin on stock Claude Code.

## Scope of the proof of concept

In:
- this vision and the [spec](docs/spec.md) of the session machine;
- the [lexicon](docs/lexicon.md);
- starter templates (`templates/`): `BRAIN.md`, `LEXICON.md`, a base context,
  agent definitions, and a `CLAUDE.md` snippet with the working rules;
- a **naked Claude** Docker image to compare syn against stock Claude Code;
- a skeleton `syn` plugin (`plugin/`) with a `/syn` command that reads
  `BRAIN.md` and prints the inbox count, and an `/syn onboard` stub.

Next, not in this POC yet:
- **the real mod**: the state machine, guards, routing log and the pane
  (brain state, jobs in flight, and the inbox as a quiz), built out from the
  plugin skeleton;
- onboarding implemented end to end;
- the machine editor on zen's graph primitives;
- an installer.
