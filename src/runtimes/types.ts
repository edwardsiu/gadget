import type { AgentAdapter } from "../types";

export type GadgetClient = "codex";

export type RuntimeSession = {
  client: GadgetClient;
  cwd: string;
  repositoryRoot: string;
  worktreePath: string;
  worktreeName: string;
  label: string;
  status: string;
  preview: string;
  updatedAt: string;
  session: unknown;
};

export type RuntimeAdapterFactory = (session: RuntimeSession) => AgentAdapter;
