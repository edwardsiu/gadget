#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { ClipboardAdapter } from "./adapters/clipboard-adapter";
import { cleanupGadgetResources, type GadgetCleanupResult } from "./adapters/codex-app-server-adapter";
import { assertGitRepo, createGadgetWorktree, resolveWorktreeTarget, type WorktreeInfo } from "./git";
import { createCodexRuntimeAdapter, listCodexRuntimeSessions, startCodexRuntime } from "./runtimes/codex";
import type { RuntimeSession } from "./runtimes/types";
import { runGadgetUi } from "./tui";

type CommandTarget = {
  worktree: WorktreeInfo;
  selectedWorktreeName: string | undefined;
};
type DiffMode = "auto" | "clipboard";
type DiffRunTarget =
  | { kind: "clipboard"; cwd: string; worktree: WorktreeInfo }
  | { kind: "session"; cwd: string; session: RuntimeSession; worktree?: WorktreeInfo };

const program = new Command();

program
  .name("gadget")
  .description("Terminal reviewer for coding-agent sessions.")
  .enablePositionalOptions()
  .showHelpAfterError()
  .allowExcessArguments(false)
  .option("--worktree <name-or-path>", "open the diff viewer for a specific git worktree")
  .action(async (options) => {
    await openDiffViewer({ mode: "auto", worktree: options.worktree });
  });

program
  .command("worktree")
  .description("create a Gadget git worktree")
  .allowExcessArguments(false)
  .option("--worktree-name <name>", "name the generated worktree")
  .option("--start", "start Codex in the generated worktree")
  .option("--model <model>", "model to pass to Codex when using --start")
  .option("--resume <session-id>", "resume an existing Codex session id when using --start")
  .action(async (options) => {
    await worktreeCommand({
      worktreeName: options.worktreeName,
      start: Boolean(options.start),
      model: options.model,
      resumeSessionId: options.resume,
    });
  });

program
  .command("codex")
  .description("start Codex with Gadget app-server integration")
  .allowExcessArguments(false)
  .option("--worktree <name-or-path>", "start Codex in an existing git worktree")
  .option("--model <model>", "model to pass to Codex")
  .option("--resume <session-id>", "resume an existing Codex session id")
  .action(async (options) => {
    await startCommand({
      worktree: options.worktree,
      model: options.model,
      resumeSessionId: options.resume,
    });
  });

program
  .command("view")
  .description("open the diff viewer in clipboard mode")
  .allowExcessArguments(false)
  .option("--worktree <name-or-path>", "open the diff viewer for a specific git worktree")
  .action(async (options) => {
    await openDiffViewer({ mode: "clipboard", worktree: options.worktree });
  });

program
  .command("cleanup")
  .description("kill stale app-servers and remove inactive Gadget worktrees")
  .allowExcessArguments(false)
  .action(async () => {
    const result = await cleanupGadgetResources({ cwd: process.cwd() });
    printCleanupResult(result);
    process.exit(result.errors.length > 0 ? 1 : 0);
  });

