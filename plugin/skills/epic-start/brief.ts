// The epic-start brief: `bun plugin/skills/epic-start/brief.ts <epic id>`
// reads ~/.syns/epics/<id>/epic.json (alone), writes brief.md beside it and
// prints its path. The shape it reads is docs/epics.md's; the procedure that
// runs it is SKILL.md beside this file.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Outcome_ = { id: string; text: string; by: string; job: string; proof: string; status: string; proofs?: { url?: string; path?: string; note?: string }[] };
type Job = { id: string; what: string; owner: string; mode: string; state: string; outcomes: string[]; repo?: string; files?: string[]; commit?: string; at?: string };
type Epic = {
  id: string; thread?: string; mode?: string; rev?: number; status?: string;
  goal: string; why: string;
  approach?: { chosen?: string; alternatives?: { what: string; whyNot: string }[] };
  assumptions?: string[]; dependencies?: string[];
  risks?: { what: string; then: string }[];
  approval?: number; questions?: number[]; decisions?: number[];
  outcomes?: Outcome_[]; jobs?: Job[];
  evidence?: { kind: string; url: string; note?: string }[];
  revisions?: { rev: number; at: string; note: string }[];
  links?: { parent?: string | null; supersedes?: string | null; feeds?: string[] };
};

const id = process.argv[2];
if (!id) { console.error("usage: bun plugin/skills/epic-start/brief.ts <epic id>"); process.exit(2); }
const home = process.env.SYNS_HOME ?? join(homedir(), ".syns");
const folder = join(home, "epics", id);
const file = join(folder, "epic.json");
if (!existsSync(file)) { console.error(`no epic at ${file}`); process.exit(1); }
const e: Epic = JSON.parse(readFileSync(file, "utf8"));

const out: string[] = [];
const say = (...lines: string[]) => out.push(...lines);
const list = (items: string[], none: string) => (items.length ? items : [none]).forEach((x) => say(`- ${x}`));
const outcomes = e.outcomes ?? [];
const jobs = e.jobs ?? [];
const asked = jobs.filter((j) => j.state === "asked");
const others = jobs.filter((j) => j.state !== "asked");
const page = (e.evidence ?? []).find((x) => x.kind === "page" && (x.note ?? "").startsWith("the proposal page"));
// Jobs whose owner names the orchestrator's own role are the brief reader's.
const mine = (j: Job) => ["fable", "orchestrator"].includes(j.owner.toLowerCase());
const lastRev = (e.revisions ?? []).at(-1);

say(`# Brief: epic ${id}`, "");
say(`You run epic ${id} as its orchestrator: you start its jobs' agents, record proofs and the ledger; you do not do the jobs yourself.`);
say(`It is rev ${e.rev ?? 1}, status ${e.status ?? "unknown"}, thread ${e.thread ?? "none"}, mode ${e.mode ?? "normal"}` + (e.approval != null ? `; Ryan's approval is inbox ${e.approval} (its answer and note are in the brain's answered list).` : ".") + (lastRev ? ` The latest revision (rev ${lastRev.rev}, ${lastRev.at}): ${lastRev.note}.` : ""), "");

say("## Where the files are", "");
list([
  `The epic's folder: ~/.syns/epics/${id}/ (epic.json is the state you read and write; proposal.md is the argument; this brief is brief.md). Read epic.json and proposal.md in full before anything else.`,
  "The contract for the shape, the outcome rule and the ledger: ~/Code/satoramoto/syns/docs/epics.md.",
  "The brain, with the inbox: $SYN_BRAIN, or ~/.syns/brain.json.",
  "The ledger, append-only, one JSON object per line: ~/.syns/memory.jsonl.",
  ...(page ? [`The epic's page: ${page.url}. Regenerate it from ~/Code/satoramoto/syns/templates/epic-page.html when the epic changes and republish it to the same url (read it first, then publish with that url), with the capabilities comments (composer only), db and user; keep its Approval and Start rows.`] : []),
  "Temp files, experiments and intermediate output go in ~/.syns/scratch/<topic>/, never in a repo or a system temp folder; keepers that are not code go in ~/.syns/files/<topic>/.",
], "");
say("");

say("## Goal", "", e.goal, "", "## Why", "", e.why, "");

say("## Approach", "", e.approach?.chosen ?? "(none chosen)", "");
const alts = e.approach?.alternatives ?? [];
if (alts.length) { say("Considered and not taken:", ""); alts.forEach((a) => say(`- ${a.what}: ${a.whyNot}`)); say(""); }

const assumptions = e.assumptions ?? [], deps = e.dependencies ?? [];
if (assumptions.length || deps.length) {
  say("## Assumptions and dependencies", "");
  assumptions.forEach((a) => say(`- Assumed: ${a}`));
  deps.forEach((d) => say(`- Depends on: ${d}`));
  say("");
}

