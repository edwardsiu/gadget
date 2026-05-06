#!/usr/bin/env bun
import { resolve } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { ClipboardAdapter } from "./adapters/clipboard-adapter";
import { untrackCmuxSession } from "./adapters/cmux-adapter";
import { cleanupGadgetResources, type GadgetCleanupResult } from "./adapters/codex-app-server-adapter";
import { assertGitRepo, readGitInfo, type GitInfo } from "./git";
import { createClaudeRuntimeAdapter, listClaudeRuntimeSessions, startClaudeRuntime } from "./runtimes/claude";
import { createCodexRuntimeAdapter, listCodexRuntimeSessions, startCodexRuntime } from "./runtimes/codex";
import { createPiRuntimeAdapter, listPiRuntimeSessions, startPiRuntime } from "./runtimes/pi";
import type { RuntimeSession } from "./runtimes/types";
import { runGadgetUi, type InitialFileTarget } from "./tui";

type DiffMode = "auto" | "clipboard";
type DiffRunTarget =
  | { kind: "clipboard"; cwd: string; gitInfo: GitInfo }
  | { kind: "session"; cwd: string; session: RuntimeSession; gitInfo?: GitInfo }
  | { kind: "session-choice"; cwd: string; sessions: RuntimeSession[]; gitInfo: GitInfo };

const program = new Command();

program
  .name("gadget")
  .description("Terminal reviewer for coding-agent sessions.")
  .enablePositionalOptions()
  .showHelpAfterError()
  .allowExcessArguments(false)
  .argument("[file]", "open a file in full-file view, optionally with :line")
  .action(async (file) => {
    const initialFile = parseInitialFileTarget(file);
    await openDiffViewer({
      mode: "auto",
      ...(initialFile ? { initialFile } : {}),
    });
  });

program
  .command("codex")
  .description("start Codex with Gadget app-server integration")
  .allowExcessArguments(false)
  .option("--model <model>", "model to pass to Codex")
  .option("--resume <session-id>", "resume an existing Codex session id")
  .action(async (options) => {
    await startCommand({
      model: options.model,
      resumeSessionId: options.resume,
    });
  });

program
  .command("view")
  .description("open the diff viewer in clipboard mode")
  .allowExcessArguments(false)
  .action(async () => {
    await openDiffViewer({ mode: "clipboard" });
  });

program
  .command("cleanup")
  .description("kill stale app-servers and remove inactive session records")
  .allowExcessArguments(false)
  .action(async () => {
    const result = await cleanupGadgetResources({ cwd: process.cwd() });
    printCleanupResult(result);
    process.exit(result.errors.length > 0 ? 1 : 0);
  });

program
  .command("cmux-untrack", { hidden: true })
  .argument("<token>")
  .allowExcessArguments(false)
  .action(async (token) => {
    await untrackCmuxSession(token);
  });

program
  .command("claude")
  .description("start Claude, optionally with Gadget cmux integration")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .argument("[claudeArgs...]", "arguments to pass to Claude")
  .action(async (claudeArgs) => {
    await startClaudeCommand(claudeArgs);
  });

