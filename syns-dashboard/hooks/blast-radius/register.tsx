// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
//
// Modified in the awesome-claude fork (2026): renamed from blast-radius.mjs to
// register.tsx and typed for TypeScript; the drawing moved to view.tsx, which
// keeps upstream's terminal drawing and adds a desktop one, with the kit's
// column view switch kept in the mod's state (`columns`). The holding,
// classifying and measuring logic is upstream's, with one change: an rm whose
// targets all sit under /private/tmp (or /tmp) is outside the blast radius and
// runs unheld (`SCRATCH_ROOTS`, `allScratch`).
//
// Modified again when it moved into syns' dashboard plugin (2026): `register`
// became `attach`, called by the dashboard's register before its own hooks;
// the column view switch is the dashboard's `blastColumns` state; the band
// holds its Buttons under a scope of its own; the kit is imported from
// `../../kit/`.
//
// Blast Radius: holds a risky Bash command and shows what it would change.
//
// tool.call (Bash): if the command is risky, work out its blast radius, open a
// pane with Proceed and Cancel, and hold the call until one is pressed.
// ui.render (Pane): draws the report. If the surface won't place the pane (a
// narrow terminal), the same report is drawn in the AbovePrompt band instead.
//
// AbovePrompt: drawn only while the held report is in the band; otherwise
// `next(e)`, so the dashboard's own band draws.
//
// Holding: a hook has 10 s of its own time, but time spent inside a `$` call is
// free. So the hold loop waits on a short `$.process.run(["sleep", ...])` until
// a button's onPress sets the decision.
//
// The host reads `on(...)` and `$.noun.method(...)` from source, so they are
// spelled literally, and helpers that take `$` are top-level functions.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { holdButtons } from '../../kit/ui'

import { renderApp, renderTerminal, renderTrashLog, size } from './view'
import type { AppElements, Held, Report, Risk, Trashed } from './view'

type $ = EngineInterface

const PANE_ID = "blast-radius";
const POLL_SECONDS = "0.25";
const HOLD_LIMIT_MS = 10 * 60 * 1000;
const LIST_MAX = 10;

// ---- Where an rm may go, and where it never may ----------------------------
// Scratch the system throws away (/tmp is /private/tmp on macOS; both spellings
// count): an rm whose every target is under one runs unheld (see `allScratch`),
// and an empty directory under one goes without asking.
const SCRATCH_ROOTS = ["/private/tmp", "/tmp"];
// Where the repos live, under $HOME: ~/Code/<org>/<repo>.
const CODE_ROOT = "Code";
// How deep under ~/Code a repository root sits (~/Code/<org>/<repo> is 2).
// ~/Code itself and every path down to this depth is never deleted, approval
// or not; deeper paths (worktrees, build output) are our own, and an empty
// one goes without asking.
const REPO_DEPTH = 2;
// macOS's trash: an rm that may run goes here instead, so nothing is deleted.
const TRASH_BIN = "/usr/bin/trash";
// How many of the rm calls sent to the Trash the pane keeps, newest first.
const TRASH_LOG_MAX = 5;

// ---- Disk pressure -----------------------------------------------------------
// The boot volume's free space, as a percent of its size (`df -k /`), under
// which the Trash is worth surfacing.
const FREE_FLOOR_PERCENT = 10;
// What the Trash must hold back, as a percent of the boot volume's size
// (`du -sk ~/.Trash` and `/Volumes/*/.Trashes/<uid>`, where readable), before
// emptying it is put to the user.
const MEANINGFUL_PERCENT = 2;

// The call being held, or null. One at a time: Bash calls in a turn run in order.
let held: Held | null = null;
// The last rm calls sent to the Trash, newest first: the pane's record.
let trashed: Trashed[] = [];
// The disk check runs once at the session's first Bash call and after each
// trash action; the Trash is put to the user at most once a session.
let diskChecked = false;
let diskSurfaced = false;

/** Whether a wide app pane flows the report's lines into columns; the pane's footer switch flips it. */
const columnsView = atom({ plugin: "syns-dashboard", key: "blastColumns" } as const, true);

/** The report for the surface, drawn with the kit: in cells on the terminal, as the app's elsewhere. */
async function draw($: $, e: any, state: Held, band: boolean) {
  const columnsOn = await read($, columnsView);
  // Buttons keep their press handles across redraws, so a click made just before one still lands.
  // The band's under a scope of its own: the dashboard's band holds its own Buttons.
  const els = holdButtons($.ui.resolve(e), band ? `blast-radius\u0000band\u0000${e.surface}` : e);
  const columns = Number(e.props?.bodyColumns ?? 40);
  // The rows it has (the band's most, or the pane's body), so the list is cut before the actions are.
  const rows = Number(e.props?.maxRows ?? e.props?.scroll?.bodyRows) || undefined;
  // The switch is drawn in the pane alone; the band above the prompt keeps to the hold.
  const flow = { on: columnsOn, ...(band ? {} : { toggle: () => void update($, columnsView, (was) => !was).catch(() => undefined) }) };
  return e.surface === "terminal" ? renderTerminal(els, state, columns, { band, focused: e.props?.isFocused, rows }) :renderApp(els as unknown as AppElements, state, columns, { band, flow });
}

