# Lexicon

Shared words for talking about the work concretely. Like music theory, this
names things so we can point at them. It is not a rule book: rules live in
CLAUDE.md and AGENTS.md. One term, one meaning. When Claude coins a new term it
says so, and I accept, rename or reject it (as a **term** item in the inbox)
before it goes here.

Copy to `~/.claude/LEXICON.md`. The full syn vocabulary, with the Circuit and
Inspector terms, is in syns' `docs/lexicon.md`; keep only what you use.

## Session (how we work)

- **syn:** the whole system: one long-lived session as an extension of my
  brain.
- **Brain state:** what I'm working on this month (`~/.claude/BRAIN.md`).
- **Pod:** a domain with a why, a crew and a standing brief, on the board
  (brain.json `pods`, each with its why, priority, state, next step, `lead`
  (a session id or null) and `sessions` (its task session ids)).
- **Lead session:** a pod's long-lived session, the one I talk to. It owns the
  pod's brief, backlog and inbox lane, starts each task as its own session and
  receives each task's report. Titled `[LEAD] <pod id>`. It never closes; when
  heavy it is cleared and re-reads its pod folder.
- **Task:** the unit of work a pod owns, running in its own session, started
  by the lead. Lifecycle: started, working, waiting on me, done, then closed
  (archived) by the lead. Titled `[<pod id>] <task name>`, filed in a sidebar
  group named after the pod.
- **Close:** the lead checks a finished task landed (commit or merged PR,
  nothing uncommitted, no process left), writes a `task.closed` ledger line,
  marks it completed and archives it. `/syn:close <session>`.
- **Sweep:** `/syn:sweep`, the audit of the board and the sessions: stale
  pods, shelf, done, built milestones, old answered items, idle or merged
  sessions, asked as one quiz (keep / shelve / close; archive / keep) and
  applied.
- **Inbox:** every open item for me in one place. **Approvals** block their
  job; **questions** carry a recommendation and, when reversible, proceed on
  it as a veto. Answered as a **quiz**.
- **Ask:** one request from me.
- **Job:** the unit of work an ask becomes, with an owner, a mode and a state.
- **Mode:** a preset of policies: **scrappy**, **normal**, **production**.
- **Base context:** the curated, gitignored brief (`.claude/base-context.md`)
  every assistant opens with word for word, so they share one cached prefix.
- **Assistant:** a background agent opened with the base context.
- **Contract:** a spec's numbered behaviours plus its exact public API.
- **TDD in parallel:** a test-engineer and a developer start at once from one
  contract and meet when both are done.
- **Change:** an edit plus the build and one compile check, then a commit.
- **Test pass:** the separate step where tests and full suites run.
- **Routing miss:** an ask handled by the wrong owner.

## My terms

Words from my own projects and notes (onboarding seeds these).

- **<term>:** <one meaning>.
