# syn: the session machine

Status: **draft.** Nothing is built yet beyond the plugin skeleton in
`plugin/`. Background and vocabulary: [VISION.md](../VISION.md),
[lexicon](lexicon.md), [prior art](prior-art.md).

## Outcomes

The top-level outcome: syns enables the user to manifest their ideas by
maintaining a blissful and effortless flow state. The machine serves it:

- You describe changes; the session starts on them at once and stays
  responsive to your next message.
- Brain state and the inbox are the session's memory: plain files you can read
  and edit, which survive compaction and restarts.
- Every open question for you is in the inbox, never lost in the transcript.
  Approvals block their job; questions carry a recommendation and don't.
- Routing (who does the work, which checks run, whether a PR or review is
  needed) is decided by explicit rules in code, not by the model's
  interpretation of prose.
- You can see at a glance what the session is doing, what's in flight and
  what's waiting on you.
- Every ask and transition is logged, so routing rules and modes can be
  benchmarked on real numbers.
- Working styles ("modes") are presets of one machine, so concepts are shared
  and new modes cost a record, not new code.

## Never interrupt, batch

Interruptions are the biggest anti-pattern (see [VISION.md](../VISION.md)).
Concretely:

- **B1.** Every question an agent or the main session has for the user is
  queued in the inbox; the model is told (through a guard's send-back, rule
  32) to add it there instead of ending its turn on it.
- **B2.** A turn that would end on a question to the user while other work is
  unblocked is sent back from `classic.Stop` with "add it to the inbox and
  continue".
- **B3.** A blocking approval is surfaced (as a quiz prompt) only when the main
  session is otherwise idle: no jobs in flight that it doesn't block, and the
  user has sent nothing new. Otherwise it waits in the inbox and the head's
  count.
- **B4.** Agent reports and job completions are folded into the pane and the
  next hidden-context line (rule 31). The main session relays them at a
  natural pause (the end of its current reply, or when asked), batched, never
  one message per completion.
- **B5.** Each permission prompt is logged as an interruption with its tool and
  pattern. `/syn stats` lists the repeat offenders and proposes an allowlist
  entry or rule for each, as an inbox approval.
- **B6.** The log counts interruptions per job and mode (questions that
  stopped a turn, approvals surfaced, permission prompts), so the number can
  be driven down.

## Core data model: brain state and the inbox

Brain state lives in `BRAIN.md` (default `~/.claude/BRAIN.md`; template in
[`templates/BRAIN.md`](../templates/BRAIN.md)). The file is the source of
truth; the plugin parses it and writes it back, and never keeps a second copy
that could drift.

```ts
type Brain = {
  month: string;              // "2026-10"
  inbox: InboxItem[];
  board: Thread[];            // in priority order
  shelf: string[];            // parked, one line each
  done: { date: string; text: string }[];
};

type Thread = {
  id: number;                 // its place on the board when created; stable
  title: string;
  why: string;
  state: string;
  next: string;
  links?: string;             // "feeds 2; needs 1"
  repo?: string;              // path, when the thread has one
};

type InboxItem = {
  id: number;
  kind: 'approval' | 'question' | 'term';
  thread: string;             // a thread id, "lexicon", "brain" or "shelf"
  text: string;
  recommendation: string;     // required for question and term
  blocks: string;             // a job or step, or "nothing (proceeding)"
  answer?: string;            // set when answered; the row then moves out
};
```

1. **Approvals** block the job named in `blocks`. A job blocked by an open
   approval can't leave its current state; the guard's reason names the item.
   Anything irreversible or outward-facing (a new remote, publishing, deleting,
   merging to the default branch, sharing) is an approval.
2. **Questions** always carry a recommendation. When the decision is
   reversible, work proceeds on the recommendation and the item stays open as
   a veto. When it isn't, it's an approval instead.
3. **Terms** are coined words awaiting acceptance into the lexicon; accepted,
   they move to `LEXICON.md`.
4. Claude proposes every change to brain state in one line (a new thread, a
   new state or next step, an item answered); the plugin writes it once you
   accept, or immediately for inbox items Claude adds.
5. An answered item updates what it was about (the thread's state, the spec,
   the lexicon), then leaves the inbox. A veto that overrides a
   recommendation that work already proceeded on becomes a job of its own.

### Buckets (draft)

Buckets instead of time boxes: anything may happen at any time, but each
thread has a maximum it may take, and buckets can give time to each other.
Proposed terms, awaiting acceptance: **bucket**, **allowance**, **spend**,
**transfer**, **tangent**.

```ts
type Bucket = {
  thread: number;
  allowance: number;          // per period (open question 6), in the unit of open question 7
  spent: number;              // derived from the log, never typed in
  transfers: Transfer[];
};

type Transfer = {
  id: number;
  from: number;               // thread id
  to: number;
  amount: number;
  at: string;                 // ISO time
  reverted?: string;          // set when undone
};
```

