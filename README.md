# Gadget

Gadget is a terminal diff reviewer for coding-agent sessions.

It watches a working tree, renders live file diffs, lets you attach comments to diff lines, and can either copy comments to your clipboard or connect them to a live Codex or Claude session.

## Quick Demonstration

![Quick demonstration of Gadget](docs/assets/gadget-demo.webp)

## Key Features

- Live terminal diff viewer for active coding-agent worktrees.
- Inline comments on specific diff lines.
- Clipboard review mode for copying comments into any agent or chat.
- Connected Codex mode for sending review comments back to a live session.
- Optional cmux-backed Claude mode for sending review comments to the current Claude pane.
- Full-file view, file search, diff-base selection, and keyboard-first navigation.

## Install

```bash
bash install.sh
```

Verify the install:

```bash
gadget --help
```

## Quick Start

```bash
# Start Codex with Gadget app-server integration.
gadget codex

# Or start Claude. This works best with cmux enabled.
gadget claude

# Connect to your running agent.
gadget
```

`gadget claude` uses cmux only when `[integrations].cmux` is enabled and the command is run inside a cmux terminal pane. Review comments are pasted into that Claude pane as one multiline message. If cmux integration is disabled, `gadget claude` runs the Claude CLI normally.

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

## Installer Options

The installer uses Bun and installs it automatically if it is not already available. The Codex CLI is optional for connected Codex sessions. The Claude CLI and cmux are optional for connected Claude sessions.

The installer writes a local wrapper at `bin/gadget` and symlinks it to `~/.local/bin/gadget`. It refuses to overwrite an existing `gadget` command that points somewhere else. Make sure `~/.local/bin` is on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To install somewhere else:

```bash
GADGET_INSTALL_DIR=/usr/local/bin bash install.sh
```

If cmux is installed, the installer prompts whether to enable Claude integration. The setting is stored in `~/.gadget/config.toml`:

```toml
[diff]
view = "file" # or "continuous"

[integrations]
cmux = true
```

You can also set it non-interactively:

```bash
GADGET_CMUX=1 GADGET_DIFF_VIEW=continuous bash install.sh
```

## Development Setup

For local agent development, run:

```bash
sh setup.sh
```

The development setup script links the shared agent instructions for Claude compatibility:
`.claude/skills -> ../.agents/skills` and `CLAUDE.md -> AGENTS.md`.
