import { CodexAppServerAdapter, listLiveCodexSessions, startCodexSession, type GadgetCodexSession } from "../adapters/codex-app-server-adapter";
import type { RuntimeSession } from "./types";

export async function startCodexRuntime(cwd: string, options: { model?: string; resumeSessionId?: string } = {}): Promise<void> {
  await startCodexSession(cwd, options);
}

export async function listCodexRuntimeSessions(cwd: string): Promise<RuntimeSession[]> {
  const sessions = await listLiveCodexSessions(cwd);
  return sessions.map((session) => ({
    client: "codex",
    cwd: session.cwd,
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
