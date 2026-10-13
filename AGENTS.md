# syns

Read [`README.md`](README.md) and [`VISION.md`](VISION.md) first. The session
machine is specified in [`docs/spec.md`](docs/spec.md); words are defined in
[`docs/lexicon.md`](docs/lexicon.md).

## Layout

- `VISION.md`, `docs/`: the why, the spec, the lexicon, prior art.
- `templates/`: starter files a new user copies into `~/.claude/` (and a base
  context per repo). Keep them generic: no one's personal setup.
- `plugin/`: the `syn` Claude Code plugin (a skeleton for now).
- `Dockerfile`: the naked Claude image (`naked`) and the syn variant (`syn`).

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
| `docker build --target naked -t syns-naked .` | the naked image builds with the pinned Claude Code | a change to `Dockerfile` |
| `docker build --target syn -t syns-syn .` | the syn variant builds with the templates and plugin | a change to `Dockerfile`, `templates/` or `plugin/` you want to try in a container |
| `docker run --rm syns-naked claude --version` | Claude Code runs inside the image (exit 0) | after building the image |

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

## Git

- `main` is the default branch. Work on a branch; once there's a remote, open
  a PR and let CI be the final check.
- Every agent commit ends with a blank line and a co-author trailer naming the
  agent, for example `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If commit signing fails, stop and say so. Never change git config.
