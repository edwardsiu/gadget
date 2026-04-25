import type { DiffFile, DiffLineRef } from "./types";

export type ScratchpadLine = {
  id: string;
  lineNumber: number;
  text: string;
};

export type ScratchpadDocument = {
  id: string;
  title: string;
  text: string;
  lines: ScratchpadLine[];
};

export type ScratchpadCommentDraft = {
  key: string;
  lineNumber: number;
  value: string;
  savedAt: number;
};

export function createScratchpadDocument(text: string, title = "Scratchpad"): ScratchpadDocument {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const rawLines = normalizedText.length === 0 ? [] : normalizedText.split("\n");
  return {
    id: `scratchpad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    text: normalizedText,
    lines: rawLines.map((line, index) => ({
      id: `scratchpad-line-${index + 1}`,
      lineNumber: index + 1,
      text: line,
    })),
  };
}

export function scratchpadDocumentToDiffFile(document: ScratchpadDocument): DiffFile {
  return {
    filePath: document.title,
    additions: 0,
    removals: 0,
    rawDiff: document.text,
    lines: document.lines.map(scratchpadLineToDiffLine),
  };
}

export function formatScratchpadPrompt(document: ScratchpadDocument, drafts: ScratchpadCommentDraft[]): string {
  return [...drafts]
    .sort((left, right) => left.savedAt - right.savedAt)
    .map((draft) => formatScratchpadPromptSection(document, draft))
    .join("\n\n");
}

export function scratchpadCommentKey(lineNumber: number): string {
  return `scratchpad:${lineNumber}`;
}

function scratchpadLineToDiffLine(line: ScratchpadLine): DiffLineRef {
  return {
    id: line.id,
    filePath: "Scratchpad",
    kind: "context",
    oldLine: null,
    newLine: line.lineNumber,
    hunkHeader: null,
    text: line.text,
    raw: line.text,
  };
}

function formatScratchpadPromptSection(document: ScratchpadDocument, draft: ScratchpadCommentDraft): string {
  const currentLine = document.lines[draft.lineNumber - 1]?.text ?? "";
  const quotedLine = currentLine.length > 0 ? `> ${currentLine}` : ">";
  return `${quotedLine}\n${draft.value}`;
}