/**
 * Blast Radius's hooks, in the dashboard plugin. The dashboard calls this first
 * in its register, so its band hook is the outer one: it draws only while a
 * held command's report is in the band, and passes to the dashboard's otherwise.
 * Every hook has a matcher, as the dashboard has unmatched ones of its own.
 */
export const attach = (on: Parameters<Register>[0], _options: Parameters<Register>[1]): void => {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (!diskChecked) {
      diskChecked = true; // once a session, at its first Bash call
      await checkDisk($).catch(() => undefined);
    }
    const risk = classify(String((e as any).command ?? ""));
    if (risk === null) {
      return next(e);
    }
    // One hold at a time. If another risky call is already held (a subagent's,
    // say), wait until it is answered. `held` is claimed with no await between
    // the check and the claim, so two waiting calls can't both get through.
    while (held !== null) {
      if (next.signal.aborted) {
        return { deny: "Blast Radius held this command and did not run it: the turn was interrupted. Do not retry it unless the user asks you to." };
      }
      await $.process.run(["sleep", POLL_SECONDS], { timeoutMs: 5000 });
    }
    // The Bash call's description is the model's own account of why: shown under the command.
    const intent = String((e as any).description ?? "").trim();
    const mine: Held = { command: String((e as any).command), why: intent || undefined, risk, report: null, decision: null, where: "pane" };
    held = mine;

    let opened = { isPlaced: false };
    let decision: string | null;
    let summary = risk.label;
    let refused: string | null = null; // why the command was refused without a hold, when it was
    let moved: string | null = null; // what went to the Trash instead, when an rm did
    try {
      // Measure where the command will run: the session folder, moved by any
      // `cd dir &&` or `git -C dir` earlier in the same command line.
      const sessionCwd = await $.session.cwd();
      const cwd = risk.dir ? await resolveDir($, sessionCwd, risk.dir) : sessionCwd;
      // An rm's targets are placed first (a repository root? our own empty
      // directories?), right before the call would run: nothing is measured
      // or drawn for one that is refused or goes through on its own.
      const place = risk.kind === "rm" && cwd !== null ? await placeRm($, risk, cwd) : {};
      if (place.protected !== undefined) {
        refused = `${place.protected} is a repository root under ~/${CODE_ROOT}, and Blast Radius never deletes those`;
        mine.decision = "refused";
      } else {
        const report: Report = cwd === null
          ? { summary: `${risk.label} in ${risk.dir}`, lines: [], note: `Couldn't find the folder ${risk.dir}, so I couldn't measure what this would change.` }
          : await measure($, risk, cwd);
        summary = report.summary;
        if (report.nothing !== undefined) {
          // A no-op (an rm whose paths don't exist, say) usually means a wrong
          // path: refuse it at once, with why, rather than ask or let it run
          // and have the model believe it changed something. Nothing is drawn.
          refused = report.nothing;
          mine.decision = "refused";
        } else if (place.paths !== undefined && place.paths.length > 0 && (await trash($, place.paths))) {
          // An rm that may run goes to the Trash instead, unasked: nothing is
          // lost, and the pane keeps the record. The rm itself never runs.
          const files = report.counts?.files ?? 0;
          const bytes = report.counts?.bytes ?? 0;
          const n = place.paths.length;
          moved = `${files} ${files === 1 ? "file" : "files"} (about ${size(bytes)}) in ${n} ${n === 1 ? "path" : "paths"} to the Trash instead of deleting them: ${place.paths.join(" ")}`;
          trashed = [{ command: mine.command, files, bytes, paths: n }, ...trashed].slice(0, TRASH_LOG_MAX);
          mine.decision = "trashed";
          // The record, in the pane, without taking the focus (no `focus`); it stays open.
          try {
            await $.ui.open({ id: PANE_ID, title: "Blast Radius", rows: Math.min(24, 4 + trashed.length) });
          } catch {
            // no room for a pane: the record waits for the next time it opens
          }
          $.ui.invalidate("ui.render");
          await checkDisk($).catch(() => undefined);
        } else if (place.unasked) {
          mine.decision = "unasked"; // our own empty directories, and the trash refused them: let the rm run
        } else {
          mine.report = report;
          opened = await $.ui.open({ id: PANE_ID, title: "Blast Radius", focus: true, rows: paneRows(mine) });
          if (!opened.isPlaced) {
            mine.where = "band";
          }
          $.ui.invalidate("ui.render");
        }
      }

      const startedAt = await $.clock.now();
      while (mine.decision === null) {
        if (next.signal.aborted) {
          mine.decision = "interrupted";
          break;
        }
        if ((await $.clock.now()) - startedAt > HOLD_LIMIT_MS) {
          mine.decision = "timeout";
          break;
        }
        await $.process.run(["sleep", POLL_SECONDS], { timeoutMs: 5000 });
      }
    } catch {
      mine.decision = "error"; // anything unexpected refuses the command
    } finally {
      decision = mine.decision;
      // Close this call's pane before releasing the hold, so the next call's
      // pane can't be the one that gets closed.
      try {
        if (opened.isPlaced) {
          await $.ui.close({ id: PANE_ID });
        }
      } catch {
        // the pane is already gone
      }
      if (held === mine) {
        held = null;
      }
      $.ui.invalidate("ui.render");
    }

    if (decision === "proceed") {
      $.ui.toast("Blast Radius: running it");
      return next(e);
    }
    if (decision === "unasked") {
      return next(e); // empty directories of our own: nothing to lose, nothing to say
    }
    if (decision === "trashed") {
      return { deny: `Blast Radius moved ${moved}. They can be put back from the Trash.` };
    }
    if (decision === "refused") {
      return { deny: `Blast Radius did not run this command: ${refused}. Do not retry it unless the user asks you to.` };
    }
    const why = ({
      cancel: "the user pressed Cancel",
      timeout: "no answer within 10 minutes",
      interrupted: "the turn was interrupted",
      error: "Blast Radius hit an error while holding it",
    } as Record<string, string>)[decision ?? ""] ?? "no answer was recorded";
    return {
      deny: `Blast Radius held this command and did not run it: ${why}. It would have: ${summary}. Do not retry it unless the user asks you to.`,
    };
  });

  on("ui.render", { component: "Pane", requestId: PANE_ID }, ($, e, next) => {
    if (held !== null && held.report !== null) {
      return draw($, e, held, false);
    }
    if (trashed.length > 0) {
      // Nothing held: the pane is the record of what went to the Trash.
      return renderTrashLog($.ui.resolve(e) as any, e.surface === "terminal" ? "terminal" : "desktop", trashed, Number(e.props?.bodyColumns ?? 40));
    }
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (held === null || held.report === null || held.where !== "band") {
      return next(e);
    }
    return draw($, e, held, true);
  });
};