say("## Outcomes", "", "The acceptance: the epic is done when every one of these is proven, or dropped with its reason.", "");
if (!outcomes.length) say("- none");
for (const p of outcomes) {
  say(`- ${p.id} (${p.status}; by ${p.by}; job ${p.job}): ${p.text}`);
  say(`  Proof plan: ${p.proof}`);
  for (const pr of p.proofs ?? []) say(`  Proof so far: ${pr.url ?? pr.path ?? ""}${pr.note ? ` (${pr.note})` : ""}`);
}
say("");
const feeds = e.links?.feeds ?? [];
if (feeds.length) say(`What only a later epic can settle belongs to it, not here: ${feeds.join(", ")}.`, "");

say("## Jobs to start", "", "Each job in state asked, with its owner (the agent type that does it), its mode, what it is, where and which outcomes it serves:", "");
if (!asked.length) say("- none in state asked");
for (const j of asked) {
  say(`- ${j.id}: owner ${j.owner}${mine(j) ? " (this job is yours: the orchestrator's own role, nothing more than its what)" : ""}, mode ${j.mode}, serves ${j.outcomes.join(", ")}.`);
  say(`  ${j.what}`);
  if (j.repo) say(`  Repo: ${j.repo}`);
  if (j.files?.length) say(`  Files: ${j.files.join(", ")}`);
}
say("");
if (others.length) {
  say("Jobs already past asked (leave them to their sessions unless the ledger says they stalled):", "");
  for (const j of others) say(`- ${j.id}: ${j.state}, owner ${j.owner}, serves ${j.outcomes.join(", ")}${j.repo ? `, repo ${j.repo}` : ""}${j.commit ? `, commit ${j.commit}` : ""}.`);
  say("");
}

say("## The outcome rule and the ledger", "");
list([
  "An outcome is settled by this epic's own jobs, by the job and the proof it names. Jobs done is not the epic done: the epic is done only when every outcome is proven, or dropped with its reason in the ledger.",
  "Every job's agent gets its job, the outcomes it serves with their proof plans, and any cap or gate named in its what.",
  `At each job's start and end, append a job.state line: {"id": "${id}-NNNN", "parent": "${id}", "at": <UTC now>, "event": "job.state", "job", "owner", "outcomes", "from", "to"}, and set the job's state in epic.json.`,
  `When a job reports an outcome settled, append the artifact to that outcome's proofs ({kind: page|file|pr|run, url or path, note, at}; something Ryan can open), set its status to proven or refuted, and append an outcome.status line with outcome, from, to and proof (the url or path). A dropped outcome gets its reason in the line's note.`,
  `Ledger ids are ${id}-NNNN, the four-digit count of this epic's lines. Re-read the ledger right before each write; append, never rewrite.`,
  `When every outcome is settled, set status done (or dropped) with one epic.status line.`,
], "");
say("");

say("## Risks", "");
list((e.risks ?? []).map((r) => `${r.what}. Then: ${r.then}`), "none recorded");
say("");

say("## Open questions", "");
const qs = e.questions ?? [], decided = new Set(e.decisions ?? []);
const openQs = qs.filter((q) => !decided.has(q));
say(openQs.length
  ? `Inbox items ${openQs.join(", ")} in the brain are this epic's open questions. Proceed on the recommendation for reversible ones; approvals wait. A reversible one you proceed on is marked answered with its recommended choice and answer.note "proceeded on the recommendation; veto in the inbox"; when it changes the epic, apply it as a revision first (rev + 1, a revisions entry, one epic.revised line, the page republished).`
  : "None open in epic.json. Proceed on the recommendation for reversible questions you raise; approvals wait.");
if (qs.length > openQs.length) say("", `Already answered for it: inbox ${qs.filter((q) => decided.has(q)).join(", ")}.`);
say("");

say("## Working rules", "");
list([
  "Decide, don't ask: make reversible calls yourself, record them, and leave them as vetoes.",
  `Questions for Ryan go in the brain.json inbox with "epic": "${id}", their options with the recommended one first, reversible and blocks; never only in the transcript.`,
  "Small steps: the smallest version of the next proof, committed as you go.",
  "Tests are written by a test-engineer to a spec, as their own step.",
  "Agents by type: developer lanes, Sonnet reviewers, test-engineer for tests; never Haiku.",
  "Every commit ends with a blank line and a Co-Authored-By trailer naming the agent.",
  "No push unless an inbox approval says so.",
], "");
say("");

say("## Report", "", "Report at the end: proven, refuted or open per outcome, commits, what needs Ryan.", "");

const path = join(folder, "brief.md");
writeFileSync(path, out.join("\n"));
console.log(path);
