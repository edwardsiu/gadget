import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const CUSTOM_TYPE = "gadget-pi-bridge";
const HOST = "127.0.0.1";

export default function gadgetPiBridge(pi) {
  let bridge = null;

  pi.on("session_start", async (_event, ctx) => {
    await stopBridge(bridge);
    bridge = await startBridge(pi, ctx);
    ctx.ui.setStatus("gadget", ctx.ui.theme.fg("accent", "gadget"));
  });

  pi.on("session_shutdown", async () => {
    await stopBridge(bridge);
    bridge = null;
  });
}

async function startBridge(pi, ctx) {
  const token = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = new Date().toISOString();
  let currentCtx = ctx;

  const server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) {
        writeJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, {
          ok: true,
          status: currentCtx.isIdle() ? "idle" : "working",
          sessionId: currentCtx.sessionManager.getSessionId(),
        });
        return;
      }

      if (request.method === "GET" && (url.pathname === "/feedback" || url.pathname === "/scratchpad")) {
        writeJson(response, 200, { ok: true, text: latestAssistantText(currentCtx) });
        return;
      }

      if (request.method === "GET" && (url.pathname === "/feedback/turns" || url.pathname === "/scratchpad/turns")) {
        writeJson(response, 200, { ok: true, turns: assistantTurnChoices(currentCtx) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/send") {
        const body = await readJsonBody(request);
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) {
          writeJson(response, 400, { ok: false, error: "prompt is required" });
          return;
        }

        if (currentCtx.isIdle()) {
          pi.sendUserMessage(prompt);
          writeJson(response, 200, { ok: true, status: "sent to pi" });
        } else {
          pi.sendUserMessage(prompt, { deliverAs: "steer" });
          writeJson(response, 200, { ok: true, status: "steered pi" });
        }
        return;
      }

      writeJson(response, 404, { ok: false, error: "not found" });
    } catch (error) {
      writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const url = await listen(server);
  const record = sessionRecord(currentCtx, token, url, createdAt);
  await upsertSession(record);
  pi.appendEntry(CUSTOM_TYPE, { url, pid: process.pid, startedAt: createdAt });

  return {
    token,
    url,
    get ctx() {
      return currentCtx;
    },
    set ctx(value) {
      currentCtx = value;
    },
    close: async () => {
      await removeSession(record);
      await closeServer(server);
    },
  };
}

async function stopBridge(bridge) {
  if (!bridge) {
    return;
  }
  await bridge.close();
}

function sessionRecord(ctx, token, url, createdAt) {
  const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
  const sessionId = ctx.sessionManager.getSessionId() ?? null;
  const sessionName = ctx.sessionManager.getSessionName?.() ?? null;
  return {
    client: "pi",
    transport: "http",
    token,
    cwd: ctx.cwd,
    pid: process.pid,
    url,
    sessionId,
    sessionFile,
    name: sessionName || (sessionFile ? basename(sessionFile) : `pi ${process.pid}`),
    createdAt,
    updatedAt: createdAt,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not allocate Gadget Pi bridge port"));
        return;
      }
      resolve(`http://${HOST}:${address.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function authorized(request, token) {
  return request.headers["x-gadget-token"] === token;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(payload)}\n`);
}

function latestAssistantText(ctx) {
  return assistantTurnChoices(ctx)[0]?.text ?? null;
}

function assistantTurnChoices(ctx) {
  const turns = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") {
      continue;
    }
    const text = messageText(entry.message).trim();
    if (!text) {
      continue;
    }
    turns.push({
      id: String(entry.id ?? `assistant-${turns.length + 1}`),
      label: `Assistant turn ${turns.length + 1}`,
      text,
      createdAt: entry.timestamp ?? null,
    });
  }
  return turns.reverse();
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => block?.type === "text" && typeof block.text === "string" ? block.text : "")
    .filter(Boolean)
    .join("\n");
}

async function readRegistry() {
  try {
    const value = JSON.parse(await readFile(registryPath(), "utf8"));
    if (!value || typeof value !== "object" || !value.projects || typeof value.projects !== "object") {
      return { projects: {} };
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { projects: {} };
    }
    throw error;
  }
}

async function writeRegistry(registry) {
  const path = registryPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`);
}

function registryPath() {
  return join(homedir(), ".gadget", "sessions.json");
}

async function upsertSession(record) {
  const registry = await readRegistry();
  const sessions = registry.projects[record.cwd] ?? [];
  registry.projects[record.cwd] = [
    ...sessions.filter((session) => !samePiSession(session, record)),
    record,
  ];
  await writeRegistry(registry);
}

async function removeSession(record) {
  const registry = await readRegistry();
  const sessions = registry.projects[record.cwd] ?? [];
  const remaining = sessions.filter((session) => {
    return !(session?.client === "pi" && session?.transport === "http" && session?.token === record.token);
  });
  if (remaining.length === 0) {
    delete registry.projects[record.cwd];
  } else {
    registry.projects[record.cwd] = remaining;
  }
  await writeRegistry(registry);
}

function samePiSession(session, record) {
  if (session?.client !== "pi" || session?.transport !== "http") {
    return false;
  }
  if (session.pid === record.pid && session.sessionId === record.sessionId) {
    return true;
  }
  return Boolean(record.sessionFile && session.sessionFile === record.sessionFile);
}
