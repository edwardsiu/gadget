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
GADGET_DIFF_RENDERING=${GADGET_DIFF_RENDERING:-}
GADGET_DIFF_RENDERING_EXPLICIT=0
GADGET_PI=${GADGET_PI:-}
GADGET_PI_EXPLICIT=0

if [ -n "$GADGET_CMUX" ]; then
  GADGET_CMUX_EXPLICIT=1
fi
if [ -n "$GADGET_DIFF_RENDERING" ]; then
  GADGET_DIFF_RENDERING_EXPLICIT=1
fi
if [ -n "$GADGET_PI" ]; then
  GADGET_PI_EXPLICIT=1
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
if [ -z "$GADGET_DIFF_RENDERING" ] && [ -f "$CONFIG_FILE" ]; then
  GADGET_DIFF_RENDERING=$(sed -n 's/^[[:space:]]*rendering[[:space:]]*=[[:space:]]*"\(unified\|auto\)"[[:space:]]*$/\1/p' "$CONFIG_FILE" | tail -n 1)
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

if [ -z "$GADGET_PI" ]; then
  GADGET_PI=0
  if command -v pi >/dev/null 2>&1 && [ -t 0 ]; then
    printf "Install Gadget Pi bridge extension? [y/N] "
    read -r reply
    case "$reply" in
      y|Y|yes|YES) GADGET_PI=1 ;;
    esac
  fi
fi

case "$GADGET_CMUX" in
  1|true|TRUE|yes|YES|y|Y) GADGET_CMUX=1 ;;
  *) GADGET_CMUX=0 ;;
esac
case "$GADGET_PI" in
  1|true|TRUE|yes|YES|y|Y) GADGET_PI=1 ;;
  *) GADGET_PI=0 ;;
esac
case "$GADGET_DIFF_RENDERING" in
  ""|auto) GADGET_DIFF_RENDERING=auto ;;
  unified) GADGET_DIFF_RENDERING=unified ;;
  *)
    echo "Invalid GADGET_DIFF_RENDERING: $GADGET_DIFF_RENDERING. Expected 'unified' or 'auto'." >&2
    exit 1
    ;;
esac

mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<EOF
[diff]
rendering = "$GADGET_DIFF_RENDERING"

[integrations]
cmux = $([ "$GADGET_CMUX" = "1" ] && echo true || echo false)
EOF
elif [ "$GADGET_CMUX_EXPLICIT" = "1" ] || [ "$GADGET_DIFF_RENDERING_EXPLICIT" = "1" ]; then
  CONFIG_TMP="$CONFIG_FILE.tmp.$$"
  awk \
    -v cmux_value="$([ "$GADGET_CMUX" = "1" ] && echo true || echo false)" \
    -v cmux_explicit="$GADGET_CMUX_EXPLICIT" \
    -v diff_rendering="$GADGET_DIFF_RENDERING" \
    -v diff_rendering_explicit="$GADGET_DIFF_RENDERING_EXPLICIT" '
    BEGIN { cmux_updated = 0; diff_rendering_updated = 0 }
    /^[[:space:]]*rendering[[:space:]]*=/ {
      if (diff_rendering_explicit == "1") {
        print "rendering = \"" diff_rendering "\""
        diff_rendering_updated = 1
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
      if (diff_rendering_explicit == "1" && !diff_rendering_updated) {
        print ""
        print "[diff]"
        print "rendering = \"" diff_rendering "\""
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

if [ "$GADGET_PI" = "1" ]; then
  if ! command -v pi >/dev/null 2>&1; then
    echo "GADGET_PI=1 was set, but pi could not be found on PATH." >&2
    exit 1
  fi
  pi install "$REPO_ROOT/pi-extension"
fi

echo "Installed gadget to $INSTALL_TARGET"
if [ "$GADGET_CMUX" = "1" ]; then
  echo "Enabled cmux integration for gadget claude."
else
  echo "cmux integration is disabled. Reinstall with GADGET_CMUX=1 to enable it."
fi
if [ "$GADGET_PI" = "1" ]; then
  echo "Installed Gadget Pi extension."
elif [ "$GADGET_PI_EXPLICIT" = "1" ]; then
  echo "Skipped Gadget Pi extension."
else
  echo "Pi extension is not installed. Run 'pi install $REPO_ROOT/pi-extension' to install it separately."
fi
echo "Diff rendering is '$GADGET_DIFF_RENDERING'. Reinstall with GADGET_DIFF_RENDERING=unified to force unified diffs."
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Add $INSTALL_DIR to PATH to run gadget from anywhere."
    ;;
esac
