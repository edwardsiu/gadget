import type { AgentAdapter, AgentComment, AgentFeedbackTurn, AgentSessionInfo } from "../types";
import { formatCommentPrompt } from "../comments";
import type { GadgetPiSessionRecord } from "../session-registry";

export type GadgetPiSession = GadgetPiSessionRecord;

type BridgeResponse = {
  ok?: boolean;
  status?: string;
  text?: string | null;
  turns?: AgentFeedbackTurn[];
  error?: string;
};

export class PiBridgeAdapter implements AgentAdapter {
  label = "pi";
  private status: string;

  constructor(private readonly session: GadgetPiSession) {
    this.status = `pi ${session.name}`;
  }

  async sendComment(comment: AgentComment): Promise<void> {
    await this.sendPrompt(formatCommentPrompt(comment));
  }

  async sendPrompt(prompt: string): Promise<void> {
    const response = await this.request("/send", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    this.status = response.status ?? `sent to ${this.session.name}`;
  }

  async getFeedbackText(): Promise<string | null> {
    const response = await this.requestWithLegacyFallback("/feedback", "/scratchpad", { method: "GET" });
    return response.text ?? null;
  }

  async getFeedbackTurns(): Promise<AgentFeedbackTurn[]> {
    const response = await this.requestWithLegacyFallback("/feedback/turns", "/scratchpad/turns", { method: "GET" });
    return Array.isArray(response.turns) ? response.turns : [];
  }

  getSessionInfo(): AgentSessionInfo {
    return {
      mode: "Pi bridge",
      sessionId: this.session.sessionId,
      details: [
        { label: "Name", value: this.session.name },
        { label: "PID", value: String(this.session.pid) },
        { label: "Bridge", value: this.session.url },
        ...(this.session.sessionFile ? [{ label: "Session file", value: this.session.sessionFile }] : []),
      ],
    };
  }

  getStatus(): string {
    return this.status;
  }

  private async requestWithLegacyFallback(path: string, legacyPath: string, init: RequestInit): Promise<BridgeResponse> {
    try {
      return await this.request(path, init);
    } catch (error) {
      if (!isBridgeNotFoundError(error)) {
        throw error;
      }
      return await this.request(legacyPath, init);
    }
  }

  private async request(path: string, init: RequestInit): Promise<BridgeResponse> {
    const response = await fetch(`${this.session.url}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-gadget-token": this.session.token,
        ...init.headers,
      },
    });
    const payload = await parseBridgeResponse(response);
    if (!response.ok || payload.ok === false) {
      throw new PiBridgeRequestError(payload.error ?? `Pi bridge request failed: ${response.status}`, response.status);
    }
    return payload;
  }
}

class PiBridgeRequestError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "PiBridgeRequestError";
  }
}

function isBridgeNotFoundError(error: unknown): boolean {
  return error instanceof PiBridgeRequestError && error.statusCode === 404;
}

async function parseBridgeResponse(response: Response): Promise<BridgeResponse> {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" ? payload as BridgeResponse : {};
  } catch {
    return {};
  }
}