// ---- What counts as risky -------------------------------------------------

// sudo options that take a value, so the value isn't read as the command.
const SUDO_VALUE_OPTIONS = new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U"]);
// Commands that only read, so a bare word "migrate" in them isn't a migration.
const READ_ONLY = new Set(["ls", "cat", "echo", "printf", "grep", "rg", "find", "less", "head", "tail", "cd", "git"]);

/** A folder a later `cd arg` moves to, given the folder so far (null = the session folder). */
function joinDir(dir: string | null, arg: string | undefined): string {
  if (arg === undefined || arg === "~" || arg.startsWith("/") || arg.startsWith("~/")) {
    return arg ?? "~";
  }
  return dir ? `${dir}/${arg}` : arg;
}

/** True when every rm target is inside a scratch root (see SCRATCH_ROOTS). */
function allScratch(targets: string[], dir: string | null): boolean {
  if (targets.length === 0) {
    return false;
  }
  return targets.every((t) => {
    const path = t.startsWith("/") ? t : dir && dir.startsWith("/") ? `${dir}/${t}` : null;
    if (path === null) {
      return false; // relative to the session folder, or ~: not known to be scratch
    }
    const clean = path.replace(/\/+/g, "/");
    if (clean.split("/").includes("..")) {
      return false; // a .. could climb out of the scratch root
    }
    return SCRATCH_ROOTS.some((root) => clean === root || clean.startsWith(`${root}/`));
  });
}

/** The first risky segment of a shell command, or null. */
function classify(command: string): Risk | null {
  let dir: string | null = null; // where a `cd` earlier on the line moved to; null means the session folder
  const scopes: (string | null)[] = []; // dir to restore when a ( subshell ) closes
  const pushed: (string | null)[] = []; // pushd stack, for popd
  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    const opens = (raw.match(/^\s*\(+/)?.[0].trim().length) ?? 0;
    // Trailing redirects and & don't hide a closing ) : `(cd sub && make) > log`.
    const tail = raw.replace(/(?:\s*(?:\d*>>?|&>>?|<)\s*\S+|\s*&)+\s*$/, "");
    const closes = (tail.match(/\)+\s*$/)?.[0].trim().length) ?? 0;
    for (let k = 0; k < opens; k += 1) {
      scopes.push(dir);
    }
    const risk = classifySegment(raw, dir, pushed);
    if (risk !== null && risk.cd === undefined) {
      return risk;
    }
    if (risk !== null) {
      dir = risk.cd; // a cd, pushd or popd moved the folder
    }
    for (let k = 0; k < closes && scopes.length > 0; k += 1) {
      dir = scopes.pop() as string | null; // a cd inside ( ... ) doesn't outlive it
    }
  }
  return null;
}

