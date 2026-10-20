---
description: Turn an intent ("I'd like to …") into a sealed blueprint the next phase can act on without asking back
argument-hint: <intent>
---

Turn the intent in `$ARGUMENTS` into a blueprint: a self-contained statement
of proposed action that informs Ryan and surfaces every ambiguity before
anyone acts on it. The words are in `~/.syns/LEXICON.md` ("The blueprint");
the shape is in `docs/epics.md` ("The blueprint"). Seven moves, each with
one output; the blueprint is the last.

1. **Intent.** Record Ryan's words verbatim, dated, in
   `~/.syns/epics/<id>/blueprint.md` under Intent (pick a kebab-case `id`
   not yet a folder there, and the brain pod it belongs to). Nothing edits
   them from here on. Append one ledger line to `~/.syns/memory.jsonl`:
   `epic.status`, `from: null`, `to: "draft"`.
2. **Perspectives.** Name who will read the result: Ryan (deciding), the one
   who will act on the blueprint, a cold reader later, and the user of the
   artifact if it has one. Write them under Intent.
3. **Draft.** Write Action: sentences, each naming the fragment of Intent it
   serves and the check that will call its materialization true or false.
   No technique, stack or agent the intent did not name. Where the artifact
   has an interface, show its form once, in the least that fixes the edge.
4. **Readings.** Each named perspective reads the draft independently (one
   agent per perspective, in parallel, briefed with the draft alone) and
   returns only: terms it can read two ways, and what it would have to ask
   before acting. These readings are the measurement of ambiguity.
5. **Alignment.** For each term returned: cite anchors with their distances
   (where each equals the term, where it does not), then resolve it. A
   reversible resolution is yours, written with "veto open"; the rest go to
   Ryan as `kind: "question"` inbox items in one batch (ids continuing from
   the highest in `inbox` and `answered`, the recommended option first,
   `"epic": "<id>"`). Every row of Ambiguities has its decider. Rev + 1.
6. **Convergence.** Repeat 4 and 5 until a full set of readings returns zero
   new two-way terms and zero questions. No count or length is a stopping
   rule; the empty reading set is.
7. **Decision and seal.** Raise one `kind: "approval"` inbox item (not
   reversible, options do it / change / no, `"epic": "<id>"`), set the
   epic's `status` to `review` with its ledger line, and mirror Action into
   `epic.json` (`outcomes`: each sentence as `text`, its check as `proof`)
   so the dashboard and ledger read it. Ryan answers from one reading. "Do
   it" seals the blueprint: its Decision line is written, and it is handed
   to the next phase once; you are, by rule, unavailable to that phase. A
   question from it is a new intent and a new blueprint; a sealed one is
   never edited. "Change this" is a recorded decision and returns to move 3.

Before sealing, the exit test: a reader who was not the proposer receives
the blueprint alone and states the action and the checks back. If they
cannot, it is not sealed.

End with one line: the folder path, the rev, how many ambiguities were
resolved by you and how many went to Ryan.
