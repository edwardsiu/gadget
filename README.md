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

The installer bootstraps Bun if needed. Claude integration requires cmux.
It can also optionally install the standalone Pi extension.

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

# Or install only the Pi extension for in-Pi /feedback and /review overlays.
pi install ./pi-extension

# Connect to your running agent.
gadget
```

`gadget claude` uses cmux only when `[integrations].cmux` is enabled and the command is run inside a cmux terminal pane. Review comments are pasted into that Claude pane as one multiline message. If cmux integration is disabled, `gadget claude` runs the Claude CLI normally.

The Pi extension is independent from the Gadget CLI. Install it with `pi install ./pi-extension`, or answer yes to the installer prompt. It adds `/feedback` for assistant-turn or transcript feedback and `/review` for saved-comments-only code review inside Pi.

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

## Development Setup

For local agent development, run:

```bash
sh setup.sh
```

The development setup script links the shared agent instructions for Claude compatibility:
`.claude/skills -> ../.agents/skills` and `CLAUDE.md -> AGENTS.md`.