// Words that can come before the real command without changing what it does.
const PREFIXES = new Set(["command", "exec", "env", "nohup", "time", "then", "do", "else", "!"]);

/** One segment: a risk, { cd } for a folder change, or null. */
function classifySegment(segment: string, dir: string | null, pushed: (string | null)[]): any {
  {
    const words: any[] = tokenize(segment.trim().replace(/^[({]+\s*/, "").replace(/\s*[)}]+$/, ""));
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
      words.shift(); // leading VAR=value
    }
    if (words[0] === "sudo") {
      words.shift();
      while (words.length > 0 && words[0].startsWith("-")) {
        const option = words.shift();
        if (SUDO_VALUE_OPTIONS.has(option)) {
          words.shift();
        }
      }
    }
    while (words.length > 0 && (PREFIXES.has(words[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))) {
      words.shift();
    }
    if (words[0] === "nice") {
      words.shift();
      if (words[0] === "-n") {
        words.splice(0, 2);
      } else if (/^-\d+$/.test(words[0] ?? "")) {
        words.shift();
      }
    }
    const [first, ...args] = words;
    if (first === undefined) {
      return null;
    }
    const cmd = first.replace(/^\\/, ""); // \rm skips aliases; it's still rm
    if (cmd === "cd") {
      return { cd: args[0] === "-" ? "-" : joinDir(dir, args[0]) };
    }
    if (cmd === "pushd") {
      pushed.push(dir);
      return { cd: joinDir(dir, args[0]) };
    }
    if (cmd === "popd") {
      return { cd: pushed.length > 0 ? pushed.pop() : "-" };
    }
    if (cmd === "rm" || cmd.endsWith("/rm")) {
      const flags = args.filter((a) => a.startsWith("-"));
      const recursive = flags.some((f) => f === "--recursive" || (/^-[^-]/.test(f) && /[rR]/.test(f)));
      const force = flags.some((f) => f === "--force" || (/^-[^-]/.test(f) && f.includes("f")));
      if (recursive || force) {
        const targets = args.filter((a) => !a.startsWith("-") || a === "-");
        if (allScratch(targets, dir)) {
          return null; // scratch under /private/tmp: outside the blast radius
        }
        return { kind: "rm", label: `rm ${flags.join(" ")}`.trim(), targets, dir };
      }
    }
    if (cmd === "git") {
      // Git's own options come before the subcommand; -C moves where it runs.
      let gitDir = dir;
      let i = 0;
      while (i < args.length && args[i].startsWith("-")) {
        if (args[i] === "-C" && i + 1 < args.length) {
          gitDir = joinDir(gitDir, args[i + 1]);
          i += 2;
        } else if (args[i] === "-c" && i + 1 < args.length) {
          i += 2;
        } else {
          i += 1;
        }
      }
      const sub = args[i];
      const rest = args.slice(i + 1);
      if (sub === "reset" && rest.includes("--hard")) {
        return { kind: "git-reset", label: "git reset --hard", args: rest, dir: gitDir };
      }
      if (sub === "clean") {
        return { kind: "git-clean", label: "git clean", args: rest, dir: gitDir };
      }
      if (sub === "push" && rest.some((a) => a === "--force" || a === "-f" || a.startsWith("--force-with-lease") || /^\+/.test(a))) {
        return { kind: "git-push-force", label: "git push --force", args: rest, dir: gitDir };
      }
      const stagedOnly = sub === "restore" && rest.includes("--staged") && !rest.includes("--worktree") && !rest.includes("-W");
      if ((sub === "checkout" || sub === "restore") && rest.includes(".") && !stagedOnly) {
        return { kind: "git-checkout", label: `git ${sub} -- .`, args: rest, dir: gitDir };
      }
    }
    const joined = words.join(" ");
    if (/\balembic\s+upgrade\b/.test(joined)) {
      return { kind: "migrate", tool: "alembic", label: "alembic upgrade", dir };
    }
    if (/\bdb:migrate(?!:status\b)/.test(joined)) {
      return { kind: "migrate", tool: "rails", label: "db:migrate", dir };
    }
    if (/\bprisma\s+migrate\b/.test(joined)) {
      return { kind: "migrate", tool: "prisma", label: "prisma migrate", dir };
    }
    if (/\bmanage\.py\s+migrate\b/.test(joined)) {
      return { kind: "migrate", tool: "django", label: "manage.py migrate", dir };
    }
    if (!READ_ONLY.has(cmd) && args.includes("migrate")) {
      return { kind: "migrate", tool: "unknown", label: "migrate", dir };
    }
  }
  return null;
}