- **K1.** Every thread on the board or shelf has a bucket. A thread without
  an allowance gets the default for where it sits (board or shelf).
- **K2.** Spend is measured from the log (rule 40): the main session's active
  time on the thread's asks, plus agent time and tokens attributed through the
  thread's jobs. The exact formula is open question 7.
- **K3.** A tangent (an ask about a different thread, or about no thread yet)
  is never refused or deferred. It's attributed to its own thread; an ask
  about a new idea creates a shelf thread with the small default bucket.
- **K4.** When a bucket's spend passes its allowance, syn adds one inbox
  question ("X is over its bucket: borrow from Y, raise it, or park X?") with
  a recommendation, and work continues. No turn is stopped or sent back for
  it, and the same bucket isn't raised again in the period until that item is
  answered.
- **K5.** A transfer is explicit (an inbox answer or `/syn bucket`), is
  logged, and is reversible: reverting it restores both allowances.
- **K6.** Buckets reset at the start of each period. Unspent allowance does
  not carry over.
- **K7.** The pane shows each thread's bucket as a reading: label, thin flat
  gauge (spent over allowance), value, unit.

### The inbox as a quiz

6. `/syn quiz` (and the pane's inbox section) asks the open items one at a
   time, oldest blocking item first, through Claude Code's question UI: the
   item, the recommendation as the first choice marked ★, the other options,
   and a free answer.
7. Skipping an item leaves it open. Answers are written back to `BRAIN.md` as
   they're given, so a quiz can stop at any point.

## Onboarding

`/syn onboard` builds a first brain state and is re-runnable (monthly, when
the brain state turns over). Each step asks before it reads anything.

8. **Code.** Ask for the code root(s). Scan the repos under them for their
   agent setup (`AGENTS.md` with a check table, `CLAUDE.md`, a gitignored base
   context, agent definitions, CI) and recent activity (commits in the last
   weeks). Report it as an audit: which repos fit the approach and which
   deviate, with a proposal to normalize each one that deviates (proposals go
   to the inbox as approvals). Seed candidate threads from recently active
   repos.
9. **Notes.** Ask for an Obsidian vault or any folder of markdown notes. Read
   it, and never write to it unless asked, to seed threads, their why, and the
   vocabulary the user already uses.
10. **Secrets.** Ask for the 1Password vault. syn stores only the vault name
    and item references (`op://<vault>/<item>/<field>`), never a secret's
    value. **The boundary:** syn never reads, prints, logs or passes a secret
    to the model. Tools that need one resolve its reference at run time
    through the 1Password CLI (`op run`, `op read` inside the tool's own
    process), and the user approves each item in 1Password. References may
    appear in base contexts and configs; values never appear anywhere syn
    writes.
11. **Interview.** A quiz on the user's current mindstate: what are you
    working on, why does it matter, what's the priority, what's next, and
    what's on the shelf. It runs through Claude Code's question UI, with
    recommendations first, drafted from steps 8 and 9.
12. **Output.** It drafts:
    - `BRAIN.md` (board, shelf, and an inbox holding the questions it couldn't
      settle);
    - `LEXICON.md` seeded with the user's own terms;
    - a base-context draft (`.claude/base-context.md`) for each active repo.
    The user approves each output before it's written. On a re-run, existing
    files are shown as a diff against the draft, never overwritten silently.

## Jobs

- **Session:** the main Claude session. It is either talking or busy in its
  own turn, and has a set of jobs in flight.
- **Ask:** one request from the user (a prompt from the composer).
- **Job:** the unit of work an ask becomes. It has an id, an owner, a mode, a
  state, the thread it serves (if any), the inbox items blocking it, and a
  history of transitions. Several jobs can be in flight at once.
- **Owner:** `self` (the main session in its own turn), `assistant`,
  `developer`, `test-engineer` or `workflow:<name>`.
- **Mode:** a named policy record (see Modes).
- **Event:** something observed through an engine hook (see Events).
- **Guard:** a check, run by a hook, that allows, denies or sends back a
  transition, according to the job's mode and the inbox.

### Lifecycle

One lifecycle, shared by every mode:

```
asked → routed → working → checked → [tested] → committed → [reviewed]
      → [pr_open → ci → merged → pulled] → done
```

A job can also go to `blocked` (an open approval names it; it returns to the
state it left once the approval is answered), `failed` (with a reason) or
`cancelled` from any state. `fixing` is entered from `ci` on a failure or
conflict, and returns to `ci` once pushed.

Bracketed steps exist in every mode. A mode marks each one `required`,
`on_request` or `skipped`.

| State | Meaning | Leaves on |
| --- | --- | --- |
| asked | an ask arrived and isn't routed yet | routing decision |
| routed | owner chosen | owner starts (first tool call or agent spawn) |
| working | owner is editing or running commands | owner reports, or its turn ends |
| blocked | an open approval names this job | the approval is answered |
| checked | the mode's per-change checks passed (exit 0) | next required step |
| tested | tests written or run to a spec by a test-engineer | report per spec item |
| committed | change committed locally | next required step, or done |
| reviewed | reviewer verdict received and triaged | PR opened |
| pr_open | PR exists, auto-merge and auto-fix are on | CI result |
| ci | CI running | pass → merged (via auto-merge); fail → fixing |
| merged | GitHub reports the PR merged | local fast-forward |
| pulled | the checkout is level with origin | done |

When a job is done, the thread it serves gets a proposed state and next-step
update (rule 4), and notable results go to `done`.

## Events (engine sources)

| Event | Hook or call |
| --- | --- |
| ask from the user | `prompt.submit` with `origin.kind = composer` |
| task or agent finished | `prompt.submit` / `session.receive` with origin `task-notification` |
| turn start / end (any agent) | `turn.start`, `turn.complete` (`agentId`, `durationMs`, `usage`) |
| tool call (any agent) | `tool.call` (`agentId` set inside a subagent) |
| agent spawned | `agent.spawn` (also a workflow's `agent()`) |
| subagent stopped | `classic.SubagentStop` |
| main turn about to end | `classic.Stop` (lists `background_tasks`) |
| PR events | `session.receive` with `source: github`; `tool.call` on PR tools |
| `BRAIN.md` changed on disk | file watch; the plugin re-parses it |
| mode change, manual transitions, quiz answers | `command.run` for the plugin's commands; pane buttons |

## Routing

13. Each ask creates a job in `asked`, tagged with the session's current mode.
14. Questions (asks with no change implied) are answered by `self` and close
    as `done` without entering `working`. The model declares this by answering
    without editing; no classifier is needed.
15. A job is owned by `self` until the main turn makes more tool calls on it
    than the mode's `self_limit`. Past that, the guard sends the turn back from
    `classic.Stop` ("delegate the rest to the assistant") the first time, and
    the excess is logged as a routing miss.
16. Spawning an `assistant`, `developer` or `test-engineer` for a job moves it
    to `routed` with that owner. `agent.spawn` records the link from agentId to
    job. Every assistant's prompt opens with the repo's base context word for
    word.
17. A `developer` is allowed only when the job is marked a feature (by the
    user's wording "feature", or `/syn feature`). Otherwise the guard on
    `agent.spawn` rewrites a `developer` spawn to `assistant` and logs it.
18. When an agent's report contains a question for the user, it goes to the
    inbox (with the agent's recommendation) rather than into the transcript.

## Modes

| Field | Values |
| --- | --- |
| `checks` | `build` / `build+compile` / `full` |
| `tests` | `skipped` / `on_request` / `required` |
| `review` | `skipped` / `on_request` / `required` |
| `pr` | `never` / `on_request` / `every_change` |
| `bumps` | `never` / `per_pr` |
| `self_limit` | tool calls the main turn may spend on a job before delegating |
| `commit_to_default_branch` | `allowed` / `denied` |

| Field | scrappy | normal | production |
| --- | --- | --- | --- |
| checks | build | build+compile | build+compile |
| tests | skipped | on_request | required |
| review | skipped | skipped | required |
| pr | never | on_request | every_change |
| bumps | never | per_pr | per_pr |
| self_limit | 3 | 2 | 2 |
| commit_to_default_branch | allowed | allowed | denied |

19. `/syn mode <name>` switches the session's mode for new jobs. Jobs in
    flight keep the mode they started with. The switch is logged.
20. Each repo can name a default mode; a new session starts in it, or in
    `normal` if none is set.
21. A new mode is a new record. Adding one needs no new states or hooks.

## Guards

Each guard runs in a hook, reads the job's mode and the inbox, and logs its
decision.

22. **Open approval:** a tool call that would advance a job named by an open
    approval is denied, and the job goes to `blocked`. The reason names the
    inbox item.
23. **Commit on the default branch:** denied when `commit_to_default_branch`
    is `denied`. The reason names the mode.
24. **PR without review:** when `review` is `required`, opening a PR for a job
    not in `reviewed` is denied with the reason.
25. **PR settings:** every PR opened gets auto-merge and auto-fix. If the turn
    ends with a PR open and either is off, `classic.Stop` sends the turn back.
26. **Push to a merged PR:** a push to a branch whose PR has merged is denied,
    with the reason "start a new branch from the default branch".
27. **Merged → pulled:** on a `merged` event, the plugin fast-forwards the
    checkout if it is clean and on the default branch; otherwise it tells the
    model to pull. There is no polling.
28. **Processes:** at a job's end, any process the job recorded starting is
    stopped by its recorded ID. Never by name or port.
29. **Tests in scrappy:** when `tests` is `skipped`, spawning a test-engineer
    or running a test command is allowed only on the user's explicit ask.
    Otherwise it is logged as a routing miss, not denied.
30. **Secrets:** a tool call whose output would include a resolved secret
    (e.g. `op read` in the main session) is denied; references are fine.

## Context the model gets

31. On each prompt, `prompt.submit` adds one short line of hidden context: the
    mode, the jobs in flight with owner and state, and the inbox count.
    Example: `mode normal · #31 pr_open waiting on CI · assistant #34 working ·
    inbox 3 (1 approval)`.
32. When a guard denies or sends back, the reason is the context. Rules are
    never repeated in prose.

## The machine is data

- The lifecycle (states, transitions labelled by events, guards on edges) and
  the modes live in one JSON definition, `~/.claude/syn/machine.json`, with a
  per-repo override at `.claude/syn.json`. The plugin reads it and reloads it
  when it changes.
- The definition is a Circuit (zen's
  [Circuit model](https://github.com/satoramoto/zen/blob/main/docs/circuit-model.md)):
  states are chips, transitions are traces, guards sit on traces. A small web
  app on zen's graph primitives edits it.
- The plugin validates the file on load: every edge names known states, every
  guard is a known guard, every mode sets every policy field. An invalid file
  is refused, and the last good one stays active with the error shown in the
  pane.

## Pane

33. **The head** shows the session state (`talking`, `thinking`, `delegated`),
    the mode with a control to switch it, and the inbox count.
34. **Inbox:** the open items, approvals first. Answering runs the quiz in the
    pane: one item at a time, the recommendation as the first choice (★), the
    alternatives, a free answer, and Skip.
35. **Board:** one section per active thread, with its state and next step,
    and the jobs serving it under it.
36. **Jobs in flight:** one row each: owner icon (coloured by state), the
    ask's first words, the state, and what it's waiting on. A running job
    shows its current tool call.
37. **A graph view** draws the machine from its definition (SVG). States the
    current mode skips are dim; each job sits as a token on its state.
38. **Done** folds finished jobs, showing the last N.
39. **The terminal** gets the same layout in a terminal look.

## Log and measurement

40. Every event, transition, guard decision and inbox change is appended to
    `~/.claude/syn/log/<yyyy-mm-dd>.jsonl`. Each line holds: time, session,
    job, mode, kind, from, to, owner, agentId, durationMs, the token usage, and
    the guard's decision and reason.
41. Per job, the plugin derives: time to first reply, route taken, time in
    each state, time blocked on the inbox, tool calls and tokens by owner, and
    whether CI passed first time. Routing misses are counted.
42. `/syn stats [mode] [days]` prints the per-mode numbers.

## Commands

- `/syn`: brain state at a glance: the inbox count, then the board.
- `/syn onboard`: onboarding (rules 8–12).
- `/syn quiz`: answer the inbox.
- `/syn bucket [thread] [set <allowance> | give <amount> to <thread> | revert <id>]`:
  show, set or transfer buckets.
- `/syn mode <name>`: switch mode for new jobs.
- `/syn feature`: mark the current ask a feature.
- `/syn stats`: numbers from the log.
- `/syn cancel <job>`: cancel a job.

## Non-goals (for now)

- Running feature or test workflows inside the plugin: it starts and tracks
  them.
- Cross-machine or shared logs and brain state.
- Classifying asks with a model. Routing uses observable signals only.
- Storing or handling secret values.

## Open questions

1. Is "more than `self_limit` tool calls → send back" the right routing
   signal, or should it count wall time in the main turn? (★ tool calls:
   observable and deterministic.)
2. Should production deny commits to the default branch, or only warn?
   (★ deny.)
3. Where do per-repo default modes live: the plugin's settings, or a line in
   each repo's `AGENTS.md`? (★ `AGENTS.md`, one place per repo.)
4. Should jobs survive a session restart, rebuilt from the log? (★ yes.)
5. Should `BRAIN.md` stay markdown parsed by the plugin, or become JSON with a
   rendered markdown view? (★ markdown: it's edited by hand.)
6. A bucket's period: a week or a month? (★ a week: a month gives no
   feedback until it's too late.)
7. The spend formula: how do the main session's active time, agent wall time
   and tokens combine into one number? (★ minutes only, main-session active
   time plus agent wall time, with tokens shown beside it but not counted,
   until the log shows which tracks effort better.)
