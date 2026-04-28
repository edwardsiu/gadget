import { CmuxAdapter, listLiveCmuxSessions, startClaudeCmuxSession, type GadgetCmuxSession } from "../adapters/cmux-adapter";
import type { RuntimeSession } from "./types";

export async function startClaudeRuntime(cwd: string, args: string[] = []): Promise<void> {
  await startClaudeCmuxSession(cwd, args);
}

export async function listClaudeRuntimeSessions(cwd: string): Promise<RuntimeSession[]> {
  const sessions = await listLiveCmuxSessions(cwd);
  return sessions.map((session) => ({
    client: "claude",
    cwd: session.cwd,
    label: "claude",
    status: "cmux connected",
    preview: session.name,
    updatedAt: session.updatedAt,
    session,
  }));
}

export function createClaudeRuntimeAdapter(session: RuntimeSession): CmuxAdapter {
  return new CmuxAdapter(session.session as GadgetCmuxSession);
}
