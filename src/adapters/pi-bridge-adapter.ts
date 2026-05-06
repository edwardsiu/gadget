import type { AgentAdapter, AgentComment, AgentScratchpadTurn, AgentSessionInfo } from "../types";
import { formatCommentPrompt } from "../comments";
import type { GadgetPiSessionRecord } from "../session-registry";

export type GadgetPiSession = GadgetPiSessionRecord;

type BridgeResponse = {
  ok?: boolean;
  status?: string;
  text?: string | null;
  turns?: AgentScratchpadTurn[];
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

  async getScratchpadText(): Promise<string | null> {
    const response = await this.request("/scratchpad", { method: "GET" });
    return response.text ?? null;
  }

  async getScratchpadTurns(): Promise<AgentScratchpadTurn[]> {
    const response = await this.request("/scratchpad/turns", { method: "GET" });
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
      throw new Error(payload.error ?? `Pi bridge request failed: ${response.status}`);
    }
    return payload;
  }
}

async function parseBridgeResponse(response: Response): Promise<BridgeResponse> {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" ? payload as BridgeResponse : {};
  } catch {
    return {};
  }
}
