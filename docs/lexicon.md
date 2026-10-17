# Lexicon

Shared words for talking about the work concretely. Like music theory, this
names things so you can point at them. It is not a rule book: rules live in
`CLAUDE.md` and each repo's `AGENTS.md`. One term, one meaning. When Claude
coins a new term it says so, and you accept, rename or reject it before it goes
in your `LEXICON.md` (start from [`templates/LEXICON.md`](../templates/LEXICON.md)).

## Session (how we work)

- **syn:** the whole system: one long-lived session as an extension of your
  brain, with brain state, the inbox, modes, routing and the circuit that runs
  it, shown by the `syn` plugin.
- **Brain state:** what you're working on this month (`BRAIN.md`): a board of
  threads, a shelf, done, and the inbox.
- **Thread:** one idea or workstream on the board, with its **why**,
  **priority**, **state** and **next** step.
- **Board:** the active threads, in priority order.
- **Shelf:** parked threads.
- **Inbox:** every open item for you in one place.
  - **Approval:** an item that blocks its job until you say yes.
  - **Question:** an item that carries Claude's **recommendation**; when the
    decision is reversible, work proceeds on it and the item stays as a
    **veto**.
  - **Quiz:** how the inbox is answered: one item at a time, recommendation
    first.
- **Onboarding:** the re-runnable `/syn onboard` walk (code, notes, secrets,
  interview, output) that seeds brain state, the lexicon and base contexts.
- **Ask:** one request from you.
- **Job:** the unit of work an ask becomes. It has an owner, a mode and a
  state.
- **Owner:** who does a job: self (the main session), assistant, developer,
  test-engineer, or a workflow.
- **Mode:** a preset of policies (checks, tests, review, PR, bumps,
  self-limit). Presets: **scrappy**, **normal**, **production**.
- **Guard:** a check in a hook that allows, denies or sends back a transition,
  according to the job's mode.
- **Base context:** the curated, gitignored brief (`.claude/base-context.md`)
  that every assistant opens with word for word, so all assistants share one
  cached prefix.
- **Assistant:** a background agent opened with the base context, for anything
  over a couple of tool calls.
- **Lane:** a slice of a feature that owns a set of files; one developer leads
  it on its own branch.
- **Contract:** a spec's numbered behaviours plus its exact public API. Both
  sides of TDD work from it.
- **TDD in parallel:** a test-engineer and a developer start at once from one
  contract, with no coordination, and meet when both are done.
- **Test pass:** the separate step where tests, validation and full suites
  run. Never part of a small change.
- **Change:** an edit plus the build and one compile check, then a commit.
- **Routing miss:** an ask handled by the wrong owner, e.g. long work done in
  the main turn.
- **Dogfood:** using one of your projects to move another along.

## Circuit (the structure)

The model behind graphs, workflows and the session machine. Defined in zen's
[Circuit model](https://github.com/satoramoto/zen/blob/main/docs/circuit-model.md);
in brief:

- **Circuit:** the whole document: modules and the board.
- **Board:** the root module, the top level you look at.
- **Module:** a reusable sub-circuit; each placed instance shares one
  definition.
- **Chip:** a component placed on a module: a node.
- **Pin:** a chip's connection point, with a side (in or out).
- **Trace:** a connection from an out pin to an in pin.
- **Modulation:** a trace into a parameter pin, with an amount.
- **Bus:** a named rail with one source and any number of taps.
- **Module pins** and **Controls:** what a module shows on its instances.
- **Zone:** a labelled area of a module.
- **Flatten:** expand every bus into direct traces.

In circuit terms: threads are chips, their links are traces, the month is the
board, and the base context is a bus every assistant taps.

## Proposed (awaiting acceptance)

Coined for time bucketing ([spec](spec.md), Buckets). Not accepted yet: each
is an inbox **term** until it is.

- **Bucket:** a thread's time budget for a period. A maximum, not a time box:
  the work may happen at any time.
- **Allowance:** how much a bucket holds per period.
- **Spend:** what a thread has used of its allowance, measured from the log.
- **Transfer:** an explicit, logged, reversible move of allowance from one
  bucket to another.
- **Tangent:** an ask that leaves the current thread; it's free, and draws
  from its own thread's bucket (a new idea gets a shelf thread).

## Inspector (how the pane looks)

- **Section:** a collapsible heading (icon, title, figures, fold chevron last)
  with readings indented under it.
- **Reading:** label, thin flat gauge, value, unit.
- **Figures:** the summary numbers on a section's heading.
- **Flow:** a wide pane splitting its sections into columns.
- **CollapsibleList:** a section drawn as one surface: its heading and its
  list items, hairlines between them.
- **ListItem:** one item in a CollapsibleList: a lead (icon or badge), a title,
  a dim subtitle, controls on the title line, and an optional fold.
- **Statusline:** the band above the prompt: Standup, the context bar, and what
  needs you.
- **Ignore:** never show this PR (or every PR of this repo) again; kept in
  brain.json's `ignored`, undone with "Stop ignoring".
