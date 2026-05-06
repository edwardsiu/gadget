import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PiBridgeAdapter, type GadgetPiSession } from "../adapters/pi-bridge-adapter";
import { isGadgetPiSessionRecord, readSessionRegistry, writeSessionRegistry } from "../session-registry";
import type { RuntimeSession } from "./types";

export async function startPiRuntime(cwd: string, args: string[] = []): Promise<void> {
  const extensionPath = gadgetPiExtensionPath();
  await waitForChild("pi", ["-e", extensionPath, ...args], { cwd });
}

export async function listPiRuntimeSessions(cwd: string): Promise<RuntimeSession[]> {
  const sessions = await listLivePiSessions(cwd);
  return sessions.map((session) => ({
    client: "pi",
    cwd: session.cwd,
    label: "pi",
    status: "pi bridge connected",
    preview: session.name,
    updatedAt: session.updatedAt,
    session,
  }));
}

export function createPiRuntimeAdapter(session: RuntimeSession): PiBridgeAdapter {
  return new PiBridgeAdapter(session.session as GadgetPiSession);
}

export async function listLivePiSessions(cwd: string): Promise<GadgetPiSession[]> {
  const registry = await readSessionRegistry();
  const sessions = (registry.projects[cwd] ?? []).filter(isGadgetPiSessionRecord);
  const live: GadgetPiSession[] = [];
  let removed = false;

  for (const session of sessions) {
    if (await isPiSessionActive(session)) {
      live.push(session);
    } else {
      removed = true;
    }
  }

  if (removed) {
    const otherSessions = (registry.projects[cwd] ?? []).filter((session) => !isGadgetPiSessionRecord(session));
    if (live.length > 0 || otherSessions.length > 0) {
      registry.projects[cwd] = [...otherSessions, ...live];
    } else {
      delete registry.projects[cwd];
    }
    await writeSessionRegistry(registry);
  }

  return live;
}

export async function isPiSessionActive(session: GadgetPiSession): Promise<boolean> {
  try {
    const response = await fetch(`${session.url}/health`, {
      headers: { "x-gadget-token": session.token },
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function gadgetPiExtensionPath(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return join(root, "pi-extension", "extensions", "gadget.js");
}

async function waitForChild(command: string, args: string[], options: { cwd: string }): Promise<void> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: "inherit",
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
