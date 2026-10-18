# syn: the session machine

Status: **the written-down future, not the build plan.** Nothing here is
built beyond the plugin skeleton in `plugin/`. What gets built next is the
smallest milestone on [VISION.md](../VISION.md)'s Roadmap; parts of this spec
land only when the workflow needs them, and change as they do. Background and vocabulary: [VISION.md](../VISION.md),
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
  board: Pod[];               // in priority order
  shelf: string[];            // parked, one line each
  done: { date: string; text: string }[];
};

type Pod = {
  id: number;                 // its place on the board when created; stable
  title: string;
  why: string;
  state: string;
  next: string;
  lead: string | null;        // the lead session's id, or null
  sessions: string[];         // its task session ids
  links?: string;             // "feeds 2; needs 1"
  repo?: string;              // path, when the pod has one
};

type InboxItem = {
  id: number;
  kind: 'approval' | 'question' | 'term';
  pod: string;                // a pod id, "lexicon", "brain" or "shelf"
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
4. Claude proposes every change to brain state in one line (a new pod, a
   new state or next step, an item answered); the plugin writes it once you
   accept, or immediately for inbox items Claude adds.
5. An answered item updates what it was about (the pod's state, the spec,
   the lexicon), then leaves the inbox. A veto that overrides a
   recommendation that work already proceeded on becomes a job of its own.

### Buckets (draft)

Buckets instead of time boxes: anything may happen at any time, but each
pod has a maximum it may take, and buckets can give time to each other.
Proposed terms, awaiting acceptance: **bucket**, **allowance**, **spend**,
**transfer**, **tangent**.

```ts
type Bucket = {
  pod: number;
  allowance: number;          // no period (open question 6), in the unit of open question 7
  spent: number;              // derived from the log, never typed in
  transfers: Transfer[];
};

type Transfer = {
  id: number;
  from: number;               // pod id
  to: number;
  amount: number;
  at: string;                 // ISO time
  reverted?: string;          // set when undone
};
```

- **K1.** Every pod on the board or shelf has a bucket. A pod without
  an allowance gets the default for where it sits (board or shelf).
- **K2.** Spend is measured from the log (rule 40): the main session's active
  time on the pod's asks, plus agent time and tokens attributed through the
  pod's jobs. The exact formula is open question 7.
- **K3.** A tangent (an ask about a different pod, or about no pod yet)
  is never refused or deferred. It's attributed to its own pod; an ask
  about a new idea creates a shelf pod with the small default bucket.
- **K4.** When a bucket's spend passes its allowance, syn adds one inbox
  question ("X is over its bucket: borrow from Y, raise it, or park X?") with
  a recommendation, and work continues. No turn is stopped or sent back for
  it, and the same bucket isn't raised again until that item is answered.
- **K5.** A transfer is explicit (an inbox answer or `/syn bucket`), is
  logged, and is reversible: reverting it restores both allowances.
- **K6.** Buckets have no period and never reset, so nothing carries over:
  the brain reflects the latest state however long it's been. An allowance
  changes only when it's set or by a transfer.
- **K7.** The pane shows each pod's bucket as a reading: label, thin flat
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
   to the inbox as approvals). Seed candidate pods from recently active
   repos.
9. **Notes.** Ask for an Obsidian vault or any folder of markdown notes. Read
   it, and never write to it unless asked, to seed pods, their why, and the
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
  state, the pod it serves (if any), the inbox items blocking it, and a
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

When a job is done, the pod it serves gets a proposed state and next-step
update (rule 4), and notable results go to `done`.

### Sessions in the sidebar

Each pod has a **lead session**, titled `[LEAD] <pod id>` and recorded in the
pod's `lead`, and its **task** sessions, titled `[<pod id>] <task name>` and
recorded in its `sessions`. The lead starts each task and files it, and
itself, in the sidebar group named after the pod, right after
`start_session` or `hand_off_to_session`. A task's title names what it is
doing now (under 60 characters); it retitles itself when its scope changes,
and the lead titles the tasks it starts.

