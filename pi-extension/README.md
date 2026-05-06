# Gadget Pi Extension

This package lets Gadget connect to live Pi sessions.

## Install

From this repository:

```sh
pi install ./pi-extension
```

For only the current project:

```sh
pi install -l ./pi-extension
```

For one-off testing without installing, start Pi through Gadget or load the extension directly:

```sh
gadget pi
pi -e ./pi-extension/extensions/gadget.js
```

## Commands

This package does not add Pi slash commands. It starts a local bridge when Pi starts, registers that bridge with Gadget, and lets `gadget` send review comments to the matching Pi session.

If multiple Pi sessions are active for the same git checkout, `gadget` shows its session picker before opening the reviewer.
