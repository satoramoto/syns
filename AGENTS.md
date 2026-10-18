# syns

Read [`README.md`](README.md) and [`VISION.md`](VISION.md) first. The session
machine is specified in [`docs/spec.md`](docs/spec.md); words are defined in
[`docs/lexicon.md`](docs/lexicon.md).

## Layout

- `VISION.md`, `docs/`: the why, the spec, the lexicon, prior art.
- `templates/`: starter files a new user copies into `~/.claude/` (and a base
  context per repo). Keep them generic: no one's personal setup.
- `plugin/`: the `syn` Claude Code plugin (a skeleton for now).
- `syns-dashboard/`: the dashboard mod, a pane reading brain.json live (see
  `docs/spec.md`, "The dashboard today"). It draws with zen's Claude Code kit
  (satoramoto/zen, `src/harness/claude-code/kit/`), copied into
  `syns-dashboard/kit/` by `bun build.ts` (committed; never edit it here,
  change it in zen and run the build again). Built the way awesome-claude's
  mods are: zen's `docs/harness-claude-code.md` holds the look and the engine's
  limits. Its one pane has tabs: Overview (syn's own), Session, Files,
  Issues, Launcher and Lab. All but Overview were awesome-claude's mods
  (`overview` is Session) and are syns source now, edited in place in
  `syns-dashboard/hooks/<mod>/`; so is `blast-radius`, which holds risky
  commands in a pane of its own and has no tab. Each mod has an `attach(on,
  options, pane)` the dashboard's `register.tsx` calls after its own Pane
  render, which draws the tab row and calls `next(e)` for a mod's tab; the
  mod draws only when `hooks/tabs.ts` says its tab is shown, and reads only
  then. Each exports its slash commands as `COMMANDS` (the dashboard registers
  them: one `session.start` per plugin). Their value types and state (keys
  prefixed by tab: `session…`, `files…`, `issues…`, `launcher…`, `lab…`,
  `blast…`) are in the one `types/index.d.ts`. filetree keeps its MIT LICENSE
  (Kurt Buhler) and blast-radius its Apache-2.0 LICENSE (Anthropic), each with
  its README stating its origin.
- Engine limits that shape the mods: `$` passes only to functions in the same
  file; an atom's plugin and key are literals in the file using it; a plugin
  registers each event at most once without a matcher (`claude plugin
  validate` refuses a second); a function `on` is passed to returns nothing
  the caller uses; a render can't write state; nested renders each hold their
  Buttons in their own `holdButtons` scope.
- Plugin folders sit at the top level: sessions load this repo with
  `CLAUDE_CODE_PLUGIN_DIRS=~/Code/satoramoto/syns`, which finds plugin folders
  one level down only.
- **Stable or dev.** The repo is also a marketplace (`.claude-plugin/marketplace.json`).
  - **Stable** sessions install from GitHub: `claude plugin marketplace add satoramoto/syns`, then `claude plugin install syn@syns syns-dashboard@syns`. They update when a merged PR raises a plugin's version (in its `plugin.json` and in `marketplace.json`).
  - **Dev** sessions load the checkout live instead: `CLAUDE_CODE_PLUGIN_DIRS=~/Code/satoramoto/syns` with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`, so a saved edit reloads.
  - Use one or the other in a session, not both.
- `Dockerfile`: the naked Claude image (`naked`), the syn variant (`syn`), and
  `dogfood`, the long-lived session across all your projects (its start
  command is `docker/dogfood-start.sh`).

## How to work here

- **A change is an edit plus its check, then a commit.** The check is the one
  in the table below for what you touched. Nothing else runs for a small
  change.
- **Tests are a separate step, to a contract.** When the plugin grows code, a
  `test-engineer` writes tests from `docs/spec.md`'s numbered behaviours, in
  parallel with the developer; neither waits for the other. Tests are never a
  side effect of a change.
- **CI on the PR is the final check** (once the repo has a remote and CI).
- Keep `docs/spec.md` the contract: a behaviour change starts as a spec edit.
- Make file changes with the Edit and Write tools; the shell is for checks and
  git. No wrapper scripts: the commands below are the interface.

| Command | What it checks | When to run |
| --- | --- | --- |
| `claude plugin validate plugin` | the engine accepts the `syn` plugin's manifest and commands | any change under `plugin/` |
| `bun build.ts` | copies zen's `src/harness/claude-code/kit/` (a zen checkout beside this repo, or `$ZEN`) into `syns-dashboard/kit/` | to take a newer kit |
| `claude plugin validate syns-dashboard` | the engine accepts the dashboard: its hooks, calls, and state reads and writes against `types/index.d.ts` | any change under `syns-dashboard/` |
| `bunx tsc -p syns-dashboard` | the dashboard type-checks (needs the engine's types in `syns-dashboard/.claude-plugin/types/`, laid when a session loads it, or copied from another checkout that has them) | any `.ts`/`.tsx` change there |
| `claude plugin test syns-dashboard` | every tab's tests (`syns-dashboard/hooks/<mod>/**/*.test.ts(x)`), through the engine's test kit; the whole plugin loads in each test, so a test stubs what the dashboard's own hooks call. It takes the plugin folder only (about 10 minutes for all of them) | a change to a tab's behaviour, once, before the PR |
| `bun analysis/focus.ts [--since YYYY-MM-DD] [--bucket day\|week] [--seed]` | the focus timeline: Ryan's own prompts from Claude transcripts, Codex rollouts (live and archived) and chat exports in `~/.syns/files/exports/<harness>/`, stemmed (Porter2) with PMI phrases; every concept in 3+ prompts with its closest terms by normalized PMI (the raw term view), plus TF-IDF per day or week, topics and categories (seeded from brain.json's ids and LEXICON.md's terms only with `--seed`), written deterministically to `~/.syns/files/focus/focus.json` and `focus.html` (term view with search and term cards, share chart, topic cloud, tables, one week slider); type-check with `bunx tsc -p analysis` (after `bun install --cwd analysis` once) | to see what the focus was; the type-check after a change to `analysis/` |
| `docker build --target naked -t syns-naked .` | the naked image builds with the pinned Claude Code | a change to `Dockerfile` |
| `docker build --target syn -t syns-syn .` | the syn variant builds with the templates and plugin | a change to `Dockerfile`, `templates/` or `plugin/` you want to try in a container |
| `docker run --rm syns-naked claude --version` | Claude Code runs inside the image (exit 0) | after building the image |
| `docker build --target dogfood -t syns-dogfood .` | the dogfood image builds with the latest Claude Code and the tools | a change to `Dockerfile`, `docker/` or `templates/` |
| `docker run --rm syns-dogfood claude --version` | Claude Code runs inside the dogfood image (exit 0) | after building it |

## The naked Claude environment

Claude Code exactly as it comes out of the box, in Docker, for comparing syn's
behaviour against stock. The image installs a pinned version with the official
installer (`CLAUDE_CODE_VERSION` in the `Dockerfile`), keeps its config dir
inside the container (`/home/claude/.claude`), and has the auto-updater off.

Rules:
- **Never mount the host's `~/.claude`.** Nothing from the host (settings,
  `CLAUDE.md`, memory, skills, plugins) goes in.
- Auth is `ANTHROPIC_API_KEY` passed through from your shell (`-e
  ANTHROPIC_API_KEY`, never the value on the command line), or `/login`
  inside the container.
- The project is mounted read-write at `/work`.

Build:

```sh
docker build --target naked -t syns-naked .
docker build --target syn   -t syns-syn   .
```

Run stock Claude Code on this repo, with your key from the environment:

```sh
docker run --rm -it -e ANTHROPIC_API_KEY -v "$PWD":/work syns-naked
```

Run the syn variant (templates as the user config, the `syn` plugin loaded):

```sh
docker run --rm -it -e ANTHROPIC_API_KEY -v "$PWD":/work syns-syn
```

Log in inside the container instead of using a key, and keep the login across
runs in a named volume (a Docker volume, not a host folder):

```sh
docker run --rm -it -v syns-naked-config:/home/claude/.claude -v "$PWD":/work syns-naked
```

Pin a different version:

```sh
docker build --target naked --build-arg CLAUDE_CODE_VERSION=2.1.296 -t syns-naked .
```

## Dogfood syns

One permanent, persistent Claude session in Docker that spans all your
projects, so you use syn yourself. Unlike `naked`, it runs the **latest**
Claude Code (the official installer, unpinned; the auto-updater is on), and it
deliberately shares your code and syn's state with the host.

### Where things live

`~/Code` is for code; `~/.syns` is for everything else.

| What | Where | Survives |
| --- | --- | --- |
| Claude's config, login, settings, sessions and transcripts, the installed `CLAUDE.md` and `agents/` | named volume `syns-claude` at `/home/claude/.claude` | restarts, rebuilds, re-creating the container; only `docker volume rm syns-claude` clears it |
| `gh`'s login | named volume `syns-gh` at `/home/claude/.config/gh` | the same; only `docker volume rm syns-gh` clears it |
| your repos | host `~/Code`, mounted read-write at the same path | it's the host's |
| syn's state: `brain.json` (`$SYN_BRAIN`), `LEXICON.md`, later `memory.jsonl` | host `~/.syns`, mounted read-write at the same path | it's the host's |
| temp files, experiments, generated images, intermediate output | `~/.syns/scratch/<topic>/` (the session's `TMPDIR` and `CLAUDE_CODE_TMPDIR`) | it's the host's |
| non-code keepers | `~/.syns/files/<topic>/` | it's the host's |
| Claude Code itself, the toolchains | the image | until you rebuild |

Same-path mounts keep the paths in `brain.json`, git worktrees and
transcripts valid on both sides. On the host, `~/.claude/brain.json` and
`~/.claude/LEXICON.md` are symlinks into `~/.syns`; the start command makes
the same links in the container's config dir, so both read one brain. Nothing
else from the host's `~/.claude` goes in.

On every start, `docker/dogfood-start.sh` (the image's entrypoint) copies
`templates/CLAUDE.md` and `templates/agents/*.md` into the config volume
**only where a file is missing**, so your later edits stay; delete a file to
get the template again. It loads every plugin folder in the mounted syns
checkout (`CLAUDE_CODE_PLUGIN_DIRS=$SYNS_DIR`: `plugin/`, `syns-dashboard/`)
with dir watch on (`CLAUDE_CODE_PLUGIN_DIR_WATCH=1`), and resumes the most
recent conversation in the working directory (`claude --continue`) when there
is one. Given a command instead (`claude --version`, `bash`), it runs that.

The image has git, `gh`, node 22 with npm, bun, Rust (rustup, minimal profile
with clippy and rustfmt), build-essential, pkg-config, python3, jq and
ripgrep.

### Sandbox

The container can write on the host only in `~/Code` and `~/.syns`. The
signing public key and the SSH agent socket are mounted read-only; nothing
else from the host is mounted. It runs as the non-root `claude` user with
`--cap-drop=ALL` (it needs no capabilities) and `--security-opt
no-new-privileges`, plus `--group-add 0` only so it can reach the agent socket
(see signing); never add `--privileged`.

### Commands

Build:

```sh
docker build --target dogfood -t syns-dogfood .
```

First run. It creates the container `syns`; log in to Claude when it asks,
then run `! gh auth login` inside the session (both once: they live in the
volumes):

```sh
docker run -it --name syns --hostname syns \
  --cap-drop=ALL --security-opt no-new-privileges --group-add 0 \
  -v syns-claude:/home/claude/.claude \
  -v syns-gh:/home/claude/.config/gh \
  -v "$HOME/Code":"$HOME/Code" \
  -v "$HOME/.syns":"$HOME/.syns" \
  -v "$(git config --get user.signingkey)":/home/claude/.ssh/signing.pub:ro \
  -v /run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock:ro \
  -e SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock \
  -e SYNS_HOME="$HOME/.syns" \
  -e SYNS_DIR="$HOME/Code/satoramoto/syns" \
  -e SYN_BRAIN="$HOME/.syns/brain.json" \
  -e TMPDIR="$HOME/.syns/scratch" \
  -e CLAUDE_CODE_TMPDIR="$HOME/.syns/scratch" \
  -e GIT_AUTHOR_NAME="$(git config --get user.name)" \
  -e GIT_AUTHOR_EMAIL="$(git config --get user.email)" \
  -e GIT_COMMITTER_NAME="$(git config --get user.name)" \
  -e GIT_COMMITTER_EMAIL="$(git config --get user.email)" \
  -w "$HOME/Code" \
  syns-dogfood
```

The `$(git config …)` parts read your host's git identity and signing key
path when the container is created; the values stay in the container.

Re-attach, every time after (it resumes the same conversation):

```sh
docker start -ai syns
```

Detach without stopping: `Ctrl-P Ctrl-Q`; attach again with `docker attach
syns`.

Update Claude Code: rebuild only the final stage (the toolchains stay cached),
then re-create the container with the first-run command. The volumes keep
your logins, config and sessions:

```sh
docker build --target dogfood --no-cache-filter dogfood -t syns-dogfood .
docker rm syns
```

Reset (forget the session, config and logins; `~/Code` and `~/.syns` are
untouched):

```sh
docker rm syns
docker volume rm syns-claude syns-gh
```

### Commit signing

Your repos sign commits with an SSH key held by the 1Password SSH agent. The
container never sees the private key:

- Docker Desktop forwards the host's SSH agent at
  `/run/host-services/ssh-auth.sock`; the run command mounts it read-only and
  points `SSH_AUTH_SOCK` at it. The socket is `root:root` mode 660, so
  `--group-add 0` puts the `claude` user in group 0 to reach it (it gains no
  capabilities or root user).
- The image's system git config sets `gpg.format ssh`, `commit.gpgsign` and
  `tag.gpgsign`, and `user.signingkey /home/claude/.ssh/signing.pub`: the
  public key file named by your host's `user.signingkey`, mounted read-only.
  `ssh-keygen` signs through the agent, so 1Password asks you to approve, as
  on the host. (The host's `gpg.ssh.program`, `op-ssh-sign`, is macOS-only and
  isn't used.)
- Check inside the container: `ssh-add -l` lists your 1Password keys, and
  `git commit --allow-empty -m test` in a scratch repo signs.

Docker Desktop forwards the agent macOS's launchd knows, which is the system
agent unless you point it at 1Password. If `ssh-add -l` says "The agent has
no identities", once on the host (per 1Password's docs):

```sh
mkdir -p ~/.1password
ln -s "$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" "$HOME/.1password/agent.sock"
launchctl setenv SSH_AUTH_SOCK "$HOME/.1password/agent.sock"
```

then quit and reopen Docker Desktop and re-create the container. (`launchctl
setenv` lasts until logout; 1Password's docs show a LaunchAgent that sets it
at login.)

## Git

- `main` is the default branch. Work on a branch; once there's a remote, open
  a PR and let CI be the final check.
- Every agent commit ends with a blank line and a co-author trailer naming the
  agent, for example `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If commit signing fails, stop and say so. Never change git config.
