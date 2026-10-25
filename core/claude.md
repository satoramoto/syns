<!--
syns core, Claude Code only. ~/.claude/CLAUDE.md imports core/AGENTS.md and
then this file. Only what names Claude Code's own tools, agents or models.
-->

## Claude Code

- Edit files with the Edit and Write tools. Backslash-escaped paths break Claude Code's permission model.
- **Browser pane:** for any check, open your own background tab with `tabs_create` and pass its `tabId` to every browser call (leaving it out acts on my tab); close it when done.
- **Roles as agents:** `developer`, `worker`, `assistant` and `test-engineer` run on Opus 5.5 at medium effort; `reviewer` runs on Sonnet. Never use Haiku. Definitions live in `~/.claude/agents/`.
- **The `assistant` is a distilled base context, forked per ask.** Maintain a curated base in `.claude/base-context.md` (gitignored): what the repo is, the conventions and checks that matter, and the engine facts that bite. Every `assistant` you start opens with that file word for word, then its own ask, so they all share one cached prefix. Keep facts that change often out of it, or at its end. The assistant may start `developer`s and other agents itself. For tangential asks, start several in parallel on that base (on disjoint files) instead of queueing them. Update the base as the work moves on; the next forks share the new prefix. Follow-ups to a running assistant go through SendMessage.
- **PRs:** with auto-merge, also turn on Auto-fix so CI failures and conflicts arrive as events.
