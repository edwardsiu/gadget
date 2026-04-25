import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { AgentAdapter, AgentComment, AgentSessionInfo } from "../types";
import { formatCommentPrompt } from "../comments";
import { listWorktrees, readWorktreeInfo, runGit, type ListedWorktree } from "../git";

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ServerNotificationMessage = {
  method: string;
  params?: any;
};

export type GadgetCodexSession = {
  cwd: string;
  remoteUrl: string;
  threadId: string | null;
  appServerPid: number | null;
  model: string | null;
  sourceCwd?: string;
  repositoryRoot?: string;
  worktreePath?: string;
  worktreeName?: string;
  createdAt: string;
  updatedAt: string;
};

export type GadgetWorktreeRecord = {
  sourceCwd: string;
  repositoryRoot: string;
  worktreePath: string;
  worktreeName: string;
  branchName: string;
  createdAt: string;
  updatedAt: string;
};

type GadgetSessionRegistry = {
  projects: Record<string, GadgetCodexSession[]>;
  worktrees?: Record<string, GadgetWorktreeRecord[]>;
};

export type LiveGadgetCodexSession = GadgetCodexSession & {
  preview: string;
  status: string;
};

type StartCodexSessionOptions = {
  model?: string;
  resumeSessionId?: string;
  codexPath?: string;
  launchCli?: boolean;
  sourceCwd?: string;
};

type CodexAppServerOptions = {
  session: GadgetCodexSession;
};

export type GadgetCleanupResult = {
  killedAppServers: ProcessInfo[];
  removedSessions: GadgetCodexSession[];
  removedWorktrees: Array<{ repositoryRoot: string; path: string; branchName: string | null }>;
  skippedWorktrees: Array<{ repositoryRoot: string; path: string; reason: string }>;
  activeSessions: GadgetCodexSession[];
  errors: string[];
};

type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
  remoteUrl?: string;
};

const APP_SERVER_SHUTDOWN_GRACE_MS = 2_000;
const APP_SERVER_OUTPUT_MAX_BYTES = 20_000;

type ChildExitStatus = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

type AppServerRuntime = {
  child: ChildProcess;
  exited: Promise<ChildExitStatus>;
  recentOutput: () => string;
};

export class CodexAppServerAdapter implements AgentAdapter {
  label = "codex app-server";
  private client: CodexAppServerClient | null = null;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private status = "codex disconnected";

  constructor(
    private readonly cwd: string,
    private readonly options: CodexAppServerOptions,
  ) {}

  async connect(): Promise<void> {
    if (this.client && this.threadId) {
      return;
    }

    this.client = await CodexAppServerClient.connect(this.options.session.remoteUrl, (message) => this.handleNotification(message));
    this.threadId = this.options.session.threadId;
    const thread = await this.readThreadAllowingEmptyTurns();
    this.syncThread(thread);
    this.status = `codex ${threadStatusType(thread)} ${this.threadId}`;
  }

  async disconnect(): Promise<void> {
    this.client?.disconnect();
    this.client = null;
    this.threadId = null;
    this.activeTurnId = null;
    this.status = "codex disconnected";
  }

  async sendComment(comment: AgentComment): Promise<void> {
    await this.sendPrompt(formatCommentPrompt(comment));
  }

  async sendPrompt(prompt: string): Promise<void> {
    await this.connect();
    if (!this.client || !this.threadId) {
      throw new Error("Codex thread is not ready");
    }

    const input = [{ type: "text", text: prompt, text_elements: [] }];
    await this.refreshActiveTurnState();
    if (this.activeTurnId) {
      await this.client.request("turn/steer", {
        threadId: this.threadId,
        input,
        expectedTurnId: this.activeTurnId,
      });
      this.status = `steered ${this.activeTurnId}`;
      return;
    }

    const response = await this.client.request("turn/start", {
      threadId: this.threadId,
      input,
      cwd: this.cwd,
    });
    this.activeTurnId = response.turn.status === "inProgress" ? response.turn.id : null;
    this.status = this.activeTurnId ? `turn started ${this.activeTurnId}` : `turn ${response.turn.status}`;
  }

