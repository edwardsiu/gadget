# Gadget

Gadget is a terminal diff reviewer for coding-agent sessions.

It watches a working tree, renders live file diffs, lets you attach comments to diff lines, and can either copy comments to your clipboard or connect them to a live Codex thread.

## Install

Gadget requires Bun. The Codex CLI is optional for connected Codex sessions.

From this repo, install dependencies and link the `gadget` command:

```bash
bun install
sh setup.sh
sh install.sh
```

The setup script links the shared agent instructions for Claude compatibility:
`.claude/skills -> ../.agents/skills` and `CLAUDE.md -> AGENTS.md`.

The installer writes a local wrapper at `bin/gadget` and symlinks it to `~/.local/bin/gadget`. It refuses to overwrite an existing `gadget` command that points somewhere else. Make sure `~/.local/bin` is on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To install somewhere else:

```bash
GADGET_INSTALL_DIR=/usr/local/bin sh install.sh
```

Verify the install:

```bash
gadget --help
```

## Quick Start

```bash
# Open the diff viewer and connect to a matching live session when possible.
gadget

# Open a single file in full-file view, optionally at a line.
gadget some/file.txt
gadget some/file.txt:50

# Start Codex with Gadget app-server integration.
gadget codex

# Create a Gadget worktree and start Codex there.
gadget worktree --start

# Open the diff viewer in clipboard mode.
gadget view
```

## Keybindings

```text
J            Down
K            Up
Shift+J      Page down
Shift+K      Page up
H            Previous file
L            Next file
P            Open file selector
Shift+P      Search project files
B            Choose diff base
O            Toggle full file
Enter        Comment
R            Start review
Shift+R      Reply agent turn
S            Session info
?            Keybindings
Shift+Q      Quit
```
