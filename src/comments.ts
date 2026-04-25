import { resolve } from "node:path";
import type { AgentComment, DiffFile, DiffLineRef } from "./types";
import { hunkForLine } from "./git";

type CreateCommentOptions = {
  includeHunk?: boolean;
};

export function createComment(
  cwd: string,
  file: DiffFile,
  line: DiffLineRef,
  comment: string,
  options: CreateCommentOptions = {},
): AgentComment {
  const now = new Date();
  return {
    id: `gdt_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    cwd,
    filePath: file.filePath,
    oldLine: line.oldLine,
    newLine: line.newLine,
    side: line.kind,
    hunkHeader: line.hunkHeader,
    hunk: options.includeHunk === false ? "" : hunkForLine(file, line),
    selectedLine: line.raw,
    comment,
    status: "queued",
  };
}

export function formatCommentPrompt(comment: AgentComment): string {
  const filePath = resolve(comment.cwd, comment.filePath);
  const lineNumber = comment.newLine ?? comment.oldLine;
  const isDeletedLine = comment.side === "remove" && comment.oldLine !== null;

  const prompt = [
    `File: ${isDeletedLine || lineNumber === null ? filePath : `${filePath}:${lineNumber}`}`,
  ];
  if (isDeletedLine) {
    prompt.push(`Deleted line: old line ${comment.oldLine}`);
  }

  if (comment.hunk.trim().length > 0) {
    prompt.push("Hunk:", "```diff", comment.hunk, "```");
  }

  prompt.push("", comment.comment);
  return prompt.join("\n");
}

export function formatReviewPrompt(comments: AgentComment[]): string {
  const sections = comments.map((comment, index) => {
    return [`Comment ${index + 1}:`, formatCommentPrompt(comment)].join("\n");
  });
  return sections.join("\n\n---\n\n");
}
