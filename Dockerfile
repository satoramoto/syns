# Naked Claude: Claude Code exactly as it comes out of the box, for comparing
# syn against stock. Nothing from the host's ~/.claude gets in: no settings,
# CLAUDE.md, memory, skills, plugins or mods. Auth is ANTHROPIC_API_KEY passed
# at run time, or `claude` -> /login inside the container.
#
#   docker build --target naked -t syns-naked .
#   docker build --target syn   -t syns-syn   .
#   docker build --target dogfood -t syns-dogfood .   (your own long-lived session)
#
# Commands are in AGENTS.md and README.md.

FROM debian:bookworm-slim AS naked

# Pinned Claude Code version. Bump deliberately; the auto-updater is off so a
# run is reproducible.
ARG CLAUDE_CODE_VERSION=2.1.296

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git less procps \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash claude
USER claude
WORKDIR /home/claude

# The official native installer, pinned to the version above.
RUN curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_CODE_VERSION}"

# The config dir lives inside the container (ephemeral unless you mount a
# named volume on it; never mount the host's ~/.claude here).
ENV PATH="/home/claude/.local/bin:${PATH}" \
    CLAUDE_CONFIG_DIR="/home/claude/.claude" \
    DISABLE_AUTOUPDATER=1
RUN mkdir -p "${CLAUDE_CONFIG_DIR}"

# The repo (or any project) is mounted read-write here.
WORKDIR /work

CMD ["claude"]

# syn: the same stock install, plus syns' own templates as the user config and
# the syn plugin loaded from the image. Compare it against `naked`.
FROM naked AS syn

COPY --chown=claude:claude templates/CLAUDE.md   /home/claude/.claude/CLAUDE.md
COPY --chown=claude:claude templates/BRAIN.md    /home/claude/.claude/BRAIN.md
COPY --chown=claude:claude templates/LEXICON.md  /home/claude/.claude/LEXICON.md
COPY --chown=claude:claude templates/agents/     /home/claude/.claude/agents/
COPY --chown=claude:claude plugin/               /opt/syns/plugin/

CMD ["claude", "--plugin-dir", "/opt/syns/plugin"]

# dogfood-tools: everything the dogfood session needs except Claude Code
# itself, so rebuilding just the `dogfood` stage (--no-cache-filter dogfood)
# fetches the newest Claude without rebuilding the toolchains.
FROM debian:bookworm-slim AS dogfood-tools

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git gnupg less procps openssh-client \
      build-essential pkg-config libssl-dev python3 jq ripgrep unzip xz-utils \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends gh nodejs \
 && rm -rf /var/lib/apt/lists/*

# Git for the mounted repos: SSH commit signing through the forwarded agent
# (the public key is mounted at ~/.ssh/signing.pub; the private key never
# enters), gh as the GitHub credential helper, and the mounted repos trusted
# though the host owns them. Identity comes from GIT_AUTHOR_*/GIT_COMMITTER_*.
RUN git config --system gpg.format ssh \
 && git config --system user.signingkey /home/claude/.ssh/signing.pub \
 && git config --system commit.gpgsign true \
 && git config --system tag.gpgsign true \
 && git config --system safe.directory '*' \
 && git config --system credential.https://github.com.helper '' \
 && git config --system --add credential.https://github.com.helper '!gh auth git-credential' \
 && git config --system credential.https://gist.github.com.helper '' \
 && git config --system --add credential.https://gist.github.com.helper '!gh auth git-credential'

RUN useradd --create-home --shell /bin/bash claude
USER claude
WORKDIR /home/claude

# Mount points owned by claude, so the named volumes start out writable.
RUN mkdir -p /home/claude/.claude /home/claude/.config/gh \
 && mkdir -m 700 /home/claude/.ssh

RUN curl -fsSL https://bun.sh/install | bash \
 && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --component clippy,rustfmt

ENV PATH="/home/claude/.local/bin:/home/claude/.bun/bin:/home/claude/.cargo/bin:${PATH}" \
    CLAUDE_CONFIG_DIR="/home/claude/.claude" \
    CLAUDE_CODE_PLUGIN_DIR_WATCH=1

COPY --chown=claude:claude templates/ /opt/syns/templates/
COPY --chown=claude:claude docker/dogfood-start.sh /opt/syns/dogfood-start.sh

# dogfood: one permanent Claude session across all your projects, on the
# latest Claude Code (unpinned; auto-update allowed). Commands are in the
# README's "Dogfood syns" section.
FROM dogfood-tools AS dogfood

RUN curl -fsSL https://claude.ai/install.sh | bash

ENTRYPOINT ["/opt/syns/dogfood-start.sh"]
