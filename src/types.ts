export type DiffLineKind = "context" | "add" | "remove" | "hunk" | "file";

export type DiffLineRef = {
  id: string;
  filePath: string;
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  hunkHeader: string | null;
  text: string;
  raw: string;
};

export type DiffFile = {
  filePath: string;
  additions: number;
  removals: number;
  lines: DiffLineRef[];
  rawDiff: string;
};

export type DiffState = {
  cwd: string;
  baseRef: string;
  baseRefLabel: string;
  branchName: string;
  files: DiffFile[];
  refreshedAt: number;
};

export type AgentComment = {
  id: string;
  createdAt: string;
  cwd: string;
  filePath: string;
  oldLine: number | null;
  newLine: number | null;
  side: DiffLineKind;
  hunkHeader: string | null;
  hunk: string;
  selectedLine: string;
  comment: string;
  status: "queued" | "copied" | "sent" | "failed";
  delivery?: string;
  error?: string;
};

export type AgentSessionInfo = {
  mode: string;
  sessionId?: string | null;
  details?: Array<{ label: string; value: string }>;
};

export interface AgentAdapter {
  label: string;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  sendComment(comment: AgentComment): Promise<void>;
  sendPrompt?(prompt: string): Promise<void>;
  getScratchpadText?(): Promise<string | null>;
  getSessionInfo?(): AgentSessionInfo;
  getStatus(): string;
}
