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
GADGET_DIFF_VIEW=${GADGET_DIFF_VIEW:-}
GADGET_DIFF_VIEW_EXPLICIT=0

if [ -n "$GADGET_CMUX" ]; then
  GADGET_CMUX_EXPLICIT=1
fi
if [ -n "$GADGET_DIFF_VIEW" ]; then
  GADGET_DIFF_VIEW_EXPLICIT=1
fi

if [ -z "$BUN_BIN" ]; then
  BUN_BIN=$(command -v bun || true)
fi

if [ -z "$BUN_BIN" ]; then
  if ! command -v curl >/dev/null 2>&1 || ! command -v bash >/dev/null 2>&1; then
    echo "Could not find bun, curl, or bash." >&2
    echo "Install Bun first, install curl and bash, or rerun with BUN=/path/to/bun." >&2
    exit 1
  fi

  echo "Could not find bun. Installing Bun..."
  BUN_INSTALL_SCRIPT=$(mktemp)
  trap 'rm -f "$BUN_INSTALL_SCRIPT"' EXIT HUP INT TERM
  curl -fsSL https://bun.sh/install -o "$BUN_INSTALL_SCRIPT"
  bash "$BUN_INSTALL_SCRIPT"

  BUN_BIN=$(command -v bun || true)
  if [ -z "$BUN_BIN" ] && [ -x "$HOME/.bun/bin/bun" ]; then
    BUN_BIN="$HOME/.bun/bin/bun"
  fi
fi

if [ -z "$BUN_BIN" ]; then
  echo "Bun was installed, but the bun executable could not be found." >&2
  echo "Restart your shell, add ~/.bun/bin to PATH, or rerun with BUN=/path/to/bun." >&2
  exit 1
fi

"$BUN_BIN" install --cwd "$REPO_ROOT"

mkdir -p "$REPO_ROOT/bin" "$INSTALL_DIR"

if [ -z "$GADGET_CMUX" ] && [ -f "$CONFIG_FILE" ]; then
  EXISTING_CMUX=$(sed -n 's/^[[:space:]]*cmux[[:space:]]*=[[:space:]]*\(true\|false\)[[:space:]]*$/\1/p' "$CONFIG_FILE" | tail -n 1)
  case "$EXISTING_CMUX" in
    true) GADGET_CMUX=1 ;;
    false) GADGET_CMUX=0 ;;
  esac
fi
if [ -z "$GADGET_DIFF_VIEW" ] && [ -f "$CONFIG_FILE" ]; then
  GADGET_DIFF_VIEW=$(sed -n 's/^[[:space:]]*view[[:space:]]*=[[:space:]]*"\(file\|continuous\)"[[:space:]]*$/\1/p' "$CONFIG_FILE" | tail -n 1)
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

if [ "$GADGET_DIFF_VIEW_EXPLICIT" = "0" ] && [ -t 0 ]; then
  DEFAULT_DIFF_VIEW=${GADGET_DIFF_VIEW:-file}
  while :; do
    printf "Diff view mode [file/continuous] (%s): " "$DEFAULT_DIFF_VIEW"
    read -r reply
    case "$reply" in
      "") GADGET_DIFF_VIEW=$DEFAULT_DIFF_VIEW ;;
      file|continuous) GADGET_DIFF_VIEW=$reply ;;
      *)
        echo "Please enter 'file' or 'continuous'."
        continue
        ;;
    esac
    GADGET_DIFF_VIEW_EXPLICIT=1
    break
  done
fi

case "$GADGET_CMUX" in
  1|true|TRUE|yes|YES|y|Y) GADGET_CMUX=1 ;;
  *) GADGET_CMUX=0 ;;
esac
case "$GADGET_DIFF_VIEW" in
  ""|file) GADGET_DIFF_VIEW=file ;;
  continuous) GADGET_DIFF_VIEW=continuous ;;
  *)
    echo "Invalid GADGET_DIFF_VIEW: $GADGET_DIFF_VIEW. Expected 'file' or 'continuous'." >&2
    exit 1
    ;;
esac

mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<EOF
[diff]
view = "$GADGET_DIFF_VIEW"

[integrations]
cmux = $([ "$GADGET_CMUX" = "1" ] && echo true || echo false)
EOF
elif [ "$GADGET_CMUX_EXPLICIT" = "1" ] || [ "$GADGET_DIFF_VIEW_EXPLICIT" = "1" ]; then
  CONFIG_TMP="$CONFIG_FILE.tmp.$$"
  awk \
    -v cmux_value="$([ "$GADGET_CMUX" = "1" ] && echo true || echo false)" \
    -v cmux_explicit="$GADGET_CMUX_EXPLICIT" \
    -v diff_view="$GADGET_DIFF_VIEW" \
    -v diff_view_explicit="$GADGET_DIFF_VIEW_EXPLICIT" '
    BEGIN { cmux_updated = 0; diff_view_updated = 0 }
    /^[[:space:]]*view[[:space:]]*=/ {
      if (diff_view_explicit == "1") {
        print "view = \"" diff_view "\""
        diff_view_updated = 1
        next
      }
    }
    /^[[:space:]]*cmux[[:space:]]*=/ {
      if (cmux_explicit == "1") {
        print "cmux = " cmux_value
        cmux_updated = 1
        next
      }
    }
    { print }
    END {
      if (diff_view_explicit == "1" && !diff_view_updated) {
        print ""
        print "[diff]"
        print "view = \"" diff_view "\""
      }
      if (cmux_explicit == "1" && !cmux_updated) {
        print ""
        print "[integrations]"
        print "cmux = " cmux_value
      }
    }
  ' "$CONFIG_FILE" > "$CONFIG_TMP"
  mv "$CONFIG_TMP" "$CONFIG_FILE"
fi

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
if [ "$GADGET_CMUX" = "1" ]; then
  echo "Enabled cmux integration for gadget claude."
else
  echo "cmux integration is disabled. Reinstall with GADGET_CMUX=1 to enable it."
fi
echo "Diff view is '$GADGET_DIFF_VIEW'. Reinstall with GADGET_DIFF_VIEW=continuous to enable continuous diffs."
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Add $INSTALL_DIR to PATH to run gadget from anywhere."
    ;;
esac
