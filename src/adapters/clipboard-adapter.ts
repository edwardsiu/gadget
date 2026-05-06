import type { AgentAdapter, AgentComment, AgentSessionInfo } from "../types";
import { copyToClipboard, readClipboard } from "../clipboard";
import { formatCommentPrompt } from "../comments";

export class ClipboardAdapter implements AgentAdapter {
  label = "clipboard";
  private status = "clipboard ready";

  async sendComment(comment: AgentComment): Promise<void> {
    await copyToClipboard(formatCommentPrompt(comment));
    this.status = `copied ${comment.filePath}`;
  }

  async sendPrompt(prompt: string): Promise<void> {
    await copyToClipboard(prompt);
    this.status = "copied prompt";
  }

  async getFeedbackText(): Promise<string | null> {
    return await readClipboard();
  }

  getSessionInfo(): AgentSessionInfo {
    return {
      mode: "Clipboard mode",
    };
  }

  getStatus(): string {
    return this.status;
  }
}
