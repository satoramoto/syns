# syns

**syns enables the user to manifest their ideas by maintaining a blissful and
effortless flow state.**

syn turns one long-lived Claude Code session into an extension of your brain.
It keeps your brain state (what you're working on, why, in what order, and
what's next) in a plain file, collects every open question into one inbox that
you answer as a quick quiz instead of being interrupted, routes heavy work to
background agents so the session stays conversational, and runs it all on one
state machine whose modes match the work's rigour to your mood. You stay in the
loop; syn keeps the thread. Read [VISION.md](VISION.md) for the why and the
shape.

Status: **proof of concept.** The docs, templates and a naked-Claude Docker
image are here; the plugin is a skeleton.

## Install (later)

There's no installer yet. When there is, it will add the `syn` plugin from a
marketplace and run `/syn onboard` to draft your `BRAIN.md`, `LEXICON.md` and
a base context per repo. Until then, by hand:

1. Copy `templates/BRAIN.md` and `templates/LEXICON.md` to `~/.claude/`.
2. Copy `templates/agents/*.md` to `~/.claude/agents/`.
3. Paste `templates/CLAUDE.md` into your `~/.claude/CLAUDE.md`.
4. For each repo you work in, copy `templates/base-context.md` to
   `<repo>/.claude/base-context.md` and gitignore it.
5. Load the plugin: `claude --plugin-dir /path/to/syns/plugin`, then `/syn`.

The templates are a starting point, not a framework. Skills and agents should
grow out of your own use: change, drop or add them as your workflow develops.

## Try it against stock Claude Code

A Docker image runs Claude Code exactly as it ships, with nothing from your
`~/.claude`; a second target adds syn's templates and plugin. Auth comes from
`ANTHROPIC_API_KEY` in your shell or `/login` inside the container.

```sh
docker build --target naked -t syns-naked .
docker build --target syn   -t syns-syn   .
docker run --rm -it -e ANTHROPIC_API_KEY -v "$PWD":/work syns-naked
docker run --rm -it -e ANTHROPIC_API_KEY -v "$PWD":/work syns-syn
```

More in [AGENTS.md](AGENTS.md).

## Dogfood syns

One permanent Claude session in Docker that spans all your projects, on the
latest Claude Code, with syn's plugins loaded from this checkout. The full
reference (what persists where, signing, sandboxing) is in
[AGENTS.md](AGENTS.md#dogfood-syns). In short:

- `~/Code` is for code; `~/.syns` is for everything else: syn's state
  (`brain.json`, `LEXICON.md`, later `memory.jsonl`), `scratch/<topic>/` for
  temp files and experiments, `files/<topic>/` for non-code keepers. These two
  are the only host folders the container can write; the session's `TMPDIR`
  is `~/.syns/scratch`.
- Claude's config, logins, sessions and transcripts, and `gh`'s login, live in
  named volumes (`syns-claude`, `syns-gh`): you log in once, and only removing
  the volumes logs you out.

```sh
# build
docker build --target dogfood -t syns-dogfood .

# first run: creates the `syns` container; log in to Claude, then run `! gh auth login`
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

# every time after: re-attach (resumes the same conversation)
docker start -ai syns

# update Claude: rebuild only the final stage, then re-create the container
docker build --target dogfood --no-cache-filter dogfood -t syns-dogfood .
docker rm syns   # then the first-run command again; the volumes keep everything

# reset: forget the session, config and logins (~/Code and ~/.syns are untouched)
docker rm syns && docker volume rm syns-claude syns-gh
```

## Docs

- [VISION.md](VISION.md): the why, the shape, what it isn't, and the POC's scope.
- [docs/spec.md](docs/spec.md): the session machine, with brain state and the
  inbox as its data model.
- [docs/lexicon.md](docs/lexicon.md): the shared vocabulary.
- [docs/prior-art.md](docs/prior-art.md): where the name comes from.

## License

[MIT](LICENSE).
