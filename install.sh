#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${GADGET_INSTALL_DIR:-"$HOME/.local/bin"}
INSTALL_TARGET="$INSTALL_DIR/gadget"
CONFIG_DIR=${GADGET_CONFIG_DIR:-"$HOME/.gadget"}
CONFIG_FILE="$CONFIG_DIR/config.toml"
BUN_BIN=${BUN:-}
GADGET_CMUX=${GADGET_CMUX:-}
GADGET_CMUX_EXPLICIT=0

if [ -n "$GADGET_CMUX" ]; then
  GADGET_CMUX_EXPLICIT=1
fi

if [ -z "$BUN_BIN" ]; then
  BUN_BIN=$(command -v bun || true)
fi

if [ -z "$BUN_BIN" ]; then
  echo "Could not find bun. Install Bun first, or rerun with BUN=/path/to/bun." >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/bin" "$INSTALL_DIR"

if [ -z "$GADGET_CMUX" ] && [ -f "$REPO_ROOT/bin/gadget" ]; then
  EXISTING_CMUX=$(sed -n 's/^export GADGET_CMUX="\([^"]*\)"$/\1/p' "$REPO_ROOT/bin/gadget" | tail -n 1)
  if [ -n "$EXISTING_CMUX" ]; then
    GADGET_CMUX="$EXISTING_CMUX"
  fi
fi

if [ -z "$GADGET_CMUX" ] && [ -f "$CONFIG_FILE" ]; then
  EXISTING_CMUX=$(sed -n 's/^[[:space:]]*cmux[[:space:]]*=[[:space:]]*\(true\|false\)[[:space:]]*$/\1/p' "$CONFIG_FILE" | tail -n 1)
  case "$EXISTING_CMUX" in
    true) GADGET_CMUX=1 ;;
    false) GADGET_CMUX=0 ;;
  esac
fi

if [ -z "$GADGET_CMUX" ]; then
  GADGET_CMUX=0
  if command -v cmux >/dev/null 2>&1 && [ -t 0 ]; then
    printf "Enable cmux integration for 'gadget claude'? [y/N] "
    read -r reply
    case "$reply" in
      y|Y|yes|YES) GADGET_CMUX=1 ;;
    esac
  fi
fi

case "$GADGET_CMUX" in
  1|true|TRUE|yes|YES|y|Y) GADGET_CMUX=1 ;;
  *) GADGET_CMUX=0 ;;
esac

mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<EOF
[integrations]
cmux = $([ "$GADGET_CMUX" = "1" ] && echo true || echo false)
EOF
elif [ "$GADGET_CMUX_EXPLICIT" = "1" ]; then
  CONFIG_TMP="$CONFIG_FILE.tmp.$$"
  awk -v value="$([ "$GADGET_CMUX" = "1" ] && echo true || echo false)" '
    BEGIN { updated = 0 }
    /^[[:space:]]*cmux[[:space:]]*=/ {
      print "cmux = " value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print ""
        print "[integrations]"
        print "cmux = " value
      }
    }
  ' "$CONFIG_FILE" > "$CONFIG_TMP"
  mv "$CONFIG_TMP" "$CONFIG_FILE"
fi

cat > "$REPO_ROOT/bin/gadget" <<EOF
#!/bin/sh
export GADGET_CMUX="$GADGET_CMUX"
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
if [ "$GADGET_CMUX" = "1" ]; then
  echo "Enabled cmux integration for gadget claude."
else
  echo "cmux integration is disabled. Reinstall with GADGET_CMUX=1 to enable it."
fi
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Add $INSTALL_DIR to PATH to run gadget from anywhere."
    ;;
esac