  async getScratchpadText(): Promise<string | null> {
    await this.connect();
    if (!this.client || !this.threadId) {
      return null;
    }

    const thread = await this.readThreadAllowingEmptyTurns();
    this.syncThread(thread);
    return latestAgentMessageText(thread);
  }

  getStatus(): string {
    return this.status;
  }

  getSessionInfo(): AgentSessionInfo {
    return {
      mode: "Codex session",
      sessionId: this.threadId ?? this.options.session.threadId,
      details: [
        { label: "Status", value: this.status },
      ],
    };
  }

  private async refreshActiveTurnState(): Promise<void> {
    if (!this.client || !this.threadId) {
      return;
    }
    const thread = await this.readThreadAllowingEmptyTurns();
    this.syncThread(thread);
  }

  private async readThreadAllowingEmptyTurns(): Promise<unknown> {
    if (!this.client || !this.threadId) {
      return null;
    }
    try {
      const response = await this.client.request("thread/read", {
        threadId: this.threadId,
        includeTurns: true,
      });
      return recordValue(response)?.thread ?? null;
    } catch (error) {
      if (!isIncludeTurnsUnavailable(error)) {
        throw error;
      }
      const response = await this.client.request("thread/read", {
        threadId: this.threadId,
        includeTurns: false,
      });
      return recordValue(response)?.thread ?? null;
    }
  }

  private handleNotification(message: ServerNotificationMessage): void {
    if (!this.threadId || message.params?.threadId !== this.threadId) {
      return;
    }

    if (message.method === "turn/started") {
      const turn = message.params?.turn;
      if (turn?.id && turn.status === "inProgress") {
        this.activeTurnId = turn.id;
        this.status = `codex working ${this.activeTurnId}`;
      }
      return;
    }

    if (message.method === "turn/completed") {
      const turnId = message.params?.turn?.id;
      if (!turnId || turnId === this.activeTurnId) {
        this.activeTurnId = null;
      }
      this.status = `codex ${message.params?.turn?.status ?? "idle"} ${this.threadId}`;
      return;
    }

    if (message.method === "thread/status/changed") {
      this.syncThreadStatus(message.params?.status);
    }
  }

  private syncThreadStatus(status: any): void {
    if (status?.type !== "active") {
      this.activeTurnId = null;
    }
  }

  private syncThread(thread: any): void {
    const activeTurn = Array.isArray(thread?.turns)
      ? thread.turns.findLast((turn: any) => turn?.status === "inProgress" && typeof turn.id === "string")
      : null;
    if (activeTurn) {
      this.activeTurnId = activeTurn.id;
      return;
    }
    this.syncThreadStatus(thread?.status);
  }
}

