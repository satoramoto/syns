<!--
Base context for <repo>. Copy to <repo>/.claude/base-context.md and keep it
gitignored. Every assistant the session starts opens with this file word for
word, then its own ask, so all of them share one cached prefix. Keep it short
and stable: facts that change often go at the end, or nowhere.
-->

# <repo>: base context

## What it is

One paragraph: what the project does, its stack, and its layout (the few
directories that matter).

## How a change is made here

- A change is an edit, then `<build command>` and `<one compile check>`, then a
  commit. No tests unless the ask says so; tests are a separate step, to a
  contract.
- The checks and when to run each are in `AGENTS.md`.
- Commit where you're told (by default the current branch). Push only if told.
  If commit signing fails, stop and say so.
- Make file changes with the Edit and Write tools. Never change git config.
- Stop every process you start before you reply, and check with `ps`.

## Conventions that matter

- <naming, layout or style rules that an agent would otherwise get wrong>

## Facts that bite

- <engine, framework or tooling gotchas learned the hard way>

## Secrets

Referenced only, never stored or printed: `op://<vault>/<item>/<field>`.
Tools resolve them at run time through the 1Password CLI.

## Current (changes often)

- <what's in flight in this repo right now>
