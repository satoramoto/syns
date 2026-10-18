---
description: Sweep the board and the sessions - quiet pods, shelf and done, built milestones, old answers, idle or merged sessions - as one quiz, then apply
---

Audit the board and the sessions, ask about what looks finished or stale in
one quiz, then apply the answers. The brain file is `$SYN_BRAIN`, or
`~/.syns/brain.json`; the ledger is `~/.syns/memory.jsonl` beside it. Today
is the date the ages below count from.

1. **Gather, without asking.** Read the brain file and the ledger, then:
   - each pod's **last activity**: the newest of its ledger lines (`parent`
     or `pod` is the pod's id, or an epic whose `pod` it is), its
     sessions' `lastActivityAt` (`mcp__ccd_session_mgmt__list_sessions`;
     the pod's `lead` and `sessions`, and any session titled `[LEAD] <pod
     id>` or `[<pod id>] …`), and PRs merged in its `repos` (`gh pr list
     --repo <r> --state merged --limit 5 --json number,title,mergedAt`,
     only for repos with a GitHub remote);
   - the items in `shelf` and `done`;
   - milestones with `status` `built` or `done`;
   - `answered` items whose `answer.at` is more than 14 days old;
   - sessions idle more than 7 days, or whose PR (named in their title, the
     brain or their report) has merged. A pod's lead is only swept with its
     pod.
2. **Pick the items.** A pod is an item when its last activity is more than
   7 days old or its `status` is `decided`; a shelf item when it is more than
   30 days old (its `at`, or its id's earliest ledger line); a `done` entry
   when its `at` is more than 30 days old; every built or done milestone;
   every old answered item; every idle or merged session. Nothing picked:
   say "Nothing to sweep" and stop.
3. **Ask with the question tool**, up to 4 items per call, ordered: sessions
   whose PR merged, then pods, milestones, sessions idle, shelf, done,
   answered. Each item:
   - the header is its kind and id ("Pod circuit", "Session 3f2a…",
     "Milestone syn/M1");
   - the question names it and why it's here, in one line ("circuit: last
     activity 2026-10-09, no open sessions");
   - the options, with the recommended one first and labelled
     "(Recommended)":
     - **pod:** keep / shelve / close. Recommend shelve when quiet more than
       7 days with no open sessions, close when `decided`, else keep;
     - **milestone:** keep / shelve / close. Recommend close for `done`,
       keep for `built` while its pod is active;
     - **session:** archive / keep. Recommend archive when its PR merged or
       its report is in;
     - **shelf item:** keep / close; **done entry** and **answered item:**
       keep / clear. Recommend close or clear.
   The user can always answer "Other".
4. **After each batch, apply the answers right away**, each with one ledger
   line (`{"id": "<parent>-<nnnn>", "parent": <pod or "brain">, "at": <ISO
   time>, "event": …, "by": "Ryan", "via": "/syn:sweep", "note"?}`, the
   number continuing from the highest for that parent):
   - **pod shelve:** move it from `pods` to `shelf` with `"shelvedAt":
     <date>`; `pod.shelved`. **pod close:** move it to `done` as `{"at":
     <date>, "pod": <id>, "note": <its title and last state>}`;
     `pod.closed`. Either way, close its open task sessions with the
     `session-housekeeping` skill's close step, then archive its lead
     (`mcp__ccd_sidebar__mark_completed`,
     `mcp__ccd_session_mgmt__archive_session`).
   - **milestone shelve:** its `status` becomes `shelved`;
     `milestone.shelved`. **close:** remove it from the pod's `milestones`;
     `milestone.closed`, with the milestone in the line.
   - **session archive:** the close step (it checks the work landed; one
     that didn't becomes an inbox question instead).
   - **shelf close:** move it to `done` with the date; `shelf.closed`.
     **done clear** and **answered clear:** remove it from the brain file;
     `done.cleared` or `answered.cleared`, with the whole item in the line so
     the ledger keeps it.
   - **keep:** nothing changes and no line is written.
   A dismissed batch changes nothing.
5. Keep going batch by batch until every item is answered or the user stops.
   Never ask anything outside the sweep during the run.
6. End with one line of counts: e.g. "Swept 12: 2 pods shelved, 1 closed;
   1 milestone closed; 4 sessions archived (1 didn't land, inbox 53); 3
   answered cleared; 1 kept."