When a task's report arrives (or on `/syn:close <session>`), the lead
**closes** it: it checks the work landed (the commit or merged PR the report
names, nothing uncommitted in its worktree, no process left), writes a
`task.closed` line to the ledger (session, pod, and what it left: commit, PR,
page), marks it completed and archives it. A task that didn't land isn't
closed; the lead raises an inbox question (close or continue). The lead
itself never closes; when heavy it is cleared and re-reads its pod folder.

The plugin has no hook for another session going quiet, so `/syn:standup`
and `/syn:back` tidy the sidebar: they file strays, flag stale titles
(retitling only sessions they started) and offer done tasks for closing.
`/syn:sweep` is the full audit of the board and the sessions: quiet pods,
shelf and done, built milestones, long-answered items, and sessions idle more
than 7 days or whose PR merged, asked as one quiz and applied, each change
with a ledger line. The procedure is the `session-housekeeping` skill.

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
    `normal` if none is set. The default mode, and syn's other per-repo
    state, lives in a `.syns/` folder in that repo (its data model is open
    question 8).
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
35. **Board:** one section per active pod, with its state and next step,
    and the jobs serving it under it.
36. **Jobs in flight:** one row each: owner icon (coloured by state), the
    ask's first words, the state, and what it's waiting on. A running job
    shows its current tool call.
37. **A graph view** draws the machine from its definition (SVG). States the
    current mode skips are dim; each job sits as a token on its state.
38. **Done** folds finished jobs, showing the last N.
39. **The terminal** gets the same layout in a terminal look.

### The dashboard today (`syns-dashboard`, built)

