# Naked Claude: Claude Code exactly as it comes out of the box, for comparing
# syn against stock. Nothing from the host's ~/.claude gets in: no settings,
# CLAUDE.md, memory, skills, plugins or mods. Auth is ANTHROPIC_API_KEY passed
# at run time, or `claude` -> /login inside the container.
#
#   docker build --target naked -t syns-naked .
#   docker build --target syn   -t syns-syn   .
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