program
  .command("claude", { hidden: true })
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(() => {
    throw new InvalidArgumentError("Gadget does not connect to Claude directly. Use `gadget view` for clipboard mode.");
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function startCommand(options: { worktree: string | undefined; model: string | undefined; resumeSessionId: string | undefined }): Promise<void> {
  const target = await resolveCommandTargetOrExit(options.worktree);
  await ensureGitRepo(target.worktree.cwd);
  await startRuntimeOrExit(target.worktree.cwd, startOptions(options.model, options.resumeSessionId));
}

async function worktreeCommand(options: { worktreeName: string | undefined; start: boolean; model: string | undefined; resumeSessionId: string | undefined }): Promise<void> {
  await ensureGitRepo(process.cwd());
  const source = await resolveWorktreeTarget(process.cwd());
  const worktree = await createGadgetWorktree(source.cwd, options.worktreeName);
  console.log(`Worktree: ${worktree.worktreeName}`);
  console.log(`Path: ${worktree.worktreePath}`);

  if (!options.start) {
    return;
  }

  await startRuntimeOrExit(worktree.cwd, {
    ...startOptions(options.model, options.resumeSessionId),
    sourceCwd: source.cwd,
  });
}

async function openDiffViewer(options: { mode: DiffMode; worktree: string | undefined }): Promise<void> {
  const target = await resolveCommandTargetOrExit(options.worktree);
  await ensureGitRepo(target.worktree.cwd);
  const runTarget = await resolveDiffRunTarget(target, options.mode);

  if (runTarget.kind === "clipboard") {
    await runGadgetUi({ cwd: runTarget.cwd, adapter: new ClipboardAdapter(), worktree: runTarget.worktree });
    return;
  }

  await runGadgetUi({
    cwd: runTarget.cwd,
    adapter: createAdapterForSession(runTarget.session),
    ...(runTarget.worktree ? { worktree: runTarget.worktree } : {}),
  });
}

async function startRuntimeOrExit(cwd: string, options: { model?: string; resumeSessionId?: string; sourceCwd?: string }): Promise<void> {
  try {
    await startCodexRuntime(cwd, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function resolveDiffRunTarget(target: CommandTarget, mode: DiffMode): Promise<DiffRunTarget> {
  if (mode === "clipboard") {
    return { kind: "clipboard", cwd: target.worktree.cwd, worktree: target.worktree };
  }

  const session = await selectRuntimeSession(target.worktree, target.selectedWorktreeName);
  if (!session) {
    return { kind: "clipboard", cwd: target.worktree.cwd, worktree: target.worktree };
  }

  return {
    kind: "session",
    cwd: session.cwd,
    session,
    ...(session.cwd === target.worktree.cwd ? { worktree: target.worktree } : {}),
  };
}

async function selectRuntimeSession(target: WorktreeInfo, worktreeName: string | undefined): Promise<RuntimeSession | null> {
  const sessions = await listRuntimeSessions(target, worktreeName);

  if (sessions.length === 0) {
    return null;
  }
  if (sessions.length === 1) {
    return sessions[0]!;
  }

  console.log("Multiple Gadget sessions are active:");
  console.log(`Project: ${target.repositoryRoot}`);
  sessions.forEach((session, index) => {
    const preview = session.preview.trim() || "(no preview yet)";
    console.log(`${index + 1}. ${session.client.padEnd(6)} ${session.worktreeName.padEnd(14)} ${session.status.padEnd(14)} ${session.cwd} ${preview.slice(0, 80)}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await rl.question(`Select session [1-${sessions.length}]: `)).trim();
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= sessions.length) {
        return sessions[index - 1]!;
      }
    }
  } finally {
    rl.close();
  }
}

async function listRuntimeSessions(target: WorktreeInfo, worktreeName: string | undefined): Promise<RuntimeSession[]> {
  return await listCodexRuntimeSessions(target, worktreeName);
}

function createAdapterForSession(session: RuntimeSession) {
  return createCodexRuntimeAdapter(session);
}

async function ensureGitRepo(cwd: string): Promise<void> {
  try {
    await assertGitRepo(cwd);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Gadget needs a git repository: ${cwd}`);
    if (detail) {
      console.error(detail);
    }
    process.exit(1);
  }
}

async function resolveCommandTargetOrExit(worktreeNameOrPath: string | undefined): Promise<CommandTarget> {
  try {
    const worktree = await resolveWorktreeTarget(process.cwd(), worktreeNameOrPath);
    return {
      worktree,
      selectedWorktreeName: worktreeNameOrPath ?? (!worktree.isPrimary ? worktree.worktreeName : undefined),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Gadget needs a git repository or a known git worktree.");
    if (detail) {
      console.error(detail);
    }
    process.exit(1);
  }
}

function modelOptions(model: string | undefined): { model?: string } {
  return model === undefined ? {} : { model };
}

function startOptions(model: string | undefined, resumeSessionId: string | undefined): { model?: string; resumeSessionId?: string } {
  return {
    ...modelOptions(model),
    ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
  };
}

function printCleanupResult(result: GadgetCleanupResult): void {
  console.log("Gadget cleanup");
  console.log(`Killed app-servers: ${result.killedAppServers.length}`);
  for (const processInfo of result.killedAppServers) {
    console.log(`  ${processInfo.pid} ${processInfo.remoteUrl ?? processInfo.command}`);
  }

  console.log(`Removed session records: ${result.removedSessions.length}`);
  for (const session of result.removedSessions) {
    console.log(`  ${session.remoteUrl} ${session.worktreeName ?? session.cwd}`);
  }

  console.log(`Removed worktrees: ${result.removedWorktrees.length}`);
  for (const worktree of result.removedWorktrees) {
    console.log(`  ${worktree.path}${worktree.branchName ? ` (${worktree.branchName})` : ""}`);
  }

  console.log(`Skipped worktrees: ${result.skippedWorktrees.length}`);
  for (const worktree of result.skippedWorktrees) {
    console.log(`  ${worktree.path}: ${firstLine(worktree.reason)}`);
  }

  console.log(`Active sessions kept: ${result.activeSessions.length}`);
  if (result.errors.length > 0) {
    console.error("Errors:");
    for (const error of result.errors) {
      console.error(`  ${error}`);
    }
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? value;
}
