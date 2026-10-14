---
description: Run through the inbox in BRAIN.md as a quiz, then apply the answers
---

Run the user through their inbox, then apply what they decide. This is M1 of
syn: the smallest version of the approval loop.

1. Read the Inbox table in `~/.claude/BRAIN.md` (or the path in `$SYN_BRAIN`).
   Order the items: approvals first, then questions that block something,
   then the rest.
2. Ask with the question tool, up to 4 items per call. For each item:
   - the question is the item, phrased as one clear question;
   - the header is its kind and number (e.g. "Approval 14");
   - the first option is the ★ recommendation, labelled "(Recommended)", with
     one to three real alternatives.
   The user can always answer "Other".
3. After each batch, apply the answers right away:
   - update whatever each answer decides (a spec, a contract, the lexicon,
     BRAIN.md's board);
   - remove answered items from the Inbox table and add one line each to an
     "Answered" list under it (date, number, the decision);
   - an approval means the action it names may now happen, so do it, or hand
     it to an assistant.
4. Keep going batch by batch until the inbox is empty or the user stops.
   Never ask anything outside the inbox during the run.
5. End with one line: how many were answered, what's left, and what each
   answer unblocked.
