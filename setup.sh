#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

link_path() {
  source_path=$1
  target_path=$2

  if [ -L "$target_path" ]; then
    rm "$target_path"
  elif [ -e "$target_path" ]; then
    echo "Refusing to overwrite existing path: $target_path" >&2
    exit 1
  fi

  ln -s "$source_path" "$target_path"
}

mkdir -p "$repo_root/.claude"

link_path "../.agents/skills" "$repo_root/.claude/skills"
link_path "AGENTS.md" "$repo_root/CLAUDE.md"

echo "Linked .claude/skills -> ../.agents/skills"
echo "Linked CLAUDE.md -> AGENTS.md"
