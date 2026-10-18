// Contract checks for epics, to docs/epics.md. Promises under test
// (proposal-system): P2, every job names at least one of its epic's promises;
// P3, every status change of an epic is one ledger line with the epic as parent.
// (epic-start): P2, every start and every schedule is in the ledger: a schedule
// as one epic.scheduled line, a start as one epic.status line approved → active
// naming the door and session, never without an approved line before it.
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

  test("epic-start P2: every epic.scheduled line has fireAt, task, door and via, on an existing epic", () => {
    expect(of(live, "scheduled-line")).toEqual([]);
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
      test("epic-start P2: every start line is approved → active after an approved line, with via, door and session", () => {
        expect(of(live, "start-line", id)).toEqual([]);
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

// ---- Fixtures: (c) starts and schedules in the ledger (epic-start P2) ------

describe("epic-start P2 (c) every start and schedule is in the ledger", () => {
  const r = fixture("start");
  const at = (check: CheckName, lineId: string) => of(r, check).filter((f) => f.detail.startsWith(`${lineId}:`));

  describe("scheduled-line", () => {
    test("fireAt with Z, with +hh:mm, with fractional seconds and -hh:mm; every schedule door; a re-schedule: passes", () => {
      for (const n of ["0002", "0003", "0004", "0005"]) expect(at("scheduled-line", `sched-${n}`)).toEqual([]);
    });

    test("a schedule followed by its start line: both pass", () => {
      expect(at("start-line", "sched-0006")).toEqual([]);
    });

    const once: [string, string][] = [
      ["0010", "no fireAt"],
      ["0011", "fireAt without an offset"],
      ["0012", "fireAt that isn't an ISO time"],
      ["0013", "fireAt that names no real date"],
      ["0014", "fireAt as a number"],
      ["0015", "no task"],
      ["0016", "an empty task"],
      ["0017", "no door"],
      ["0018", "door hand (a start door, not a schedule door)"],
      ["0019", "an unknown door"],
      ["0020", "no via"],
      ["0021", "a blank via"],
    ];
    for (const [n, what] of once) {
      test(`a schedule with ${what} fails, once`, () => {
        const f = at("scheduled-line", `sched-${n}`);
        expect(f.length).toBe(1);
        expect(f[0].epic).toBe("sched");
      });
    }

    test("a schedule whose parent is no epic fails", () => {
      const f = of(r, "scheduled-line", "nobody");
      expect(f.length).toBe(1);
      expect(f[0].detail).toContain("nobody-0001");
    });
  });

  describe("start-line", () => {
    test("a start with no schedule before it: passes", () => {
      expect(of(r, "start-line", "go")).toEqual([]);
    });

    test("every start door (words, page, dashboard, schedule, hand): passes", () => {
      expect(of(r, "start-line", "doors")).toEqual([]);
    });

    const once: [string, string][] = [
      ["0010", "from review instead of approved"],
      ["0011", "no via"],
      ["0012", "an empty via"],
      ["0013", "no door"],
      ["0014", "an unknown door"],
      ["0015", "no session"],
      ["0016", "an empty session"],
    ];
    for (const [n, what] of once) {
      test(`a start with ${what} fails, once`, () => {
        const f = at("start-line", `start-bad-${n}`);
        expect(f.length).toBe(1);
        expect(f[0].epic).toBe("start-bad");
      });
    }

    test("a note that only contains \"started by hand\" is not grandfathered: no door or session fails", () => {
      expect(at("start-line", "start-bad-0017").length).toBeGreaterThan(0);
    });

    test("a start line before the rule, its note starting \"started by hand\", passes without door and session", () => {
      expect(at("start-line", "grand-0002")).toEqual([]);
    });

    test("a grandfathered start line with no via (bloom-swarm-0009): passes", () => {
      expect(at("start-line", "grand-0003")).toEqual([]);
    });

    test("the grandfathered note still requires from approved and an approved line before it", () => {
      const f = at("start-line", "grand-0004");
      expect(f.length).toBe(1);
      expect(f[0].detail).toContain("from review");
    });

    test("a start with no approved line of its own epic (others' came before) fails", () => {
      const f = of(r, "start-line", "no-approval");
      expect(f.length).toBe(1);
      expect(f[0].detail).toContain("no-approval-0002");
    });

    test("a start whose approved line comes after it in the ledger fails", () => {
      const f = of(r, "start-line", "late-approval");
      expect(f.length).toBe(1);
      expect(f[0].detail).toContain("late-approval-0001");
    });

    test("a legacy proposal.status approved line counts as the approval", () => {
      expect(of(r, "start-line", "legacy-approved")).toEqual([]);
    });

    test("a job going active and a legacy proposal.status start are not start lines", () => {
      expect(of(r, "start-line", "not-start")).toEqual([]);
    });
  });

  test("the other fixtures' ledgers raise no start or schedule failure they don't hold", () => {
    for (const name of ["jobs", "empty", "malformed"]) {
      const other = fixture(name);
      expect(of(other, "scheduled-line")).toEqual([]);
      expect(of(other, "start-line")).toEqual([]);
    }
  });
});
