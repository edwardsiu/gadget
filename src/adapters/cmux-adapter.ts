import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentAdapter, AgentComment, AgentSessionInfo } from "../types";
import { formatCommentPrompt } from "../comments";

export type GadgetCmuxSession = {
  token: string;
  cwd: string;
  workspace: string;
  surface: string;
  name: string;
  command: string;
  createdAt: string;
  updatedAt: string;
};

type GadgetCmuxSessionRegistry = {
  projects: Record<string, GadgetCmuxSession[]>;
};

export class CmuxAdapter implements AgentAdapter {
  label = "cmux";
  private status: string;

  constructor(private readonly session: GadgetCmuxSession) {
    this.status = `cmux ${session.name}`;
  }

  async sendComment(comment: AgentComment): Promise<void> {
    await this.sendPrompt(formatCommentPrompt(comment));
  }

  async sendPrompt(prompt: string): Promise<void> {
    await runCmux(["send", "--workspace", this.session.workspace, "--surface", this.session.surface, prompt]);
    await runCmux(["send-key", "--workspace", this.session.workspace, "--surface", this.session.surface, "Enter"]);
    this.status = `sent to ${this.session.name}`;
  }

  getSessionInfo(): AgentSessionInfo {
    return {
      mode: "Claude via cmux",
      sessionId: this.session.surface,
      details: [
        { label: "workspace", value: this.session.workspace },
        { label: "surface", value: this.session.surface },
      ],
    };
  }

  getStatus(): string {
    return this.status;
  }
}

export async function startClaudeCmuxSession(cwd: string, claudeArgs: string[] = []): Promise<void> {
  if (!cmuxEnabled()) {
    await runClaudeDirect(cwd, claudeArgs);
    return;
  }

  const token = `cmux_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const claudeCommand = ["claude", ...claudeArgs].map(shellQuote).join(" ");
  const command = `${claudeCommand}; status=$?; gadget cmux-untrack ${shellQuote(token)}; exit $status`;
  const name = "gadget claude";
  const output = await runCmux(["new-workspace", "--name", name, "--cwd", cwd, "--command", command]);
  const workspace = parseRef(output, "workspace") ?? output.trim().split(/\s+/).find((part) => part.startsWith("workspace:"));
  if (!workspace) {
    throw new Error(`cmux did not return a workspace ref: ${output.trim()}`);
  }

  const surfacesOutput = await runCmux(["list-pane-surfaces", "--workspace", workspace]);
  const surface = parseRef(surfacesOutput, "surface");
  if (!surface) {
    await removeCmuxSession(cwd, { workspace });
    throw new Error(`cmux did not return a surface ref for ${workspace}`);
  }

  const now = new Date().toISOString();
  const session: GadgetCmuxSession = {
    token,
    cwd,
    workspace,
    surface,
    name,
    command,
    createdAt: now,
    updatedAt: now,
  };

  await upsertCmuxSession(cwd, session);
  console.log(`Started Claude in cmux ${workspace} ${surface}`);
}

export async function untrackCmuxSession(token: string): Promise<boolean> {
  const registry = await readCmuxSessionRegistry();
  let removed = false;
  const nextProjects: Record<string, GadgetCmuxSession[]> = {};
  for (const [cwd, sessions] of Object.entries(registry.projects)) {
    const remaining = sessions.filter((session) => {
      const keep = session.token !== token;
      removed ||= !keep;
      return keep;
    });
    if (remaining.length > 0) {
      nextProjects[cwd] = remaining;
    }
  }
  if (removed) {
    await writeCmuxSessionRegistry({ projects: nextProjects });
  }
  return removed;
}

export async function listLiveCmuxSessions(cwd: string): Promise<GadgetCmuxSession[]> {
  const sessions = await readCmuxSessions(cwd);
  const live: GadgetCmuxSession[] = [];
  for (const session of sessions) {
    try {
      await runCmux(["read-screen", "--workspace", session.workspace, "--surface", session.surface, "--lines", "1"]);
      live.push(session);
    } catch {
      await removeCmuxSession(cwd, session);
    }
  }
  return live;
}

export function cmuxEnabled(): boolean {
  return process.env.GADGET_CMUX === "1" || process.env.GADGET_CMUX === "true";
}

async function runClaudeDirect(cwd: string, claudeArgs: string[]): Promise<void> {
  await waitForChild("claude", claudeArgs, { cwd, stdio: "inherit" });
}

async function waitForChild(command: string, args: string[], options: { cwd: string; stdio: "inherit" | "ignore" }): Promise<void> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: options.stdio,
    env: process.env,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function runCmux(args: string[]): Promise<string> {
  const child = spawn("cmux", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `cmux exited with code ${code}`));
    });
  });
  return Buffer.concat(stdout).toString("utf8");
}

async function readCmuxSessions(cwd: string): Promise<GadgetCmuxSession[]> {
  const registry = await readCmuxSessionRegistry();
  return (registry.projects[cwd] ?? []).filter(isGadgetCmuxSession);
}

async function upsertCmuxSession(cwd: string, session: GadgetCmuxSession): Promise<void> {
  const sessions = (await readCmuxSessions(cwd)).filter((existing) => existing.surface !== session.surface);
  sessions.push(session);
  await writeCmuxSessions(cwd, sessions);
}

async function removeCmuxSession(cwd: string, session: Partial<GadgetCmuxSession>): Promise<void> {
  const sessions = (await readCmuxSessions(cwd)).filter((existing) => {
    if (session.surface && existing.surface === session.surface) {
      return false;
    }
    if (session.workspace && existing.workspace === session.workspace) {
      return false;
    }
    return true;
  });
  await writeCmuxSessions(cwd, sessions);
}

async function writeCmuxSessions(cwd: string, sessions: GadgetCmuxSession[]): Promise<void> {
  const registry = await readCmuxSessionRegistry();
  if (sessions.length === 0) {
    delete registry.projects[cwd];
  } else {
    registry.projects[cwd] = sessions;
  }
  await writeCmuxSessionRegistry(registry);
}

async function readCmuxSessionRegistry(): Promise<GadgetCmuxSessionRegistry> {
  try {
    const value = JSON.parse(await readFile(cmuxSessionRegistryPath(), "utf8"));
    if (!isGadgetCmuxSessionRegistry(value)) {
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

async function writeCmuxSessionRegistry(registry: GadgetCmuxSessionRegistry): Promise<void> {
  const filePath = cmuxSessionRegistryPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`);
}

function cmuxSessionRegistryPath(): string {
  return join(homedir(), ".gadget", "cmux-sessions.json");
}

function parseRef(output: string, kind: "workspace" | "surface"): string | null {
  return output.match(new RegExp(`\\b${kind}:\\d+\\b`))?.[0] ?? null;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=@%+.,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isGadgetCmuxSessionRegistry(value: unknown): value is GadgetCmuxSessionRegistry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const projects = (value as Record<string, unknown>).projects;
  return Boolean(projects && typeof projects === "object" && !Array.isArray(projects));
}

function isGadgetCmuxSession(value: unknown): value is GadgetCmuxSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
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