program
  .command("pi")
  .description("start Pi with Gadget bridge integration")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .argument("[piArgs...]", "arguments to pass to Pi")
  .action(async (piArgs) => {
    await startPiCommand(piArgs);
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function startCommand(options: { model: string | undefined; resumeSessionId: string | undefined }): Promise<void> {
  const cwd = process.cwd();
  await ensureGitRepo(cwd);
  await startRuntimeOrExit(cwd, startOptions(options.model, options.resumeSessionId));
}

async function startClaudeCommand(claudeArgs: string[]): Promise<void> {
  const cwd = process.cwd();
  await ensureGitRepo(cwd);
  try {
    await startClaudeRuntime(cwd, claudeArgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function startPiCommand(piArgs: string[]): Promise<void> {
  const cwd = process.cwd();
  await ensureGitRepo(cwd);
  try {
    await startPiRuntime(cwd, piArgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function openDiffViewer(options: { mode: DiffMode; initialFile?: InitialFileTarget }): Promise<void> {
  const cwd = process.cwd();
  await ensureGitRepo(cwd);
  const gitInfo = await readGitInfoOrExit(cwd);
  const runTarget = await resolveDiffRunTarget(cwd, gitInfo, options.mode);

  if (runTarget.kind === "clipboard") {
    await runGadgetUi({
      cwd: runTarget.cwd,
      adapter: new ClipboardAdapter(),
      gitInfo: runTarget.gitInfo,
      ...(options.initialFile ? { initialFile: options.initialFile } : {}),
    });
    return;
  }

  await runGadgetUi({
    cwd: runTarget.cwd,
    adapter: runTarget.kind === "session" ? createAdapterForSession(runTarget.session) : new ClipboardAdapter(),
    ...(runTarget.gitInfo ? { gitInfo: runTarget.gitInfo } : {}),
    ...(runTarget.kind === "session-choice"
      ? {
        sessionChoices: runTarget.sessions,
        createAdapterForSession,
      }
      : {}),
    ...(options.initialFile ? { initialFile: options.initialFile } : {}),
  });
}

async function startRuntimeOrExit(cwd: string, options: { model?: string; resumeSessionId?: string }): Promise<void> {
  try {
    await startCodexRuntime(cwd, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function resolveDiffRunTarget(cwd: string, gitInfo: GitInfo, mode: DiffMode): Promise<DiffRunTarget> {
  if (mode === "clipboard") {
    return { kind: "clipboard", cwd, gitInfo };
  }

  const sessions = await listRuntimeSessions(cwd);
  if (sessions.length === 0) {
    return { kind: "clipboard", cwd, gitInfo };
  }
  if (sessions.length > 1) {
    return { kind: "session-choice", cwd, sessions, gitInfo };
  }

  const session = sessions[0]!;
  return {
    kind: "session",
    cwd: session.cwd,
    session,
    ...(session.cwd === gitInfo.cwd ? { gitInfo } : {}),
  };
}

async function listRuntimeSessions(cwd: string): Promise<RuntimeSession[]> {
  return [
    ...(await listCodexRuntimeSessions(cwd)),
    ...(await listClaudeRuntimeSessions(cwd)),
    ...(await listPiRuntimeSessions(cwd)),
  ];
}

function createAdapterForSession(session: RuntimeSession) {
  if (session.client === "claude") {
    return createClaudeRuntimeAdapter(session);
  }
  if (session.client === "pi") {
    return createPiRuntimeAdapter(session);
  }
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

async function readGitInfoOrExit(cwd: string): Promise<GitInfo> {
  try {
    return await readGitInfo(cwd);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Gadget needs a git repository.");
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

function parseInitialFileTarget(value: string | undefined): InitialFileTarget | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(.*):([1-9]\d*)$/.exec(value);
  if (!match) {
    return { filePath: resolve(process.cwd(), value) };
  }

  const filePath = match[1]!;
  return {
    filePath: resolve(process.cwd(), filePath),
    lineNumber: Number(match[2]),
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
    console.log(`  ${formatCleanupSession(session)}`);
  }

  console.log(`Active sessions kept: ${result.activeSessions.length}`);
  if (result.errors.length > 0) {
    console.error("Errors:");
    for (const error of result.errors) {
      console.error(`  ${error}`);
    }
  }
}

function formatCleanupSession(session: GadgetCleanupResult["removedSessions"][number]): string {
  if ("remoteUrl" in session) {
    return `${session.remoteUrl} ${session.cwd}`;
  }
  if (session.client === "pi") {
    return `${session.client}:${session.transport} ${session.pid} ${session.url} ${session.cwd}`;
  }
  return `${session.client}:${session.transport} ${session.workspace} ${session.surface} ${session.cwd}`;
}
