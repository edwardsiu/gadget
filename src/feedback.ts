import type { DiffFile, DiffLineRef } from "./types";

export type FeedbackLine = {
  id: string;
  lineNumber: number;
  text: string;
};

export type FeedbackDocument = {
  id: string;
  title: string;
  text: string;
  lines: FeedbackLine[];
};

export type FeedbackCommentDraft = {
  key: string;
  lineNumber: number;
  value: string;
  savedAt: number;
};

export function createFeedbackDocument(text: string, title = "Feedback"): FeedbackDocument {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const rawLines = normalizedText.length === 0 ? [] : normalizedText.split("\n");
  return {
    id: `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    text: normalizedText,
    lines: rawLines.map((line, index) => ({
      id: `feedback-line-${index + 1}`,
      lineNumber: index + 1,
      text: line,
    })),
  };
}

export function feedbackDocumentToDiffFile(document: FeedbackDocument): DiffFile {
  return {
    filePath: document.title,
    additions: 0,
    removals: 0,
    rawDiff: document.text,
    lines: document.lines.map(feedbackLineToDiffLine),
  };
}

export function formatFeedbackPrompt(document: FeedbackDocument, drafts: FeedbackCommentDraft[]): string {
  return [...drafts]
    .sort((left, right) => left.savedAt - right.savedAt)
    .map((draft) => formatFeedbackPromptSection(document, draft))
    .join("\n\n");
}

export function feedbackCommentKey(lineNumber: number): string {
  return `feedback:${lineNumber}`;
}

function feedbackLineToDiffLine(line: FeedbackLine): DiffLineRef {
  return {
    id: line.id,
    filePath: "Feedback",
    kind: "context",
    oldLine: null,
    newLine: line.lineNumber,
    hunkHeader: null,
    text: line.text,
    raw: line.text,
  };
}

function formatFeedbackPromptSection(document: FeedbackDocument, draft: FeedbackCommentDraft): string {
  const currentLine = document.lines[draft.lineNumber - 1]?.text ?? "";
  const quotedLine = currentLine.length > 0 ? `> ${currentLine}` : ">";
  return `${quotedLine}\n${draft.value}`;
}
