import { CodexAppServerAdapter, listLiveCodexSessions, startCodexSession, type GadgetCodexSession } from "../adapters/codex-app-server-adapter";
import type { WorktreeInfo } from "../git";
import type { RuntimeSession } from "./types";

export async function startCodexRuntime(cwd: string, options: { model?: string; resumeSessionId?: string; sourceCwd?: string } = {}): Promise<void> {
  await startCodexSession(cwd, options);
}

export async function listCodexRuntimeSessions(target: WorktreeInfo, worktreeName?: string): Promise<RuntimeSession[]> {
  const sessions = await listLiveCodexSessions(target.cwd, worktreeName);
  return sessions.map((session) => ({
    client: "codex",
    cwd: session.cwd,
    repositoryRoot: session.repositoryRoot ?? target.repositoryRoot,
    worktreePath: session.worktreePath ?? session.cwd,
    worktreeName: session.worktreeName ?? target.worktreeName,
    label: "codex",
    status: session.status,
    preview: session.preview,
    updatedAt: session.updatedAt,
    session,
  }));
}

export function createCodexRuntimeAdapter(session: RuntimeSession): CodexAppServerAdapter {
  return new CodexAppServerAdapter((session.session as GadgetCodexSession).cwd, { session: session.session as GadgetCodexSession });
}
