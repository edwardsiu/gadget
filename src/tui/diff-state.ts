import type { ReadDiffStateOptions } from "../git";
import type { DiffState } from "../types";

export function diffStateSignature(state: DiffState): string {
  return [
    state.cwd,
    state.baseRef,
    state.branchName,
    state.repositoryRoot,
    state.worktreePath,
    ...state.files.map((file) => [
      file.filePath,
      file.additions,
      file.removals,
      file.rawDiff,
    ].join("\0")),
  ].join("\0");
}

export function mergeDiffRefreshOptions(current: ReadDiffStateOptions | null, next: ReadDiffStateOptions): ReadDiffStateOptions {
  if (!current) {
    return next;
  }
  if (current.includeUntracked === false && next.includeUntracked === false) {
    return { includeUntracked: false };
  }
  return {};
}
