# Gadget Pi Extension

This package adds first-class Gadget-style overlays inside Pi.

## Install

From this repository:

```sh
pi install ./pi-extension
```

For only the current project:

```sh
pi install -l ./pi-extension
```

For one-off testing without installing:

```sh
pi -e ./pi-extension/extensions/gadget.js
```

## Commands

- `/feedback` opens a feedback overlay for the latest assistant turn, with previous/next turn navigation and transcript-wide mode.
- `/review` opens a saved-comments-only code review overlay for the current `git diff HEAD`, then submits one combined review prompt.