// Resolves a `cd` target to an absolute folder, or null if it doesn't exist.
// The target is passed as an argument, never as source.
const CD_SCRIPT = `unset CDPATH; d="$1"; case "$d" in "~") d="$HOME";; "~/"*) d="$HOME/\${d#\\~/}";; esac; cd -- "$d" 2>/dev/null && pwd -P`;

async function resolveDir($: $, sessionCwd: string, dir: string): Promise<string | null> {
  if (dir === "-") {
    return null; // `cd -` depends on the shell's history
  }
  const run = await $.process.run(["bash", "-c", CD_SCRIPT, "blast-radius", dir], { cwd: sessionCwd, timeoutMs: 5000 });
  const out = run.stdout.trim();
  return run.exitCode === 0 && out !== "" ? out : null;
}

/** Splits one segment into words, honouring quotes. Good enough to read flags and paths. */
function tokenize(text: string): string[] {
  const words: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    words.push((m[1] ?? m[2] ?? m[3])!);
  }
  return words;
}

// ---- Measuring the blast radius -------------------------------------------

/** { summary, lines, note } for the pane. Never throws: a failed read is said, not hidden. */
async function measure($: $, risk: Risk, cwd: string): Promise<Report> {
  try {
    if (risk.kind === "rm") {
      return await measureRm($, risk, cwd);
    }
    if (risk.kind === "migrate") {
      return await measureMigrations($, risk, cwd);
    }
    return await measureGit($, risk, cwd);
  } catch (error: any) {
    return { summary: `${risk.label} (could not measure it)`, lines: [], note: `Could not measure: ${String(error?.message ?? error).slice(0, 200)}` };
  }
}

// The paths are passed to bash as arguments, never as source, so nothing in
// them runs. compgen -G expands a glob without command substitution.
const RM_SCRIPT = `
shopt -s nullglob dotglob
paths=()
for p in "$@"; do
  case "$p" in "~"|"~/"*) p="$HOME\${p#\\~}";; esac
  if [[ "$p" == *[*?[]* ]]; then
    while IFS= read -r m; do paths+=("$m"); done < <(compgen -G "$p")
  elif [[ -e "$p" || -L "$p" ]]; then
    paths+=("$p")
  fi
done
if (( \${#paths[@]} == 0 )); then echo "0 0 0"; exit 0; fi
# A relative path gets ./ in front, so find never reads a name like -delete as an action.
for i in "\${!paths[@]}"; do case "\${paths[$i]}" in /*) ;; *) paths[$i]="./\${paths[$i]}";; esac; done
files=$(find "\${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | wc -l | tr -d ' ')
kb=$(du -skc "\${paths[@]}" 2>/dev/null | tail -n1 | cut -f1)
echo "$files $(( \${kb:-0} * 1024 )) \${#paths[@]}"
find "\${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | head -n ${LIST_MAX}
`;

// ---- Placing an rm's targets ------------------------------------------------

/** One existing rm target: what it is, whether it is a directory with no entries at all, and its real path. */
type Target = { kind: "dir" | "file" | "link"; empty: boolean; real: string };

// Each existing target (globs and ~ expanded, as in RM_SCRIPT) as one line:
// kind, 1 if an empty directory (dotfiles count as entries), then its real
// path (symlinks and .. resolved). Missing paths print nothing.
const INSPECT_SCRIPT = `
shopt -s nullglob dotglob
for p in "$@"; do
  case "$p" in "~"|"~/"*) p="$HOME\${p#\\~}";; esac
  ms=("$p")
  if [[ "$p" == *[*?[]* ]]; then ms=(); while IFS= read -r m; do ms+=("$m"); done < <(compgen -G "$p"); fi
  for m in "\${ms[@]}"; do
    if [[ -L "$m" ]]; then kind=link; elif [[ -d "$m" ]]; then kind=dir; elif [[ -e "$m" ]]; then kind=file; else continue; fi
    empty=0; if [[ "$kind" == dir && -z "$(ls -A -- "$m")" ]]; then empty=1; fi
    real=$(realpath -- "$m" 2>/dev/null) || real="$m"
    printf '%s %s %s\\n' "$kind" "$empty" "$real"
  done
done
`;

/** How deep `real` sits under `root` (the root itself is 0), or null when it is not under it. */
function depthUnder(root: string | null, real: string): number | null {
  if (root === null) {
    return null;
  }
  if (real === root) {
    return 0;
  }
  return real.startsWith(`${root}/`) ? real.slice(root.length + 1).split("/").filter((s) => s !== "").length : null;
}

/** The real paths git lists as worktrees of the repo at `cwd`; empty when it is no repo. */
async function listWorktrees($: $, cwd: string): Promise<Set<string>> {
  const run = await $.process.run(["git", "worktree", "list", "--porcelain"], { cwd, timeoutMs: 10000 });
  if (run.exitCode !== 0) {
    return new Set();
  }
  return new Set(run.stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)));
}

