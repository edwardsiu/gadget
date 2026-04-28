import { spawn } from "node:child_process";
import type { AgentAdapter, AgentComment, AgentSessionInfo } from "../types";
import { formatCommentPrompt } from "../comments";
import { readGadgetConfig } from "../config";
import { isGadgetCmuxSessionRecord, readSessionRegistry, writeSessionRegistry, type GadgetCmuxSessionRecord } from "../session-registry";

export type GadgetCmuxSession = GadgetCmuxSessionRecord;

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
    const bufferName = `gadget-${this.session.token}`;
    await runCmux(["set-buffer", "--name", bufferName, prompt]);
    await runCmux(["paste-buffer", "--name", bufferName, "--workspace", this.session.workspace, "--surface", this.session.surface]);
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
  if (!(await cmuxEnabled())) {
    await runClaudeDirect(cwd, claudeArgs);
    return;
  }

  const token = `cmux_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workspace = process.env.CMUX_WORKSPACE_ID;
  const surface = process.env.CMUX_SURFACE_ID;
  if (!workspace || !surface) {
    throw new Error("cmux integration requires running `gadget claude` inside a cmux terminal pane");
  }
  const name = "gadget claude";

  const now = new Date().toISOString();
  const session: GadgetCmuxSession = {
    client: "claude",
    transport: "cmux",
    token,
    cwd,
    workspace,
    surface,
    name,
    command: ["claude", ...claudeArgs].map(shellQuote).join(" "),
    createdAt: now,
    updatedAt: now,
  };

  await upsertCmuxSession(cwd, session);
  try {
    await runClaudeDirect(cwd, claudeArgs);
  } finally {
    await removeCmuxSession(cwd, session);
  }
}

export async function untrackCmuxSession(token: string): Promise<boolean> {
  const registry = await readSessionRegistry();
  let removed = false;
  const nextProjects = { ...registry.projects };
  for (const [cwd, sessions] of Object.entries(registry.projects)) {
    const remaining = sessions.filter((session) => {
      const keep = !isGadgetCmuxSessionRecord(session) || session.token !== token;
      removed ||= !keep;
      return keep;
    });
    if (remaining.length > 0) {
      nextProjects[cwd] = remaining;
    } else {
      delete nextProjects[cwd];
    }
  }
  if (removed) {
    await writeSessionRegistry({ projects: nextProjects });
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

export async function cmuxEnabled(): Promise<boolean> {
  return (await readGadgetConfig()).integrations.cmux;
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
  const registry = await readSessionRegistry();
  return (registry.projects[cwd] ?? []).filter(isGadgetCmuxSessionRecord);
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
  const registry = await readSessionRegistry();
  const otherSessions = (registry.projects[cwd] ?? []).filter((session) => !isGadgetCmuxSessionRecord(session));
  if (sessions.length === 0) {
    if (otherSessions.length === 0) {
      delete registry.projects[cwd];
    } else {
      registry.projects[cwd] = otherSessions;
    }
  } else {
    registry.projects[cwd] = [...otherSessions, ...sessions];
  }
  await writeSessionRegistry(registry);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=@%+.,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
