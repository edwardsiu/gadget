import { resolve } from "node:path";
import type { DiffFile, DiffLineRef } from "../types";
import { clamp } from "./text";

export async function readCurrentFileLines(cwd: string, filePath: string): Promise<DiffLineRef[]> {
  try {
    const absolutePath = resolve(cwd, filePath);
    const file = Bun.file(absolutePath);
    if (!(await file.exists())) {
      return [currentFileStatusLine(filePath, "File does not exist in the current directory.")];
    }

    const stat = await file.stat();
    if (!stat.isFile()) {
      return [currentFileStatusLine(filePath, "Path is not a regular file.")];
    }
    if (stat.size > 1_000_000) {
      return [currentFileStatusLine(filePath, "File is too large to display.")];
    }

    const text = await file.text();
    const contentLines = text === ""
      ? [""]
      : text.endsWith("\n")
        ? text.slice(0, -1).split(/\r?\n/)
        : text.split(/\r?\n/);

    return contentLines.map((line, index) => ({
      id: `${filePath}:full:${index + 1}`,
      filePath,
      kind: "context",
      oldLine: null,
      newLine: index + 1,
      hunkHeader: null,
      text: line,
      raw: line,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [currentFileStatusLine(filePath, `Could not read current file: ${message}`)];
  }
}

export function currentFileStatusLine(filePath: string, message: string): DiffLineRef {
  return {
    id: `${filePath}:full:status`,
    filePath,
    kind: "file",
    oldLine: null,
    newLine: null,
    hunkHeader: null,
    text: message,
    raw: message,
  };
}

export function createOpenedFile(filePath: string): DiffFile {
  return {
    filePath,
    additions: 0,
    removals: 0,
    lines: [currentFileStatusLine(filePath, "No diff for this file.")],
    rawDiff: "",
  };
}

export function selectedCurrentLineNumber(line: DiffLineRef | null): number | null {
  return line?.newLine ?? line?.oldLine ?? null;
}

export function nearestLineIndexForLineNumber(lines: DiffLineRef[], lineNumber: number): number {
  const exactNewLine = lines.findIndex((line) => line.newLine === lineNumber && line.kind !== "remove");
  if (exactNewLine >= 0) {
    return exactNewLine;
  }

  const exactOldLine = lines.findIndex((line) => line.oldLine === lineNumber);
  if (exactOldLine >= 0) {
    return exactOldLine;
  }

  return clamp(lineNumber - 1, 0, Math.max(0, lines.length - 1));
}