/**
 * Where an rm's targets sit, checked right before the call would run:
 * `protected` names a repository root among them (~/Code, ~/Code/<org> or
 * ~/Code/<org>/<repo>, by real path), which is never deleted; `unasked` is
 * true when every target is a directory with no entries at all under a
 * scratch root or deeper than a repository root under ~/Code, or one git
 * lists as a worktree: those go without asking. Anything else is held.
 */
async function placeRm($: $, risk: any, cwd: string): Promise<{ protected?: string; unasked?: boolean; paths?: string[] }> {
  if (risk.targets.length === 0) {
    return {};
  }
  const home = await $.env.get("HOME");
  const code = home ? `${home}/${CODE_ROOT}` : null;
  const run = await $.process.run(["bash", "-c", INSPECT_SCRIPT, "blast-radius-inspect", ...risk.targets], { cwd, timeoutMs: 15000 });
  const targets: Target[] = run.stdout.split("\n").filter((l) => l !== "").map((l) => {
    const [kind, empty, ...real] = l.split(" ");
    return { kind: kind as Target["kind"], empty: empty === "1", real: real.join(" ") };
  });
  for (const t of targets) {
    const depth = depthUnder(code, t.real);
    if (depth !== null && depth <= REPO_DEPTH) {
      return { protected: t.real };
    }
  }
  if (targets.length === 0) {
    return {}; // nothing exists: measureRm says so
  }
  const worktrees = await listWorktrees($, cwd);
  const own = (real: string) =>
    SCRATCH_ROOTS.some((root) => real.startsWith(`${root}/`)) || (depthUnder(code, real) ?? 0) > REPO_DEPTH || worktrees.has(real);
  return { unasked: targets.every((t) => t.kind === "dir" && t.empty && own(t.real)), paths: targets.map((t) => t.real) };
}

