// Contract checks for epics (docs/epics.md), over an epics dir and a ledger.
// Shared by the live run and the fixture runs in epics.test.ts.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CheckName =
  | "epic-json" // an epic.json that can't be read
  | "jobs-name-promises" // P2: every job names promises of its own epic
  | "promises-name-jobs" // every promise names an existing job and a proof plan
  | "ledger-line" // a ledger line that isn't one JSON object
  | "status-parent" // P3: a status line's parent is an existing epic, the one its id names
  | "status-chain"; // P3: an epic's status lines chain from null to its current status

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
  promises?: unknown;
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

function checkJobsAndPromises(epic: Epic, id: string, failures: Failure[]) {
  const promiseIds = new Set(asArray(epic.promises).map((p) => p?.id));
  const jobIds = new Set(asArray(epic.jobs).map((j) => j?.id));

  for (const job of asArray(epic.jobs)) {
    const named = job?.promises;
    if (!Array.isArray(named)) {
      failures.push({ check: "jobs-name-promises", epic: id, detail: `job ${job?.id} has no promises field` });
      continue;
    }
    if (named.length === 0) {
      failures.push({ check: "jobs-name-promises", epic: id, detail: `job ${job?.id} names no promise` });
      continue;
    }
    for (const p of named) {
      if (!promiseIds.has(p)) {
        failures.push({ check: "jobs-name-promises", epic: id, detail: `job ${job?.id} names unknown promise ${p}` });
      }
    }
  }

  for (const promise of asArray(epic.promises)) {
    if (!nonEmptyString(promise?.job)) {
      failures.push({ check: "promises-name-jobs", epic: id, detail: `promise ${promise?.id} names no job` });
    } else if (!jobIds.has(promise.job)) {
      failures.push({ check: "promises-name-jobs", epic: id, detail: `promise ${promise?.id} names unknown job ${promise.job}` });
    }
    if (!nonEmptyString(promise?.proof)) {
      failures.push({ check: "promises-name-jobs", epic: id, detail: `promise ${promise?.id} has no proof plan` });
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
    checkJobsAndPromises(epic, id, failures);
  }

  const known = new Set(ids);
  const status = readLedger(ledgerPath, failures).filter((l) => STATUS_EVENTS.includes(l.event));

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

  return { epics: ids, failures };
}
