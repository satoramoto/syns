# Brain state: <Month YYYY>

What I'm working on, why, in what order, and what's next. Claude keeps it
current during the session: it proposes each change in a line, and I accept or
correct it. This file is the source of truth; a session's memory is not.

Copy to `~/.claude/BRAIN.md` (or run `/syn onboard` to draft it). Replace the
examples below.

## Inbox

Answered whenever I have time, as a quiz (`/syn quiz`). Work continues on
everything an item doesn't block. **Approvals** block their job. **Questions**
carry Claude's recommendation (★); reversible ones proceed on it and stay here
as a veto until answered. **Terms** are coined words waiting for the lexicon.

| # | Kind | Pod | Item | ★ Recommendation | Blocks |
| --- | --- | --- | --- | --- | --- |
| 1 | question | 1 | Store sessions in Postgres or SQLite for the first release? | SQLite (one file, no service to run) | nothing (proceeding) |
| 2 | approval | 1 | Create the public GitHub repo `you/example-app`? | private until it works, then public | pushing |
| 3 | term | lexicon | Accept **slice** for one vertical piece of a feature? | accept | nothing (in use) |

## Board (active pods, by priority)

### 1. <Pod title>
- **Why:** why it matters, in a sentence or two.
- **State:** where it stands now.
- **Next:** the next concrete step.
- **Lead:** the lead session's id, or none yet.
- **Sessions:** its task session ids (optional)
- **Repo:** `~/Code/you/example-app` (optional)
- **Links:** feeds 2; needs 3 (optional)

### 2. <Pod title>
- **Why:**
- **State:**
- **Next:**

## Shelf (parked)

- An idea that isn't active this month.

## Done this month

- YYYY-MM-DD: what finished.