async function measureRm($: $, risk: any, cwd: string): Promise<Report> {
  if (risk.targets.length === 0) {
    return { summary: "rm with no paths", lines: [], note: "No paths to expand." };
  }
  const run = await $.process.run(["bash", "-c", RM_SCRIPT, "blast-radius", ...risk.targets], { cwd, timeoutMs: 15000 });
  const [head, ...rest] = run.stdout.split("\n").filter((l) => l !== "");
  const [files, bytes, found] = (head ?? "0 0 0").split(" ").map(Number);
  if (!found) {
    return { summary: `delete nothing: no file matches ${risk.targets.join(" ")}`, lines: [], nothing: "none of its paths exist, so there is nothing to delete" };
  }
  if (!files) {
    // The paths exist but hold no files: only empty directories go.
    return { summary: `remove ${found} empty ${found === 1 ? "directory" : "directories"}`, lines: [], note: `Paths: ${risk.targets.join(" ")}`, counts: { files: 0, bytes: bytes || 0 } };
  }
  return {
    summary: `delete ${files} ${files === 1 ? "file" : "files"} (about ${size(bytes as number)})`,
    lines: rest.map((l) => l.replace(/^\.\//, "")),
    more: Math.max(0, files - rest.length),
    note: `Paths: ${risk.targets.join(" ")}`,
    counts: { files, bytes: bytes || 0 },
  };
}

// ---- The Trash, and the disk -------------------------------------------------

/** Moves the paths to the Trash, all in one call, stopping at the first the trash refuses. True when every path went. */
async function trash($: $, paths: string[]): Promise<boolean> {
  try {
    const run = await $.process.run([TRASH_BIN, "-s", ...paths], { timeoutMs: 60000 });
    return run.exitCode === 0;
  } catch {
    return false; // no trash here (not macOS, say): the rm is held and asked about as before
  }
}

// Line 1: the boot volume's size and free space in KB. Line 2: what the Trash
// holds in KB, the user's own and each volume's, where readable.
const DISK_SCRIPT = `
df -k / | awk 'NR == 2 { print $2, $4 }'
du -skc "$HOME/.Trash" /Volumes/*/.Trashes/"$(id -u)" 2>/dev/null | tail -n 1 | cut -f1
`;

/**
 * When the boot volume is below FREE_FLOOR_PERCENT free and the Trash holds
 * at least MEANINGFUL_PERCENT of it, puts emptying the Trash to the user once
 * a session: an approval in the brain's inbox, and a toast. Emptying happens
 * only on the user's yes, never here.
 */
async function checkDisk($: $): Promise<void> {
  if (diskSurfaced) {
    return;
  }
  const run = await $.process.run(["bash", "-c", DISK_SCRIPT, "blast-radius-disk"], { timeoutMs: 60000 });
  const [df, du] = run.stdout.split("\n");
  const [total = 0, avail = NaN] = (df ?? "").trim().split(/\s+/).map(Number);
  const trashKb = Number((du ?? "").trim()) || 0;
  if (!total || !Number.isFinite(avail)) {
    return;
  }
  const freePercent = (avail / total) * 100;
  const trashPercent = (trashKb / total) * 100;
  if (freePercent >= FREE_FLOOR_PERCENT || trashPercent < MEANINGFUL_PERCENT) {
    return;
  }
  diskSurfaced = true;
  const question = `Disk is at ${freePercent.toFixed(0)}% free (floor ${FREE_FLOOR_PERCENT}%). The Trash holds ${size(trashKb * 1024)}, ${trashPercent.toFixed(0)}% of the volume: empty it?`;
  $.ui.toast(`Blast Radius: ${question} (in the inbox)`, { timeoutMs: 15000 });
  await raiseInbox($, question);
}

/** Adds the approval to the brain's inbox (SYN_BRAIN or ~/.syns/brain.json), unless one from Blast Radius is already open. */
async function raiseInbox($: $, question: string): Promise<void> {
  const custom = await $.env.get("SYN_BRAIN");
  const home = await $.env.get("HOME");
  const path = custom || `${home ?? "~"}/.syns/brain.json`;
  const brain = JSON.parse(String(await $.fs.read(path)));
  const inbox: any[] = Array.isArray(brain.inbox) ? brain.inbox : [];
  const answered: any[] = Array.isArray(brain.answered) ? brain.answered : [];
  const raisedBy = "Blast Radius (syns-dashboard)";
  if (inbox.some((i) => i.raisedBy === raisedBy && i.status !== "answered")) {
    return;
  }
  const id = Math.max(0, ...[...inbox, ...answered].map((i) => Number(i.id) || 0)) + 1;
  const at = new Date(await $.clock.now()).toISOString();
  brain.inbox = [
    ...inbox,
    {
      id,
      kind: "approval",
      pod: "syn",
      status: "open",
      question,
      options: ["Empty the Trash", "Not now"],
      recommended: 0,
      reversible: false,
      blocks: [],
      raisedBy,
      raisedAt: at,
      applies: `Finder empty trash: osascript -e 'tell application "Finder" to empty trash'`,
    },
  ];
  await $.fs.write(path, `${JSON.stringify(brain, null, 2)}\n`);
}

async function measureGit($: $, risk: any, cwd: string): Promise<Report> {
  if (risk.kind === "git-push-force") {
    return await measurePush($, risk, cwd);
  }
  if (risk.kind === "git-clean") {
    const flags = [];
    const paths = [];
    for (let i = 0; i < risk.args.length; i += 1) {
      const a = risk.args[i];
      if (a === "--") {
        paths.push(...risk.args.slice(i + 1));
        break;
      }
      if (a === "-e" || a === "--exclude") {
        flags.push(a, risk.args[i + 1] ?? "");
        i += 1;
      } else if (a.startsWith("--exclude=") || /^-e./.test(a)) {
        flags.push(a);
      } else if (/^-[a-zA-Z]+$/.test(a)) {
        const kept = a.replace(/[finq]/g, ""); // -n is added below; -f, -i and -q would change the dry run
        if (kept !== "-") {
          flags.push(kept);
        }
      } else if (!a.startsWith("-")) {
        paths.push(a);
      }
    }
    const run = await $.process.run(["git", "clean", "-n", ...flags, "--", ...paths], { cwd, timeoutMs: 15000 });
    if (run.exitCode !== 0) {
      return { summary: "git clean (could not dry-run it)", lines: [], note: run.stderr.trim().slice(0, 200) };
    }
    const gone = run.stdout.split("\n").filter((l) => l.startsWith("Would remove ")).map((l) => l.slice(13));
    if (gone.length === 0) {
      return { summary: "remove nothing: no untracked files match", lines: [], nothing: "no untracked files match, so git clean would remove nothing" };
    }
    return {
      summary: gone.length === 0 ? "remove nothing: no untracked files match" : `remove ${gone.length} untracked ${gone.length === 1 ? "path" : "paths"}`,
      lines: gone.slice(0, LIST_MAX),
      more: Math.max(0, gone.length - LIST_MAX),
      note: "From git clean -n. Untracked files are not in git, so they can't be recovered.",
    };
  }
  const status = await $.process.run(["git", "status", "--porcelain"], { cwd, timeoutMs: 15000 });
  if (status.exitCode !== 0) {
    return { summary: `${risk.label} (not a git repo here?)`, lines: [], note: status.stderr.trim().slice(0, 200) };
  }
  const rows = status.stdout.split("\n").filter((l) => l.length > 3 && !l.startsWith("??"));
  // reset --hard drops staged and unstaged changes; checkout -- . drops unstaged ones.
  const lost = risk.kind === "git-reset" ? rows : rows.filter((l) => l[1] !== " ");
  if (risk.kind === "git-reset" && lost.length === 0) {
    return { summary: "discard nothing: no uncommitted changes", lines: [], nothing: "there are no uncommitted changes, so git reset --hard would discard nothing" };
  }
  const stat = await $.process.run(["git", "diff", "--shortstat", risk.kind === "git-reset" ? "HEAD" : "--"], { cwd, timeoutMs: 15000 });
  return {
    summary: lost.length === 0 ? "discard nothing: no uncommitted changes" : `discard uncommitted changes in ${lost.length} ${lost.length === 1 ? "file" : "files"}`,
    lines: lost.slice(0, LIST_MAX).map((l) => `${l.slice(0, 2)} ${l.slice(3)}`),
    more: Math.max(0, lost.length - LIST_MAX),
    note: stat.stdout.trim() !== "" ? `${stat.stdout.trim()}. Uncommitted changes can't be recovered.` : "From git status --porcelain.",
  };
}

async function measurePush($: $, risk: any, cwd: string): Promise<Report> {
  const positional = risk.args.filter((a: string) => !a.startsWith("-"));
  const remote = positional[0] ?? "origin";
  // A refspec is src:dst. With no colon, the local branch of the same name is pushed.
  const spec = (positional[1] ?? "").replace(/^\+/, "");
  let [source, branch] = spec.includes(":") ? spec.split(":") : [spec, spec];
  branch = (branch ?? "").replace(/^refs\/heads\//, "");
  if (!branch) {
    const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 10000 });
    branch = head.stdout.trim();
    source = "HEAD";
  } else if (branch === "HEAD") {
    // `git push origin HEAD` pushes the current branch to its namesake.
    const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 10000 });
    branch = head.stdout.trim();
    source = "HEAD";
  }
  source = source || "HEAD";
  const ref = `${remote}/${branch}`;
  const known = await $.process.run(["git", "rev-parse", "--verify", "--quiet", ref], { cwd, timeoutMs: 10000 });
  if (known.exitCode !== 0) {
    return { summary: `force-push to ${ref}`, lines: [], note: `No local copy of ${ref}, so I can't tell which commits the push would drop. Run git fetch first.` };
  }
  const log = await $.process.run(["git", "log", "--oneline", "--no-decorate", `${source}..${ref}`], { cwd, timeoutMs: 15000 });
  const dropped = log.stdout.split("\n").filter((l) => l !== "");
  return {
    summary: dropped.length === 0 ? `force-push to ${ref}: drops no commits` : `force-push to ${ref}: drops ${dropped.length} ${dropped.length === 1 ? "commit" : "commits"}`,
    lines: dropped.slice(0, LIST_MAX),
    more: Math.max(0, dropped.length - LIST_MAX),
    note: `Commits on ${ref} that ${source} doesn't have, as of the last fetch.`,
  };
}