The first version is a re-entry view, for sitting back down after time away.
It opens on session start (and with `/syn-dashboard`), reads `$SYN_BRAIN` or
`~/.syns/brain.json`, and reads it again whenever its mtime moves (checked
every 2 s while the pane is shown; nothing runs while it's hidden). Sections,
in awesome-claude's inspector look on the desktop and the terminal:

- **Doing:** the top 3 active pods by priority, each its
  title (up to the first colon), priority, and its `next` (first sentence);
  the rest of the title (what it's about) behind a per-pod fold. Every
  section is a collapsible list (header and items one surface, hairlines
  between items), each item a two-line list item.
- **Decided:** the last 8 answered inbox items (from `inbox` and `answered`),
  newest `answer.at` first. Each item's title is its question in one line (the
  item's `title` or `topic` when it has one, else the question's first
  sentence), with its age; under it the decision, called out (✓, bold): the
  choice, or the note's first sentence when the choice was Other. Behind a
  per-item fold, folded by default: the full question, the note, and why (the
  chosen option's description).
- **Agents:** live agents (`$.agent.list()`) with each one's latest tool call.
- **Pull requests:** the PRs brain.json names (`owner/repo#n` or a pull URL)
  that gh says are open, plus the user's open PRs updated in the last 7 days
  (a gh search, `updated:>=<date>`), so old ones fall off on their own; read
  when the list changes and every 5 minutes. Each PR is two lines, as the
  app's own PR list: its state icon (open, draft, merged, closed, the colour
  carrying it), the title; then dim, the short repo name and `#n` (the link)
  and a small coloured CI mark. A ⋮ on the right unfolds **Ignore** and
  **Ignore repo** inline: an ignored repo or PR drops out of the list
  and the counts for good (an ignored repo's future PRs too), kept in
  brain.json's `ignored` (below). The header counts them (**N ignored**); a quiet **Show N ignored** at the end of the body unfolds the
  ignored ones, each with **Stop ignoring**.
  An open PR's ⋮ also holds **Merge** and **Enable auto-merge** (or
  **Disable auto-merge** while it's on). Merge is irreversible, so its first
  press turns it into **Confirm merge** (danger tone) and the second merges;
  the confirm resets when the menu closes or after 5 s. Merge can't be pressed
  on a draft or conflicting PR, and says why. Both use the repo's default merge
  method (`viewerDefaultMergeMethod`), `--squash` when it's unknown: `gh pr
  merge <n> --repo <owner/repo> --<method>`, with `--auto` to enable auto-merge,
  `--disable-auto` to turn it off. A PR with auto-merge on shows a dim
  **auto** after its CI mark. After any of them, a toast says how it went (gh's
  error when it failed) and the PRs are read again at once.
- **brain.json's `ignored`** holds what the user doesn't want to hear about
  again: `"ignored": { "repos": ["owner/name"], "prs": ["owner/repo#n"] }`,
  both lists optional. The dashboard writes it as it writes `updates`: it reads
  the file fresh, changes only this key, writes the file back and reads it
  again. On each write it drops from `prs` the refs the PR data already read
  shows merged or closed, and those an ignored repo covers (no extra gh
  calls). Refs under `ignored` don't count as PRs brain.json names.
- **Needs you:** open approvals, then the count of open questions and a button
  that runs `/syn:inbox`.
- **Next:** brain.json's own `next` if it has one, else the top pod's.
- A footer: **Standup** (`/syn:standup`) and **Brief** (`/syn:back`).

The sections above are the pane's first tab, **Overview**. The other tabs are
each in `syns-dashboard/hooks/<mod>/` (all but Tasks and Analysis were
awesome-claude's mods, syns source now), and each reads only while its tab is
shown:

- **Session** (`/syn-overview`): what Overview doesn't show of the session: its
  context window, the account's limits, activity (cost, time, turns, tools,
  files), git (the branch, its PRs, the branches the session started) and the
  machine. Tool calls and turns are counted whatever tab is shown.
- **Tasks** (`/syn-board`): every session's task list of the last week, by
  repo, with what waits on you (waiting sessions, brain.json's approvals) first.
- **Files** (`/syn-filetree [path]`): the file tree of the session's cwd (or the
  folder given), with Claude's reads, writes and git steps marked as they
  happen.
- **Issues** (`/syn-issues`): the repo's open GitHub issues, with refine, start
  and sprint prompts.
- **Launcher** (`/syn-launcher`, `/syn-preview`): the dev servers in
  `.claude/launch.json`: start, stop, restart, take over, their output. Servers
  it started keep running and logging on any tab.
- **Analysis** (`/syn-analysis`): the focus analyzer's last run
  (`~/.syns/files/focus/focus.json`): terms, buckets and topics, with Run and
  Open page.
- **Lab** (`/syn-lab [id]`), last, for mod authors: the index of engine
  experiments; each experiment opens in a pane of its own.

Each slash command opens the pane on its tab. **Blast Radius** has no tab: it
holds a risky Bash command (`rm -r`, `git reset --hard`, `git clean`, a force
push, a migration) and shows what it would change in a pane of its own, opened
only while a command is held, with Proceed and Cancel (in the band above the
prompt where the pane can't be placed).

Not built yet, and wanted as the work pulls them in: everything in 33–38
above (the session state and mode switch in the head, the quiz in the pane,
jobs as rows with their states, the graph view of the machine, Done), guards
and modes shown on it, each pod's bucket as a reading (K7), previews
registered in brain.json listed and launched from it, and events from
`memory.jsonl` (the ledger) in place of mtime polling.

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
- `/syn bucket [pod] [set <allowance> | give <amount> to <pod> | revert <id>]`:
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

1. Settled: the routing signal is tool calls, not wall time; `self_limit` is
   a count (rule 15).
2. Settled: production denies commits to the default branch, and the guard
   names the mode (rule 23).
3. Settled: per-repo default modes, and syn's other per-repo state, live in a
   `.syns/` folder in the repo (rule 20).
4. Settled: there's no separate job state to survive a restart. `brain.json`
   is always the current state, and anything in flight that matters is
   written there. Gap to close: this spec still has the plugin hold jobs and
   rebuild them from the log (Jobs, Log and measurement), and still names
   `BRAIN.md` rather than `brain.json` as brain state.
5. Should `BRAIN.md` stay markdown parsed by the plugin, or become JSON with a
   rendered markdown view? (★ markdown: it's edited by hand.)
6. Settled: buckets have no period. The brain reflects the latest state
   regardless of elapsed time (K6).
7. The spend formula: how do the main session's active time, agent wall time
   and tokens combine into one number? (★ minutes only, main-session active
   time plus agent wall time, with tokens shown beside it but not counted,
   until the log shows which tracks effort better.)
8. The `.syns/` per-repo data model (rule 20): what files it holds, their
   JSON shape, and what's committed versus gitignored. To be designed.
