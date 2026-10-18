// Contract checks for epics (docs/epics.md), over an epics dir and a ledger.
// Shared by the live run and the fixture runs in epics.test.ts.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CheckName =
  | "epic-json" // an epic.json that can't be read
  | "jobs-name-outcomes" // P2: every job names outcomes of its own epic
  | "outcomes-name-jobs" // every outcome names an existing job and a proof plan
  | "ledger-line" // a ledger line that isn't one JSON object
  | "status-parent" // P3: a status line's parent is an existing epic, the one its id names
  | "status-chain" // P3: an epic's status lines chain from null to its current status
  | "scheduled-line" // epic-start P2: an epic.scheduled line has fireAt, task, door and via, on an existing epic
  | "start-line"; // epic-start P2: a start line is approved → active after an approved line, with via, door and session

/** Doors a schedule may come through (docs/epics.md, "Ledger lines"). */
export const SCHEDULE_DOORS = ["words", "page", "dashboard", "schedule"];
/** Doors a start may come through: the schedule's, plus `hand` for a start made without the skill. */
export const START_DOORS = [...SCHEDULE_DOORS, "hand"];
/** A start line written before the rule (epic-start-0004) carries door and session in a note starting so, and may lack via. */
export const GRANDFATHERED_START_NOTE = "started by hand";

export interface Failure {
  check: CheckName;
  /** The epic the failure belongs to (a status line's parent), or the folder for epic-json. */
  epic: string;
  detail: string;
}

export interface Result {
  /** Epic ids found, in folder order. */
  epics: string[];
  failures: Failure[];
}

// Status changes are `epic.status`; lines written before the rename to epics
// (rev 3 of proposal-system) say `proposal.status`. Counting both is inbox 31's
// recommendation; drop "proposal.status" here if Ryan answers otherwise.
export const STATUS_EVENTS = ["epic.status", "proposal.status"];