const MIGRATION_LISTERS: Record<string, { argv: string[]; pending: (l: string) => boolean; strip: (l: string) => string }> = {
  django: { argv: ["python3", "manage.py", "showmigrations", "--plan"], pending: (l) => l.startsWith("[ ]"), strip: (l) => l.slice(4) },
  alembic: { argv: ["alembic", "history", "-r", "current:head"], pending: (l) => l.includes("->"), strip: (l) => l },
  rails: { argv: ["bin/rails", "db:migrate:status"], pending: (l) => /^\s*down\b/.test(l), strip: (l) => l.trim() },
  prisma: { argv: ["npx", "--no-install", "prisma", "migrate", "status"], pending: (l) => /^\s{2}\S/.test(l), strip: (l) => l.trim() },
};

async function measureMigrations($: $, risk: any, cwd: string): Promise<Report> {
  const lister = MIGRATION_LISTERS[risk.tool];
  if (lister === undefined) {
    return { summary: "run migrations", lines: [], note: "I can't list the pending migrations for this tool, so the list is not shown." };
  }
  let run: { exitCode: number; stdout: string; stderr: string };
  try {
    run = await $.process.run(lister.argv, { cwd, timeoutMs: 20000 });
  } catch (error: any) {
    run = { exitCode: -1, stdout: "", stderr: String(error?.message ?? error) };
  }
  if (run.exitCode !== 0) {
    return { summary: `run ${risk.label}`, lines: [], note: `Couldn't list pending migrations (${lister.argv.join(" ")} failed).` };
  }
  const pending = run.stdout.split("\n").filter(lister.pending).map(lister.strip);
  return {
    summary: pending.length === 0 ? `run ${risk.label}: nothing pending` : `apply ${pending.length} pending ${pending.length === 1 ? "migration" : "migrations"}`,
    lines: pending.slice(0, LIST_MAX),
    more: Math.max(0, pending.length - LIST_MAX),
    note: `From ${lister.argv.join(" ")}.`,
  };
}

// ---- Drawing --------------------------------------------------------------

// The drawing itself is in view.tsx.

function paneRows(state: Held) {
  const report = state.report!;
  return Math.min(24, 9 + report.lines.length + (report.more ? 1 : 0) + (state.why ? 1 : 0));
}
