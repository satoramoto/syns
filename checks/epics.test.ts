// Contract checks for epics, to docs/epics.md. Promises under test
// (proposal-system): P2, every job names at least one of its epic's promises;
// P3, every status change of an epic is one ledger line with the epic as parent.
// Run: bun test checks/

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkEpics, type CheckName, type Result } from "./epics";

const fixture = (name: string): Result =>
  checkEpics(join(import.meta.dir, "fixtures", name, "epics"), join(import.meta.dir, "fixtures", name, "memory.jsonl"));

const of = (r: Result, check: CheckName, epic?: string) =>
  r.failures.filter((f) => f.check === check && (epic === undefined || f.epic === epic));

// ---- Live: every ~/.syns/epics/*/epic.json and ~/.syns/memory.jsonl --------

const SYNS = process.env.SYNS ?? join(homedir(), ".syns");
const liveEpicsDir = join(SYNS, "epics");
const liveLedger = join(SYNS, "memory.jsonl");

describe("live", () => {
  const live = checkEpics(liveEpicsDir, liveLedger);
  const folders = existsSync(liveEpicsDir)
    ? readdirSync(liveEpicsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];

  test("every epic.json parses", () => {
    expect(of(live, "epic-json")).toEqual([]);
    expect(live.epics.length).toBe(folders.length);
  });

  test("P3: every ledger line is one JSON object", () => {
    expect(of(live, "ledger-line")).toEqual([]);
  });

  test("P3: every status line's parent is an existing epic, the one its id names", () => {
    expect(of(live, "status-parent")).toEqual([]);
  });

  for (const id of live.epics) {
    describe(id, () => {
      test("P2: every job names promises, all of this epic", () => {
        expect(of(live, "jobs-name-promises", id)).toEqual([]);
      });
      test("P2: every promise names an existing job and a proof plan", () => {
        expect(of(live, "promises-name-jobs", id)).toEqual([]);
      });
      test("P3: status lines chain from null to the current status", () => {
        expect(of(live, "status-chain", id)).toEqual([]);
      });
    });
  }
});

// ---- Fixtures: (a) jobs and promises --------------------------------------

describe("P2 (a) jobs name promises; promises name jobs", () => {
  const r = fixture("jobs");

  test("many jobs and promises, all cross-named: passes", () => {
    expect(r.failures.filter((f) => f.epic === "ok")).toEqual([]);
  });

  test("no jobs and no promises: passes", () => {
    expect(r.failures.filter((f) => f.epic === "none")).toEqual([]);
  });

  test("a job without the promises field fails", () => {
    const f = of(r, "jobs-name-promises", "no-promises-field");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("j2");
  });

  test("a job with an empty promises list fails", () => {
    const f = of(r, "jobs-name-promises", "empty-promises");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("j1");
  });

  test("a job naming an unknown promise fails, once, for that promise only", () => {
    const f = of(r, "jobs-name-promises", "unknown-promise");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("P9");
  });

  test("a promise naming an unknown job fails", () => {
    const f = of(r, "promises-name-jobs", "unknown-job");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("j9");
  });

  test("a promise naming no job fails", () => {
    expect(of(r, "promises-name-jobs", "no-job").length).toBe(1);
  });

  test("a promise with an empty proof plan fails", () => {
    expect(of(r, "promises-name-jobs", "no-proof").length).toBe(1);
  });

  test("each defect fails only its own check", () => {
    expect(of(r, "promises-name-jobs", "no-promises-field")).toEqual([]);
    expect(of(r, "jobs-name-promises", "unknown-job")).toEqual([]);
    expect(of(r, "status-chain")).toEqual([]);
    expect(of(r, "status-parent")).toEqual([]);
  });
});

// ---- Fixtures: (b) status lines in the ledger ------------------------------

describe("P3 (b) status lines name their epic and chain", () => {
  const r = fixture("ledger");

  test("a full chain, interleaved with other epics' lines and other events: passes", () => {
    expect(of(r, "status-chain", "alpha")).toEqual([]);
    expect(of(r, "jobs-name-promises", "alpha")).toEqual([]);
  });

  test("a status line whose parent is no epic fails", () => {
    const f = of(r, "status-parent", "ghost");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("ghost-0001");
  });

  test("a non-status line whose parent is no epic is not a status line", () => {
    expect(r.failures.some((f) => f.detail.includes("ghost-0002"))).toBe(false);
  });

  test("a status line whose id names one epic and parent another fails, and stays out of both chains", () => {
    const f = of(r, "status-parent");
    expect(f.some((x) => x.detail.includes("alpha-0099"))).toBe(true);
    expect(of(r, "status-chain", "beta")).toEqual([]);
    expect(of(r, "status-chain", "alpha")).toEqual([]);
  });

  test("a from that isn't the previous to breaks the chain, once", () => {
    const f = of(r, "status-chain", "broken");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("broken-0003");
  });

  test("a first line whose from isn't null breaks the chain", () => {
    const f = of(r, "status-chain", "late-start");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("late-start-0001");
  });

  test("a chain ending short of the epic's status fails", () => {
    const f = of(r, "status-chain", "stale");
    expect(f.length).toBe(1);
    expect(f[0].detail).toContain("approved");
  });

  test("an epic with no status line fails", () => {
    expect(of(r, "status-chain", "silent").length).toBe(1);
  });

  test("legacy proposal.status lines chain with epic.status lines (inbox 31)", () => {
    expect(r.failures.filter((f) => f.epic === "legacy")).toEqual([]);
  });
});

// ---- Fixtures: edges -------------------------------------------------------

describe("edges", () => {
  test("no epics and an empty ledger: passes", () => {
    const r = fixture("empty");
    expect(r.epics).toEqual([]);
    expect(r.failures).toEqual([]);
  });

  test("a ledger line that isn't one JSON object fails; the good lines still count", () => {
    const r = fixture("malformed");
    expect(of(r, "ledger-line").length).toBe(2);
    expect(of(r, "status-chain", "ok")).toEqual([]);
  });

  test("an epic.json that isn't JSON fails; the others are still checked", () => {
    const r = fixture("malformed");
    expect(of(r, "epic-json", "bad-json").length).toBe(1);
    expect(r.epics).toEqual(["ok"]);
  });
});