export async function startCodexSession(cwd: string, options: StartCodexSessionOptions = {}): Promise<GadgetCodexSession> {
  const worktree = await readWorktreeInfo(cwd);
  const codexPath = options.codexPath ?? "codex";
  const port = await findFreePort();
  const remoteUrl = `ws://127.0.0.1:${port}`;
  const appServer = spawn(codexPath, ["app-server", "--listen", remoteUrl], {
    cwd: worktree.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  const appServerRuntime = observeAppServer(appServer);
  appServer.unref();

  let session: GadgetCodexSession | null = null;
  try {
    await waitForAppServerReady(remoteUrl, appServerRuntime);
    const now = new Date().toISOString();
    session = {
      cwd: worktree.cwd,
      remoteUrl,
      threadId: null,
      appServerPid: appServer.pid ?? null,
      model: options.model ?? null,
      sourceCwd: options.sourceCwd ?? worktree.cwd,
      repositoryRoot: worktree.repositoryRoot,
      worktreePath: worktree.worktreePath,
      worktreeName: worktree.worktreeName,
      createdAt: now,
      updatedAt: now,
    };
    if (isGadgetCreatedWorktree(worktree)) {
      await upsertKnownWorktree(worktree.repositoryRoot, {
        sourceCwd: options.sourceCwd ?? worktree.cwd,
        repositoryRoot: worktree.repositoryRoot,
        worktreePath: worktree.worktreePath,
        worktreeName: worktree.worktreeName,
        branchName: worktree.branchName,
        createdAt: now,
        updatedAt: now,
      });
    }
    await upsertSession(worktree.repositoryRoot, session);
    if (options.launchCli !== false) {
      console.log(`App server: ${session.remoteUrl}`);
      await launchCodexCli(worktree.cwd, codexPath, session, appServerRuntime, options.resumeSessionId);
    }
    return session;
  } finally {
    if (options.launchCli !== false) {
      try {
        if (session) {
          await removeSession(worktree.repositoryRoot, session);
        }
      } finally {
        await stopAppServer(appServerRuntime.child);
      }
    }
  }
}

export async function cleanupGadgetResources(options: { cwd?: string } = {}): Promise<GadgetCleanupResult> {
  const registry = await readSessionRegistry();
  const allSessions = registrySessions(registry);
  const knownWorktrees = registryWorktrees(registry);
  const processes = await listProcesses();
  const appServers = processes.map(withRemoteUrl).filter(isCodexAppServerProcess);
  const activeRemoteUrls = new Set(processes.map(parseCodexRemoteUrl).filter((value): value is string => Boolean(value)));
  const activeWorktreePaths = new Set(processes.map(parseCodexRemoteCwd).filter((value): value is string => Boolean(value)));
  const currentWorktree = await tryReadWorktreeInfo(options.cwd ?? process.cwd());
  if (currentWorktree) {
    activeWorktreePaths.add(currentWorktree.cwd);
  }

  const killedAppServers: ProcessInfo[] = [];
  const errors: string[] = [];

  for (const appServer of appServers) {
    if (isActiveAppServer(appServer, activeRemoteUrls)) {
      continue;
    }
    try {
      await killProcess(appServer.pid);
      killedAppServers.push(appServer);
    } catch (error) {
      errors.push(`failed to kill app-server ${appServer.pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const activeAppServerRemoteUrls = new Set(appServers.filter((appServer) => isActiveAppServer(appServer, activeRemoteUrls)).map((appServer) => appServer.remoteUrl).filter((value): value is string => Boolean(value)));
  const activeSessions = allSessions.filter((session) => activeRemoteUrls.has(session.remoteUrl) || activeAppServerRemoteUrls.has(session.remoteUrl));
  const removedSessions = allSessions.filter((session) => !activeRemoteUrls.has(session.remoteUrl) && !activeAppServerRemoteUrls.has(session.remoteUrl));
  for (const session of activeSessions) {
    activeWorktreePaths.add(session.worktreePath ?? session.cwd);
  }

  registry.projects = groupSessionsByProject(activeSessions);

  const repositoryRoots = new Set<string>();
  if (currentWorktree) {
    repositoryRoots.add(currentWorktree.repositoryRoot);
  }
  for (const session of allSessions) {
    repositoryRoots.add(session.repositoryRoot ?? session.cwd);
  }
  for (const record of knownWorktrees) {
    repositoryRoots.add(record.repositoryRoot);
  }

  const knownWorktreePaths = new Set(knownWorktrees.map((record) => record.worktreePath));
  const removedWorktrees: GadgetCleanupResult["removedWorktrees"] = [];
  const skippedWorktrees: GadgetCleanupResult["skippedWorktrees"] = [];

  for (const repositoryRoot of repositoryRoots) {
    let worktrees: ListedWorktree[];
    try {
      worktrees = await listWorktrees(repositoryRoot);
    } catch (error) {
      errors.push(`failed to list worktrees for ${repositoryRoot}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    for (const worktree of worktrees) {
      if (worktree.path === repositoryRoot) {
        continue;
      }
      if (!isGadgetOwnedWorktree(worktree, knownWorktreePaths)) {
        continue;
      }
      if (activeWorktreePaths.has(worktree.path)) {
        skippedWorktrees.push({ repositoryRoot, path: worktree.path, reason: "active" });
        continue;
      }

      try {
        await runGit(repositoryRoot, ["worktree", "remove", worktree.path]);
        removedWorktrees.push({ repositoryRoot, path: worktree.path, branchName: worktree.branchName });
      } catch (error) {
        skippedWorktrees.push({ repositoryRoot, path: worktree.path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const removedWorktreePaths = new Set(removedWorktrees.map((worktree) => worktree.path));
  const nextKnownWorktrees = await pruneKnownWorktrees(registry.worktrees ?? {}, removedWorktreePaths);
  if (nextKnownWorktrees) {
    registry.worktrees = nextKnownWorktrees;
  } else {
    delete registry.worktrees;
  }
  await writeSessionRegistry(registry);

  return {
    killedAppServers,
    removedSessions,
    removedWorktrees,
    skippedWorktrees,
    activeSessions,
    errors,
  };
}

export async function selectCodexSession(cwd: string, worktreeName?: string): Promise<GadgetCodexSession | null> {
  const liveSessions = await listLiveCodexSessions(cwd, worktreeName);
  if (liveSessions.length === 0) {
    return null;
  }
  if (liveSessions.length === 1) {
    return liveSessions[0]!;
  }

  console.log("Multiple Gadget Codex sessions are active:");
  console.log(`Project: ${cwd}`);
  liveSessions.forEach((session, index) => {
    const preview = session.preview.trim() || "(no preview yet)";
    console.log(`${index + 1}. ${session.worktreeName ?? basename(session.cwd)} ${session.threadId} ${session.status} ${preview.slice(0, 80)}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await rl.question(`Select session [1-${liveSessions.length}]: `)).trim();
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= liveSessions.length) {
        return liveSessions[index - 1]!;
      }
    }
  } finally {
    rl.close();
  }
}

export async function listLiveCodexSessions(cwd: string, worktreeName?: string): Promise<LiveGadgetCodexSession[]> {
  const target = await readWorktreeInfo(cwd);
  const sessions = (await readAllSessions()).filter((session) => sessionMatchesTarget(session, target, worktreeName));
  const liveSessions: LiveGadgetCodexSession[] = [];

  for (const session of sessions) {
    try {
      const client = await CodexAppServerClient.connect(session.remoteUrl);
      try {
        liveSessions.push(...(await listLoadedThreads(client, session)));
      } finally {
        client.disconnect();
      }
    } catch {
      // Ignore stale app-server records; live sessions are discovered on demand.
    }
  }

  return liveSessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function listLoadedThreads(client: CodexAppServerClient, session: GadgetCodexSession): Promise<LiveGadgetCodexSession[]> {
  if (session.threadId) {
    const thread = await readThread(client, session.threadId);
    if (!thread || thread.cwd !== session.cwd) {
      return [];
    }
    return [toLiveSession({ ...session, threadId: session.threadId }, thread)];
  }

  const response = await client.request("thread/loaded/list", {
    limit: 100,
  });
  const threadIds = Array.isArray(response.data) ? response.data : [];
  const sessions: LiveGadgetCodexSession[] = [];

  for (const threadId of threadIds) {
    if (typeof threadId !== "string") {
      continue;
    }
    const thread = await readThread(client, threadId);
    if (!thread || thread.cwd !== session.cwd) {
      continue;
    }
    sessions.push(toLiveSession({ ...session, threadId }, thread));
  }

  return sessions;
}

async function readThread(client: CodexAppServerClient, threadId: string): Promise<any | null> {
  try {
    const response = await client.request("thread/read", {
      threadId,
      includeTurns: false,
    });
    return response.thread ?? null;
  } catch {
    return null;
  }
}

function toLiveSession(session: GadgetCodexSession & { threadId: string }, thread: any): LiveGadgetCodexSession {
  const now = new Date().toISOString();
  return {
    ...session,
    updatedAt: now,
    preview: thread.preview ?? "",
    status: thread.status?.type ?? "unknown",
  };
}

function latestAgentMessageText(thread: unknown): string | null {
  const threadRecord = recordValue(thread);
  const turns = Array.isArray(threadRecord?.turns) ? threadRecord.turns : [];
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = recordValue(turns[turnIndex]);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = recordValue(items[itemIndex]);
      if (item?.type === "agentMessage" && typeof item.text === "string" && item.text.trim().length > 0) {
        return item.text;
      }
    }
  }
  return null;
}

function isIncludeTurnsUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("includeTurns is unavailable before first user message");
}

function threadStatusType(thread: unknown): string {
  const status = recordValue(recordValue(thread)?.status);
  return typeof status?.type === "string" ? status.type : "connected";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

class CodexAppServerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private constructor(
    private readonly ws: WebSocket,
    private readonly onNotification?: (message: ServerNotificationMessage) => void,
  ) {
    this.ws.onmessage = (event) => this.handleMessage(String(event.data));
    this.ws.onclose = () => this.rejectPending(new Error("Codex app-server websocket closed"));
    this.ws.onerror = () => this.rejectPending(new Error("Codex app-server websocket error"));
  }

  static async connect(remoteUrl: string, onNotification?: (message: ServerNotificationMessage) => void): Promise<CodexAppServerClient> {
    const ws = await openWebSocket(remoteUrl);
    const client = new CodexAppServerClient(ws, onNotification);
    await client.request("initialize", {
      clientInfo: {
        name: "gadget",
        title: "Gadget",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    client.notify("initialized", {});
    return client;
  }

  request(method: string, params: unknown): Promise<any> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Codex app-server websocket is not open"));
    }
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ method, id, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ method, params }));
  }

  disconnect(): void {
    this.rejectPending(new Error("codex disconnected"));
    this.ws.close();
  }

  private handleMessage(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      this.onNotification?.(message);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function readSessions(cwd: string): Promise<GadgetCodexSession[]> {
  const registry = await readSessionRegistry();
  return (registry.projects[cwd] ?? []).filter(isGadgetCodexSession);
}

async function readAllSessions(): Promise<GadgetCodexSession[]> {
  const registry = await readSessionRegistry();
  return registrySessions(registry);
}

async function upsertSession(cwd: string, session: GadgetCodexSession): Promise<void> {
  const sessions = (await readSessions(cwd)).filter(
    (existing) => existing.remoteUrl !== session.remoteUrl && (session.threadId === null || existing.threadId !== session.threadId),
  );
  sessions.push(session);
  await writeSessions(cwd, sessions);
}

async function upsertKnownWorktree(cwd: string, record: GadgetWorktreeRecord): Promise<void> {
  const registry = await readSessionRegistry();
  const existing = (registry.worktrees?.[cwd] ?? []).filter((candidate) => candidate.worktreePath !== record.worktreePath);
  existing.push(record);
  registry.worktrees = {
    ...(registry.worktrees ?? {}),
    [cwd]: existing,
  };
  await writeSessionRegistry(registry);
}

async function removeSession(cwd: string, session: GadgetCodexSession): Promise<void> {
  const sessions = (await readSessions(cwd)).filter((existing) => {
    if (existing.remoteUrl === session.remoteUrl) {
      return false;
    }
    if (session.threadId !== null && existing.threadId === session.threadId) {
      return false;
    }
    return true;
  });
  await writeSessions(cwd, sessions);
}

async function writeSessions(cwd: string, sessions: GadgetCodexSession[]): Promise<void> {
  const registry = await readSessionRegistry();
  if (sessions.length === 0) {
    delete registry.projects[cwd];
  } else {
    registry.projects[cwd] = sessions;
  }
  await writeSessionRegistry(registry);
}

function registrySessions(registry: GadgetSessionRegistry): GadgetCodexSession[] {
  return Object.values(registry.projects).flat().filter(isGadgetCodexSession);
}

function registryWorktrees(registry: GadgetSessionRegistry): GadgetWorktreeRecord[] {
  return Object.values(registry.worktrees ?? {}).flat().filter(isGadgetWorktreeRecord);
}

function groupSessionsByProject(sessions: GadgetCodexSession[]): Record<string, GadgetCodexSession[]> {
  const projects: Record<string, GadgetCodexSession[]> = {};
  for (const session of sessions) {
    const project = session.repositoryRoot ?? session.cwd;
    projects[project] ??= [];
    projects[project].push(session);
  }
  return projects;
}

async function pruneKnownWorktrees(
  worktrees: Record<string, GadgetWorktreeRecord[]>,
  removedWorktreePaths: Set<string>,
): Promise<Record<string, GadgetWorktreeRecord[]> | undefined> {
  const next: Record<string, GadgetWorktreeRecord[]> = {};

  for (const [project, records] of Object.entries(worktrees)) {
    const kept: GadgetWorktreeRecord[] = [];
    for (const record of records) {
      if (removedWorktreePaths.has(record.worktreePath)) {
        continue;
      }
      if (!(await pathExists(record.worktreePath))) {
        continue;
      }
      kept.push(record);
    }
    if (kept.length > 0) {
      next[project] = kept;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

async function readSessionRegistry(): Promise<GadgetSessionRegistry> {
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

async function writeSessionRegistry(registry: GadgetSessionRegistry): Promise<void> {
  const filePath = sessionRegistryPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`);
}

function sessionRegistryPath(): string {
  return join(homedir(), ".gadget", "sessions.json");
}

function isGadgetSessionRegistry(value: unknown): value is GadgetSessionRegistry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const projects = (value as Record<string, unknown>).projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    return false;
  }
  const worktrees = (value as Record<string, unknown>).worktrees;
  return (
    Object.values(projects).every((projectSessions) => Array.isArray(projectSessions) && projectSessions.every(isGadgetCodexSession)) &&
    (worktrees === undefined ||
      (typeof worktrees === "object" &&
        worktrees !== null &&
        !Array.isArray(worktrees) &&
        Object.values(worktrees).every((projectWorktrees) => Array.isArray(projectWorktrees) && projectWorktrees.every(isGadgetWorktreeRecord))))
  );
}

function isGadgetCodexSession(value: unknown): value is GadgetCodexSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.cwd === "string" &&
    typeof candidate.remoteUrl === "string" &&
    (typeof candidate.threadId === "string" || candidate.threadId === null) &&
    (typeof candidate.appServerPid === "number" || candidate.appServerPid === null) &&
    (typeof candidate.model === "string" || candidate.model === null) &&
    optionalString(candidate.sourceCwd) &&
    optionalString(candidate.repositoryRoot) &&
    optionalString(candidate.worktreePath) &&
    optionalString(candidate.worktreeName) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function sessionMatchesTarget(session: GadgetCodexSession, target: Awaited<ReturnType<typeof readWorktreeInfo>>, worktreeName?: string): boolean {
  const sessionWorktreeName = session.worktreeName ?? basename(session.cwd);
  if (worktreeName && sessionWorktreeName !== worktreeName && session.cwd !== target.cwd) {
    return false;
  }
  if (session.cwd === target.cwd) {
    return true;
  }
  if (session.repositoryRoot && session.repositoryRoot === target.repositoryRoot) {
    return true;
  }
  return false;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isGadgetWorktreeRecord(value: unknown): value is GadgetWorktreeRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sourceCwd === "string" &&
    typeof candidate.repositoryRoot === "string" &&
    typeof candidate.worktreePath === "string" &&
    typeof candidate.worktreeName === "string" &&
    typeof candidate.branchName === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

async function launchCodexCli(cwd: string, codexPath: string, session: GadgetCodexSession, appServer: AppServerRuntime, resumeSessionId?: string): Promise<void> {
  const remoteArgs = [
    "--remote",
    session.remoteUrl,
    "-C",
    cwd,
    ...(session.model ? ["-m", session.model] : []),
  ];
  const args = resumeSessionId ? ["resume", ...remoteArgs, resumeSessionId] : remoteArgs;
  const proc = spawn(codexPath, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  const codexExited = waitForChildExitResult(proc);
  const result = await Promise.race([
    codexExited.then((status) => ({ type: "codex" as const, status })),
    appServer.exited.then((status) => ({ type: "app-server" as const, status })),
  ]);

  if (result.type === "app-server") {
    if (proc.exitCode === null && proc.signalCode === null) {
      await stopChildProcess(proc);
    }
    throw new Error(formatAppServerExitError(result.status, appServer.recentOutput()));
  }

  if ("error" in result.status) {
    throw result.status.error;
  }
  if (result.status.signal) {
    return;
  }
  if (result.status.code && result.status.code !== 0) {
    throw new Error(formatCodexExitError(result.status.code, appServer));
  }
}

async function waitForAppServerReady(remoteUrl: string, appServer: AppServerRuntime): Promise<void> {
  let result: { type: "ready"; client: CodexAppServerClient } | { type: "app-server"; status: ChildExitStatus };
  try {
    result = await Promise.race([
      CodexAppServerClient.connect(remoteUrl).then((client) => ({ type: "ready" as const, client })),
      appServer.exited.then((status) => ({ type: "app-server" as const, status })),
    ]);
  } catch (error) {
    throw new Error(formatAppServerStartupError(error, appServer.recentOutput()));
  }

  if (result.type === "app-server") {
    throw new Error(formatAppServerExitError(result.status, appServer.recentOutput()));
  }

  result.client.disconnect();
}

function observeAppServer(child: ChildProcess): AppServerRuntime {
  const output = createChildOutputBuffer(child);
  return {
    child,
    exited: waitForChildExitStatus(child),
    recentOutput: output.recentOutput,
  };
}

function createChildOutputBuffer(child: ChildProcess): { recentOutput: () => string } {
  let buffer = "";
  const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
    buffer += `[app-server ${stream}] ${chunk.toString()}`;
    if (buffer.length > APP_SERVER_OUTPUT_MAX_BYTES) {
      buffer = buffer.slice(buffer.length - APP_SERVER_OUTPUT_MAX_BYTES);
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
  return {
    recentOutput: () => buffer.trim(),
  };
}

function waitForChildExitStatus(child: ChildProcess): Promise<ChildExitStatus> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error: Error) => {
      cleanup();
      resolve({ code: null, signal: null, error });
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal });
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForChildExitResult(child: ChildProcess): Promise<ChildExitStatus | { error: Error }> {
  return new Promise((resolve) => {
    const cleanup = () => {
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error: Error) => {
      cleanup();
      resolve({ error });
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal });
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function formatCodexExitError(code: number, appServer: AppServerRuntime): string {
  const output = appServer.recentOutput();
  const appServerState = describeChildState(appServer.child);
  return [
    `codex exited with code ${code}`,
    `app-server was ${appServerState}`,
    output ? `recent app-server output:\n${output}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatAppServerExitError(status: ChildExitStatus, output: string): string {
  return [
    `codex app-server exited unexpectedly (${formatExitStatus(status)})`,
    output ? `recent app-server output:\n${output}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatAppServerStartupError(error: unknown, output: string): string {
  return [
    `could not connect to codex app-server: ${error instanceof Error ? error.message : String(error)}`,
    output ? `recent app-server output:\n${output}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function describeChildState(child: ChildProcess): string {
  if (child.exitCode !== null || child.signalCode !== null) {
    return `already exited (${formatExitStatus({ code: child.exitCode, signal: child.signalCode })})`;
  }
  if (child.pid && !processExists(child.pid)) {
    return "not running";
  }
  return "still running";
}

function formatExitStatus(status: ChildExitStatus): string {
  if (status.error) {
    return status.error.message;
  }
  if (status.signal) {
    return `signal ${status.signal}`;
  }
  return `code ${status.code ?? "unknown"}`;
}

async function stopAppServer(child: ChildProcess): Promise<void> {
  await stopChildProcess(child);
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  sendSignal(child, "SIGTERM");
  if (await waitForChildExit(child, APP_SERVER_SHUTDOWN_GRACE_MS)) {
    return;
  }
  sendSignal(child, "SIGKILL");
  await waitForChildExit(child, APP_SERVER_SHUTDOWN_GRACE_MS);
}

function sendSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return;
    }
    throw error;
  }
}

async function killProcess(pid: number): Promise<void> {
  sendProcessSignal(pid, "SIGTERM");
  if (await waitForProcessExit(pid, APP_SERVER_SHUTDOWN_GRACE_MS)) {
    return;
  }
  sendProcessSignal(pid, "SIGKILL");
  await waitForProcessExit(pid, APP_SERVER_SHUTDOWN_GRACE_MS);
}

function sendProcessSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return;
    }
    throw error;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    return true;
  }
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

async function listProcesses(): Promise<ProcessInfo[]> {
  const proc = Bun.spawn(["ps", "-axo", "pid=,ppid=,command="], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "ps failed");
  }

  return stdout
    .split(/\r?\n/)
    .map((line) => /^ *(\d+) +(\d+) +(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3] ?? "",
    }));
}

function withRemoteUrl(processInfo: ProcessInfo): ProcessInfo {
  const remoteUrl = parseAppServerRemoteUrl(processInfo.command);
  return remoteUrl ? { ...processInfo, remoteUrl } : processInfo;
}

function isCodexAppServerProcess(processInfo: ProcessInfo): boolean {
  return Boolean(processInfo.remoteUrl && /\bcodex\b.*\bapp-server\b.*\b--listen\b/.test(processInfo.command));
}

function isActiveAppServer(processInfo: ProcessInfo, activeRemoteUrls: Set<string>): boolean {
  if (processInfo.remoteUrl && activeRemoteUrls.has(processInfo.remoteUrl)) {
    return true;
  }

  return processInfo.ppid !== 1 && processExists(processInfo.ppid);
}

function parseAppServerRemoteUrl(command: string): string | undefined {
  return /(?:^|\s)--listen\s+(ws:\/\/[^\s]+)/.exec(command)?.[1];
}

function parseCodexRemoteUrl(processInfo: ProcessInfo): string | undefined {
  if (!/\bcodex\b.*\b--remote\b/.test(processInfo.command)) {
    return undefined;
  }
  return /(?:^|\s)--remote\s+(ws:\/\/[^\s]+)/.exec(processInfo.command)?.[1];
}

function parseCodexRemoteCwd(processInfo: ProcessInfo): string | undefined {
  if (!/\bcodex\b.*\b--remote\b/.test(processInfo.command)) {
    return undefined;
  }
  return /(?:^|\s)-C\s+([^\s]+)/.exec(processInfo.command)?.[1];
}

function isGadgetOwnedWorktree(worktree: ListedWorktree, knownWorktreePaths: Set<string>): boolean {
  if (knownWorktreePaths.has(worktree.path)) {
    return true;
  }
  if (worktree.branchName?.startsWith("gadget/")) {
    return true;
  }
  return isUnderGadgetWorktreeRoot(worktree.path) && basename(worktree.path).startsWith("ggt-");
}

async function tryReadWorktreeInfo(cwd: string): Promise<Awaited<ReturnType<typeof readWorktreeInfo>> | null> {
  try {
    return await readWorktreeInfo(cwd);
  } catch {
    return null;
  }
}

function isGadgetCreatedWorktree(worktree: Awaited<ReturnType<typeof readWorktreeInfo>>): boolean {
  if (worktree.isPrimary) {
    return false;
  }
  if (worktree.branchName.startsWith("gadget/")) {
    return true;
  }
  return isUnderGadgetWorktreeRoot(worktree.worktreePath) && basename(worktree.worktreePath).startsWith("ggt-");
}

function isUnderGadgetWorktreeRoot(path: string): boolean {
  return path.startsWith(join(homedir(), ".gadget", "worktrees") + "/");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local app-server port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("websocket open timed out"));
        }, 1_000);

        ws.onopen = () => {
          clearTimeout(timer);
          resolve(ws);
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("websocket open failed"));
        };
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Could not connect to codex app-server: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
