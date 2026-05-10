import { existsSync, readFileSync, statSync, watch as watchFileSystem, type Dirent, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { DiffFile, DiffLineRef, DiffState } from "./types";

const DIFF_CONTEXT_LINES = 3;
const MAX_LOCAL_DIFF_BASE_REFS = 48;
const MAX_SYNTHETIC_DIFF_FILE_SIZE = 1_000_000;

export type DiffWatcher = {
  close(): Promise<void>;
};

export type ReadDiffStateOptions = {
  baseRef?: string;
  includeUntracked?: boolean;
  gitInfo?: GitInfo;
};

export type DiffBaseCandidateSource = "config" | "upstream" | "local" | "default";

export type DiffBaseCandidate = {
  ref: string;
  mergeBase: string;
  label: string;
  detail: string;
  source: DiffBaseCandidateSource;
};

export type GitInfo = {
  cwd: string;
  branchName: string;
};

export async function runGit(cwd: string, args: string[]): Promise<string> {
  return await runCommand(cwd, "git", args);
}

async function runReadOnlyGit(cwd: string, args: string[]): Promise<string> {
  return await runCommand(cwd, "git", ["--no-optional-locks", ...args]);
}

async function runCommand(cwd: string, command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<string> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = options.timeoutMs
    ? setTimeout(() => proc.kill(), options.timeoutMs)
    : null;
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${command} ${args.join(" ")} failed`);
  }
  return stdout;
}

export async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(cwd, args);
  } catch {
    return null;
  }
}

async function tryReadOnlyGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runReadOnlyGit(cwd, args);
  } catch {
    return null;
  }
}

export async function assertGitRepo(cwd: string): Promise<void> {
  await runReadOnlyGit(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function readDiffState(cwd: string, options: ReadDiffStateOptions = {}): Promise<DiffState> {
  if (!(await isGitRepo(cwd))) {
    return await readFilesystemDiffState(cwd);
  }

  const [baseCandidate, gitInfo] = await Promise.all([
    resolveDiffBase(cwd, options.baseRef),
    options.gitInfo ? Promise.resolve(options.gitInfo) : readGitInfo(cwd),
  ]);
  const diff = await runReadOnlyGit(cwd, ["diff", baseCandidate.mergeBase, "--no-color", "--no-ext-diff", `--unified=${DIFF_CONTEXT_LINES}`, "--"]);
  const files = parseUnifiedDiff(diff);
  if (options.includeUntracked !== false) {
    files.push(...(await readUntrackedDiffs(cwd)));
  }
  return {
    cwd: gitInfo.cwd,
    baseRef: baseCandidate.mergeBase,
    baseRefLabel: baseCandidate.label,
    branchName: gitInfo.branchName,
    files,
    refreshedAt: Date.now(),
  };
}

export async function listSearchableFiles(cwd: string): Promise<string[]> {
  const output = await tryReadOnlyGit(cwd, ["ls-files", "-co", "--exclude-standard", "-z"]);
  if (output === null) {
    return await listFilesystemFiles(cwd);
  }
  return [...new Set(output.split("\0").filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function readCurrentBranch(cwd: string): Promise<string> {
  const branch = (await tryReadOnlyGit(cwd, ["branch", "--show-current"]))?.trim();
  if (branch) {
    return branch;
  }

  const shortSha = (await tryReadOnlyGit(cwd, ["rev-parse", "--short", "HEAD"]))?.trim();
  return shortSha ? `detached:${shortSha}` : "HEAD";
}

export async function readGitInfo(cwd: string): Promise<GitInfo> {
  const root = await readGitRoot(cwd);
  if (!root) {
    return {
      cwd: resolve(cwd),
      branchName: "no git",
    };
  }

  const branchName = await readCurrentBranch(root);

  return {
    cwd: root,
    branchName: branchName || "HEAD",
  };
}

export async function findBranchDiffBase(cwd: string): Promise<string> {
  return (await resolveDiffBase(cwd)).mergeBase;
}

export async function listDiffBaseCandidates(cwd: string): Promise<DiffBaseCandidate[]> {
  const currentBranch = await readCurrentBranch(cwd);
  const [configuredRefs, upstreamRefs, defaultRefs, localRefs] = await Promise.all([
    configuredDiffBaseRefs(cwd, currentBranch),
    upstreamDiffBaseRefs(cwd, currentBranch),
    defaultDiffBaseRefs(cwd),
    localDiffBaseRefs(cwd, currentBranch),
  ]);
  const refs = uniqueDiffBaseRefs([
    ...configuredRefs,
    ...upstreamRefs,
    ...defaultRefs,
    ...localRefs,
  ]);

  const resolvedCandidates = (await Promise.all(refs.map(async (ref, index) => ({
    ref,
    mergeBase: (await tryReadOnlyGit(cwd, ["merge-base", "HEAD", ref.ref]))?.trim(),
    distanceFromHead: null as number | null,
    order: index,
  })))).filter((candidate): candidate is ResolvedDiffBaseCandidate => Boolean(candidate.mergeBase));

  await Promise.all(resolvedCandidates.map(async (candidate) => {
    if (candidate.ref.source !== "local") {
      return;
    }
    candidate.distanceFromHead = await countCommitsFromBaseToHead(cwd, candidate.mergeBase);
  }));

  const preferredByMergeBase = new Map<string, ResolvedDiffBaseCandidate>();
  for (const candidate of resolvedCandidates) {
    if (candidate.ref.source === "local" && candidate.distanceFromHead === 0) {
      continue;
    }
    const previous = preferredByMergeBase.get(candidate.mergeBase);
    if (!previous || compareDuplicateDiffBaseCandidates(candidate, previous) < 0) {
      preferredByMergeBase.set(candidate.mergeBase, candidate);
    }
  }

  return [...preferredByMergeBase.values()]
    .sort(compareDiffBaseCandidates)
    .map(({ ref, mergeBase }) => ({
      ...ref,
      mergeBase,
    }));
}

async function resolveDiffBase(cwd: string, baseRef?: string): Promise<DiffBaseCandidate> {
  if (baseRef) {
    const mergeBase = (await tryReadOnlyGit(cwd, ["merge-base", "HEAD", baseRef]))?.trim();
    if (mergeBase) {
      return {
        ref: baseRef,
        mergeBase,
        label: baseRef,
        detail: "selected",
        source: "config",
      };
    }
  }

  return (await listDiffBaseCandidates(cwd))[0] ?? {
    ref: "HEAD",
    mergeBase: "HEAD",
    label: "HEAD",
    detail: "fallback",
    source: "default",
  };
}

type DiffBaseRef = {
  ref: string;
  label: string;
  detail: string;
  source: DiffBaseCandidateSource;
};

type ResolvedDiffBaseCandidate = {
  ref: DiffBaseRef;
  mergeBase: string;
  distanceFromHead: number | null;
  order: number;
};

async function configuredDiffBaseRefs(cwd: string, currentBranch: string): Promise<DiffBaseRef[]> {
  if (!isNamedBranch(currentBranch)) {
    return [];
  }

  const keys = ["vscode-merge-base", "gh-merge-base", "merge-base"];
  const values = await Promise.all(keys.map(async (key) => {
    const value = (await tryReadOnlyGit(cwd, ["config", "--get", `branch.${currentBranch}.${key}`]))?.trim();
    return value ? { key, value } : null;
  }));

  return values.flatMap((entry) => {
    if (!entry) {
      return [];
    }
    return branchNameToCandidateRefs(entry.value, "config", `branch.${entry.key}`);
  });
}

async function upstreamDiffBaseRefs(cwd: string, currentBranch: string): Promise<DiffBaseRef[]> {
  const upstream = (await tryReadOnlyGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]))?.trim();
  if (!upstream || remoteBranchName(upstream) === currentBranch) {
    return [];
  }
  return [{
    ref: upstream,
    label: upstream,
    detail: "upstream",
    source: "upstream",
  }];
}

async function localDiffBaseRefs(cwd: string, currentBranch: string): Promise<DiffBaseRef[]> {
  if (!isNamedBranch(currentBranch)) {
    return [];
  }

  const output = await tryReadOnlyGit(cwd, [
    "for-each-ref",
    `--count=${MAX_LOCAL_DIFF_BASE_REFS}`,
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((label) => label && label !== currentBranch)
    .map((label) => ({
      ref: label,
      label,
      detail: "local branch point",
      source: "local" as const,
    }));
}

async function defaultDiffBaseRefs(cwd: string): Promise<DiffBaseRef[]> {
  const defaultBranch = await findOriginDefaultBranch(cwd);
  return uniqueRefs([defaultBranch, "origin/main", "origin/master", "main", "master"]).map((ref) => ({
    ref,
    label: ref,
    detail: "default branch",
    source: "default" as const,
  }));
}

function branchNameToCandidateRefs(branchName: string, source: DiffBaseCandidateSource, detail: string): DiffBaseRef[] {
  const ref = branchName.trim();
  if (!ref) {
    return [];
  }
  if (isExplicitRef(ref)) {
    return [{
      ref,
      label: ref,
      detail,
      source,
    }];
  }
  return [
    {
      ref: `origin/${ref}`,
      label: `origin/${ref}`,
      detail,
      source,
    },
    {
      ref,
      label: ref,
      detail,
      source,
    },
  ];
}

function uniqueDiffBaseRefs(refs: DiffBaseRef[]): DiffBaseRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (!ref.ref || seen.has(ref.ref)) {
      return false;
    }
    seen.add(ref.ref);
    return true;
  });
}

function isNamedBranch(branchName: string): boolean {
  return branchName !== "HEAD" && !branchName.startsWith("detached:");
}

function isExplicitRef(ref: string): boolean {
  return ref.startsWith("refs/") || ref.startsWith("origin/");
}

function remoteBranchName(ref: string): string {
  return ref.replace(/^refs\/remotes\//, "").replace(/^[^/]+\//, "");
}

async function countCommitsFromBaseToHead(cwd: string, mergeBase: string): Promise<number | null> {
  const output = (await tryReadOnlyGit(cwd, ["rev-list", "--count", `${mergeBase}..HEAD`]))?.trim();
  if (!output) {
    return null;
  }
  const count = Number(output);
  return Number.isFinite(count) ? count : null;
}

function compareDiffBaseCandidates(left: ResolvedDiffBaseCandidate, right: ResolvedDiffBaseCandidate): number {
  const sourceDifference = sourceSortRank(left.ref.source) - sourceSortRank(right.ref.source);
  if (sourceDifference !== 0) {
    return sourceDifference;
  }

  if (left.ref.source === "local" && right.ref.source === "local") {
    const distanceDifference = (left.distanceFromHead ?? Number.MAX_SAFE_INTEGER) - (right.distanceFromHead ?? Number.MAX_SAFE_INTEGER);
    if (distanceDifference !== 0) {
      return distanceDifference;
    }
  }

  return left.order - right.order;
}

function compareDuplicateDiffBaseCandidates(left: ResolvedDiffBaseCandidate, right: ResolvedDiffBaseCandidate): number {
  const sourceDifference = duplicateSourceSortRank(left.ref.source) - duplicateSourceSortRank(right.ref.source);
  if (sourceDifference !== 0) {
    return sourceDifference;
  }
  return compareDiffBaseCandidates(left, right);
}

function sourceSortRank(source: DiffBaseCandidateSource): number {
  switch (source) {
    case "config":
      return 0;
    case "upstream":
      return 1;
    case "local":
      return 2;
    case "default":
      return 3;
  }
}

function duplicateSourceSortRank(source: DiffBaseCandidateSource): number {
  switch (source) {
    case "config":
      return 0;
    case "upstream":
      return 1;
    case "default":
      return 2;
    case "local":
      return 3;
  }
}

async function findOriginDefaultBranch(cwd: string): Promise<string | null> {
  const symbolicRef = (await tryReadOnlyGit(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]))?.trim();
  if (symbolicRef) {
    return symbolicRef;
  }

  const remoteHead = (await tryReadOnlyGit(cwd, ["remote", "show", "-n", "origin"]))?.match(/HEAD branch: (.+)/)?.[1]?.trim();
  return remoteHead && remoteHead !== "(not queried)" ? `origin/${remoteHead}` : null;
}

function uniqueRefs(refs: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return refs.filter((ref): ref is string => {
    if (!ref || seen.has(ref)) {
      return false;
    }
    seen.add(ref);
    return true;
  });
}

export function createDiffWatcher(cwd: string, onChange: () => void): DiffWatcher {
  let closed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let fsWatcher: FSWatcher | null = null;
  const gitWatchers: FSWatcher[] = [];

  const scheduleChange = () => {
    if (closed) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 100);
  };

  try {
    fsWatcher = watchFileSystem(cwd, { recursive: true }, (_eventType, filename) => {
      const changedPath = filename?.toString() ?? "";
      if (changedPath === ".git" || changedPath.startsWith(".git/") || changedPath.includes("/.git/")) {
        return;
      }
      scheduleChange();
    });
  } catch {
    fsWatcher = null;
  }

  gitWatchers.push(...createGitMetadataWatchers(cwd, scheduleChange));

  const timer = fsWatcher
    ? null
    : setInterval(scheduleChange, 1_000);
  return {
    async close() {
      closed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      fsWatcher?.close();
      for (const watcher of gitWatchers) {
        watcher.close();
      }
      if (timer) {
        clearInterval(timer);
      }
    },
  };
}

function createGitMetadataWatchers(cwd: string, onChange: () => void): FSWatcher[] {
  const gitDir = resolveGitDir(cwd);
  if (!gitDir) {
    return [];
  }

  const paths = uniqueRefs([
    join(cwd, ".git"),
    join(gitDir, "HEAD"),
    join(gitDir, "index"),
    join(gitDir, "packed-refs"),
    join(gitDir, "FETCH_HEAD"),
    join(gitDir, "refs", "heads"),
    join(gitDir, "refs", "remotes"),
  ]);
  const watchers: FSWatcher[] = [];
  for (const path of paths) {
    const watcher = watchPath(path, onChange);
    if (watcher) {
      watchers.push(watcher);
    }
  }
  return watchers;
}

function resolveGitDir(cwd: string): string | null {
  const dotGit = join(cwd, ".git");
  if (!existsSync(dotGit)) {
    return null;
  }
  try {
    const stat = statSync(dotGit);
    if (stat.isDirectory()) {
      return dotGit;
    }
    if (!stat.isFile()) {
      return null;
    }
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    const gitDir = match?.[1]?.trim();
    if (!gitDir) {
      return null;
    }
    return isAbsolute(gitDir) ? gitDir : resolve(dirname(dotGit), gitDir);
  } catch {
    return null;
  }
}

function watchPath(path: string, onChange: () => void): FSWatcher | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const recursive = statSync(path).isDirectory();
    return watchFileSystem(path, { recursive }, onChange);
  } catch {
    try {
      return watchFileSystem(path, onChange);
    } catch {
      return null;
    }
  }
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const lines = diff.split(/\r?\n/);
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentRaw: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunkHeader: string | null = null;
  let lineId = 0;

  const finish = () => {
    if (!current) {
      return;
    }
    current.rawDiff = currentRaw.join("\n");
    files.push(current);
  };

  for (let rawIndex = 0; rawIndex < lines.length; rawIndex += 1) {
    const raw = lines[rawIndex] ?? "";
    if (raw === "" && rawIndex === lines.length - 1) {
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      finish();
      const filePath = parseDiffGitPath(raw);
      current = {
        filePath,
        additions: 0,
        removals: 0,
        lines: [],
        rawDiff: "",
      };
      currentRaw = [raw];
      oldLine = 0;
      newLine = 0;
      hunkHeader = null;
      lineId = 0;
      continue;
    }

    if (!current) {
      continue;
    }
    currentRaw.push(raw);

    if (raw.startsWith("+++ b/")) {
      current.filePath = raw.slice("+++ b/".length);
      continue;
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      hunkHeader = raw;
      current.lines.push({
        id: `${current.filePath}:${lineId++}`,
        filePath: current.filePath,
        kind: "hunk",
        oldLine: null,
        newLine: null,
        hunkHeader,
        text: raw,
        raw,
      });
      continue;
    }

    if (!hunkHeader) {
      if (raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("index ")) {
        continue;
      }
      current.lines.push({
        id: `${current.filePath}:${lineId++}`,
        filePath: current.filePath,
        kind: "file",
        oldLine: null,
        newLine: null,
        hunkHeader: null,
        text: raw,
        raw,
      });
      continue;
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      current.additions += 1;
      current.lines.push({
        id: `${current.filePath}:${lineId++}`,
        filePath: current.filePath,
        kind: "add",
        oldLine: null,
        newLine,
        hunkHeader,
        text: raw.slice(1),
        raw,
      });
      newLine += 1;
      continue;
    }

    if (raw.startsWith("-") && !raw.startsWith("---")) {
      current.removals += 1;
      current.lines.push({
        id: `${current.filePath}:${lineId++}`,
        filePath: current.filePath,
        kind: "remove",
        oldLine,
        newLine: null,
        hunkHeader,
        text: raw.slice(1),
        raw,
      });
      oldLine += 1;
      continue;
    }

    if (raw.startsWith("\\")) {
      current.lines.push({
        id: `${current.filePath}:${lineId++}`,
        filePath: current.filePath,
        kind: "file",
        oldLine: null,
        newLine: null,
        hunkHeader,
        text: raw,
        raw,
      });
      continue;
    }

    current.lines.push({
      id: `${current.filePath}:${lineId++}`,
      filePath: current.filePath,
      kind: "context",
      oldLine,
      newLine,
      hunkHeader,
      text: raw.startsWith(" ") ? raw.slice(1) : raw,
      raw,
    });
    oldLine += 1;
    newLine += 1;
  }

  finish();
  return files;
}

async function isGitRepo(cwd: string): Promise<boolean> {
  return (await readGitRoot(cwd)) !== null;
}

async function readGitRoot(cwd: string): Promise<string | null> {
  return (await tryReadOnlyGit(cwd, ["rev-parse", "--show-toplevel"]))?.trim() || null;
}

async function readFilesystemDiffState(cwd: string): Promise<DiffState> {
  const root = resolve(cwd);
  const files = await readFilesystemDiffs(root);
  return {
    cwd: root,
    baseRef: "filesystem",
    baseRefLabel: "filesystem",
    branchName: "no git",
    files,
    refreshedAt: Date.now(),
  };
}

async function listFilesystemFiles(cwd: string): Promise<string[]> {
  const root = resolve(cwd);
  const files: string[] = [];
  await walkFilesystemFiles(root, root, files);
  return files.sort((a, b) => a.localeCompare(b));
}

async function readFilesystemDiffs(cwd: string): Promise<DiffFile[]> {
  const filePaths = await listFilesystemFiles(cwd);
  const files: DiffFile[] = [];
  for (const filePath of filePaths) {
    const diff = await readAddedFileDiff(cwd, filePath);
    if (diff) {
      files.push(diff);
    }
  }
  return files;
}

async function walkFilesystemFiles(root: string, directory: string, files: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkFilesystemFiles(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    files.push(relative(root, absolute).replace(/\\/g, "/"));
  }
}

async function readAddedFileDiff(cwd: string, filePath: string): Promise<DiffFile | null> {
  const absolute = join(cwd, filePath);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    return null;
  }
  const stat = await file.stat();
  if (!stat.isFile() || stat.size > MAX_SYNTHETIC_DIFF_FILE_SIZE) {
    return null;
  }

  const text = await file.text();
  const contentLines = splitFileLines(text);
  const hunkHeader = `@@ -0,0 +1,${contentLines.length} @@`;
  const lines: DiffLineRef[] = [
    {
      id: `${filePath}:0`,
      filePath,
      kind: "hunk",
      oldLine: null,
      newLine: null,
      hunkHeader,
      text: hunkHeader,
      raw: hunkHeader,
    },
  ];

  contentLines.forEach((line, index) => {
    lines.push({
      id: `${filePath}:${index + 1}`,
      filePath,
      kind: "add",
      oldLine: null,
      newLine: index + 1,
      hunkHeader,
      text: line,
      raw: `+${line}`,
    });
  });

  return {
    filePath,
    additions: contentLines.length,
    removals: 0,
    lines,
    rawDiff: [`diff --git a/${filePath} b/${filePath}`, "new file mode 100644", "--- /dev/null", `+++ b/${filePath}`, hunkHeader, ...contentLines.map((line) => `+${line}`)].join("\n"),
  };
}

function splitFileLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split(/\r?\n/);
}

export function hunkForLine(file: DiffFile, selected: DiffLineRef, radius = 4): string {
  const index = file.lines.findIndex((line) => line.id === selected.id);
  if (index < 0) {
    return selected.raw;
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(file.lines.length, index + radius + 1);
  let hunkStart = -1;
  if (selected.hunkHeader) {
    for (let i = index; i >= 0; i -= 1) {
      if (file.lines[i]?.kind === "hunk") {
        hunkStart = i;
        break;
      }
    }
  }
  const sliceStart = hunkStart >= 0 ? Math.max(hunkStart, start) : start;
  return file.lines.slice(sliceStart, end).map((line) => line.raw).join("\n");
}

function parseDiffGitPath(raw: string): string {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
  return match?.[2] ?? raw.replace(/^diff --git /, "");
}

async function readUntrackedDiffs(cwd: string): Promise<DiffFile[]> {
  const status = await runReadOnlyGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = status.split("\0").filter(Boolean);
  const files: DiffFile[] = [];

  for (const entry of entries) {
    if (!entry.startsWith("?? ")) {
      continue;
    }
    const filePath = entry.slice(3);
    const diff = await readAddedFileDiff(cwd, filePath);
    if (diff) {
      files.push(diff);
    }
  }

  return files;
}
