#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${GADGET_INSTALL_DIR:-"$HOME/.local/bin"}
INSTALL_TARGET="$INSTALL_DIR/gadget"
BUN_BIN=${BUN:-}

if [ -z "$BUN_BIN" ]; then
  BUN_BIN=$(command -v bun || true)
fi

if [ -z "$BUN_BIN" ]; then
  echo "Could not find bun. Install Bun first, or rerun with BUN=/path/to/bun." >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/bin" "$INSTALL_DIR"

cat > "$REPO_ROOT/bin/gadget" <<EOF
#!/bin/sh
exec "$BUN_BIN" "$REPO_ROOT/src/index.ts" "\$@"
EOF
chmod +x "$REPO_ROOT/bin/gadget"

if [ -e "$INSTALL_TARGET" ] || [ -L "$INSTALL_TARGET" ]; then
  CURRENT_TARGET=$(readlink "$INSTALL_TARGET" 2>/dev/null || true)
  if [ "$CURRENT_TARGET" != "$REPO_ROOT/bin/gadget" ]; then
    echo "$INSTALL_TARGET already exists and does not point to this checkout." >&2
    echo "Remove it first, or rerun with GADGET_INSTALL_DIR=/path/to/bin." >&2
    exit 1
  fi
fi

ln -sfn "$REPO_ROOT/bin/gadget" "$INSTALL_TARGET"

echo "Installed gadget to $INSTALL_TARGET"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Add $INSTALL_DIR to PATH to run gadget from anywhere."
    ;;
esac