interface Epic {
  id?: unknown;
  status?: unknown;
  outcomes?: unknown;
  jobs?: unknown;
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function readEpics(epicsDir: string, failures: Failure[]): Epic[] {
  if (!existsSync(epicsDir)) return [];
  const epics: Epic[] = [];
  for (const entry of readdirSync(epicsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = join(epicsDir, entry.name, "epic.json");
    if (!existsSync(file)) continue;
    try {
      epics.push(JSON.parse(readFileSync(file, "utf8")));
    } catch (e) {
      failures.push({ check: "epic-json", epic: entry.name, detail: `epic.json is not JSON: ${(e as Error).message}` });
    }
  }
  return epics;
}

function checkJobsAndOutcomes(epic: Epic, id: string, failures: Failure[]) {
  const outcomeIds = new Set(asArray(epic.outcomes).map((p) => p?.id));
  const jobIds = new Set(asArray(epic.jobs).map((j) => j?.id));

  for (const job of asArray(epic.jobs)) {
    const named = job?.outcomes;
    if (!Array.isArray(named)) {
      failures.push({ check: "jobs-name-outcomes", epic: id, detail: `job ${job?.id} has no outcomes field` });
      continue;
    }
    if (named.length === 0) {
      failures.push({ check: "jobs-name-outcomes", epic: id, detail: `job ${job?.id} names no outcome` });
      continue;
    }
    for (const p of named) {
      if (!outcomeIds.has(p)) {
        failures.push({ check: "jobs-name-outcomes", epic: id, detail: `job ${job?.id} names unknown outcome ${p}` });
      }
    }
  }

  for (const outcome of asArray(epic.outcomes)) {
    if (!nonEmptyString(outcome?.job)) {
      failures.push({ check: "outcomes-name-jobs", epic: id, detail: `outcome ${outcome?.id} names no job` });
    } else if (!jobIds.has(outcome.job)) {
      failures.push({ check: "outcomes-name-jobs", epic: id, detail: `outcome ${outcome?.id} names unknown job ${outcome.job}` });
    }
    if (!nonEmptyString(outcome?.proof)) {
      failures.push({ check: "outcomes-name-jobs", epic: id, detail: `outcome ${outcome?.id} has no proof plan` });
    }
  }
}

function readLedger(ledgerPath: string, failures: Failure[]): any[] {
  if (!existsSync(ledgerPath)) return [];
  const lines: any[] = [];
  readFileSync(ledgerPath, "utf8")
    .split("\n")
    .forEach((text, i) => {
      if (text.trim() === "") return;
      try {
        const line = JSON.parse(text);
        if (line === null || typeof line !== "object" || Array.isArray(line)) throw new Error("not an object");
        lines.push(line);
      } catch (e) {
        failures.push({ check: "ledger-line", epic: "", detail: `line ${i + 1}: ${(e as Error).message}` });
      }
    });
  return lines;
}

export function checkEpics(epicsDir: string, ledgerPath: string): Result {
  const failures: Failure[] = [];
  const epics = readEpics(epicsDir, failures);
  const ids: string[] = [];

  for (const epic of epics) {
    const id = nonEmptyString(epic.id) ? epic.id : "";
    ids.push(id);
    checkJobsAndOutcomes(epic, id, failures);
  }

  const known = new Set(ids);
  const ledger = readLedger(ledgerPath, failures);
  const status = ledger.filter((l) => STATUS_EVENTS.includes(l.event));

  // Each status line belongs to an existing epic, and its id (`<epic id>-NNNN`)
  // names the same epic as its parent. Older ids (`ps-0001`…) name no epic.
  const byEpic = new Map<string, any[]>();
  for (const line of status) {
    if (!known.has(line.parent)) {
      failures.push({ check: "status-parent", epic: String(line.parent), detail: `${line.id}: parent ${line.parent} is not an epic` });
      continue;
    }
    const prefix = typeof line.id === "string" ? line.id.match(/^(.+)-\d{4}$/)?.[1] : undefined;
    if (prefix !== undefined && prefix !== line.parent && known.has(prefix)) {
      failures.push({ check: "status-parent", epic: prefix, detail: `${line.id}: parent is ${line.parent}, not ${prefix}` });
      continue;
    }
    byEpic.set(line.parent, [...(byEpic.get(line.parent) ?? []), line]);
  }

  // In ledger order, an epic's status lines chain: the first from null, each
  // `from` the previous `to`, the last `to` the epic's current status.
  for (const epic of epics) {
    const id = nonEmptyString(epic.id) ? epic.id : "";
    const lines = byEpic.get(id) ?? [];
    if (lines.length === 0) {
      failures.push({ check: "status-chain", epic: id, detail: `no status line; status ${epic.status} never recorded` });
      continue;
    }
    let previous: unknown = null;
    for (const line of lines) {
      if ((line.from ?? null) !== previous) {
        failures.push({ check: "status-chain", epic: id, detail: `${line.id}: from ${line.from ?? null}, but the previous to is ${previous}` });
      }
      previous = line.to;
    }
    if (previous !== epic.status) {
      failures.push({ check: "status-chain", epic: id, detail: `last status line ends at ${previous}, but the epic is ${epic.status}` });
    }
  }

  checkStartsAndSchedules(ledger, known, failures);

  return { epics: ids, failures };
}

// An ISO time with an offset or Z that names a real instant.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isoWithOffset = (v: unknown): boolean =>
  typeof v === "string" && ISO_WITH_OFFSET.test(v) && !Number.isNaN(Date.parse(v));

// epic-start P2: every schedule is one epic.scheduled line, every start one
// epic.status line approved → active naming the door and session, never
// without an approved line (any status event) of the same epic before it.
// Only `epic.status` start lines are held to this; `proposal.status` lines
// predate the rule. A start line on an unknown epic is status-parent's.
function checkStartsAndSchedules(ledger: any[], known: Set<string>, failures: Failure[]) {
  const approved = new Set<string>();
  for (const line of ledger) {
    const epic = String(line.parent);
    const fail = (check: CheckName, why: string) => failures.push({ check, epic, detail: `${line.id}: ${why}` });

    if (line.event === "epic.scheduled") {
      if (!known.has(line.parent)) fail("scheduled-line", `parent ${line.parent} is not an epic`);
      if (!isoWithOffset(line.fireAt)) fail("scheduled-line", `fireAt ${JSON.stringify(line.fireAt)} is not an ISO time with an offset`);
      if (!nonEmptyString(line.task)) fail("scheduled-line", "names no task");
      if (!SCHEDULE_DOORS.includes(line.door)) fail("scheduled-line", `door ${JSON.stringify(line.door)} is not one of ${SCHEDULE_DOORS.join("|")}`);
      if (!nonEmptyString(line.via)) fail("scheduled-line", "has no via");
    }

    if (line.event === "epic.status" && line.to === "active" && known.has(line.parent)) {
      if (line.from !== "approved") fail("start-line", `from ${line.from ?? null}, not approved`);
      if (!approved.has(epic)) fail("start-line", "no approved line before it");
      // A start line written before the rule may also lack via (docs/epics.md).
      const grandfathered = typeof line.note === "string" && line.note.startsWith(GRANDFATHERED_START_NOTE);
      if (!grandfathered) {
        if (!nonEmptyString(line.via)) fail("start-line", "has no via");
        if (!START_DOORS.includes(line.door)) fail("start-line", `door ${JSON.stringify(line.door)} is not one of ${START_DOORS.join("|")}`);
        if (!nonEmptyString(line.session)) fail("start-line", "names no session");
      }
    }

    if (STATUS_EVENTS.includes(line.event) && line.to === "approved") approved.add(epic);
  }
}
