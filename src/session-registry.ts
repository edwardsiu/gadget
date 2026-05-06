import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type GadgetCodexSessionRecord = {
  client?: "codex";
  cwd: string;
  remoteUrl: string;
  threadId: string | null;
  appServerPid: number | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GadgetCmuxSessionRecord = {
  client: "claude";
  transport: "cmux";
  token: string;
  cwd: string;
  workspace: string;
  surface: string;
  name: string;
  command: string;
  createdAt: string;
  updatedAt: string;
};

export type GadgetPiSessionRecord = {
  client: "pi";
  transport: "http";
  token: string;
  cwd: string;
  pid: number;
  url: string;
  sessionId: string | null;
  sessionFile: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type GadgetSessionRecord = GadgetCodexSessionRecord | GadgetCmuxSessionRecord | GadgetPiSessionRecord;

export type GadgetSessionRegistry = {
  projects: Record<string, GadgetSessionRecord[]>;
};

export async function readSessionRegistry(): Promise<GadgetSessionRegistry> {
  try {
    const value = JSON.parse(await readFile(sessionRegistryPath(), "utf8"));
    if (!isGadgetSessionRegistry(value)) {
      return { projects: {} };
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { projects: {} };
    }
    throw error;
  }
}

export async function writeSessionRegistry(registry: GadgetSessionRegistry): Promise<void> {
  const filePath = sessionRegistryPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`);
}

export function sessionRegistryPath(): string {
  return join(homedir(), ".gadget", "sessions.json");
}

export function isGadgetCodexSessionRecord(value: unknown): value is GadgetCodexSessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.client === undefined || candidate.client === "codex") &&
    typeof candidate.cwd === "string" &&
    typeof candidate.remoteUrl === "string" &&
    (typeof candidate.threadId === "string" || candidate.threadId === null) &&
    (typeof candidate.appServerPid === "number" || candidate.appServerPid === null) &&
    (typeof candidate.model === "string" || candidate.model === null) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function isGadgetCmuxSessionRecord(value: unknown): value is GadgetCmuxSessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.client === "claude" &&
    candidate.transport === "cmux" &&
    typeof candidate.token === "string" &&
    typeof candidate.cwd === "string" &&
    typeof candidate.workspace === "string" &&
    typeof candidate.surface === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.command === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function isGadgetPiSessionRecord(value: unknown): value is GadgetPiSessionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.client === "pi" &&
    candidate.transport === "http" &&
    typeof candidate.token === "string" &&
    typeof candidate.cwd === "string" &&
    typeof candidate.pid === "number" &&
    typeof candidate.url === "string" &&
    (typeof candidate.sessionId === "string" || candidate.sessionId === null) &&
    (typeof candidate.sessionFile === "string" || candidate.sessionFile === null) &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isGadgetSessionRegistry(value: unknown): value is GadgetSessionRegistry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const projects = (value as Record<string, unknown>).projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    return false;
  }
  return Object.values(projects).every((projectSessions) => Array.isArray(projectSessions));
}
