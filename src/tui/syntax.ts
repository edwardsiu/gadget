import {
  addDefaultParsers,
  parseColor,
  SyntaxStyle,
  type TextChunk,
} from "@opentui/core";
import { fileURLToPath } from "node:url";
import type { DiffLineRef } from "../types";
import { COLORS } from "./theme";

export type DiffHighlightSide = "old" | "new";
export type HighlightCacheSide = DiffHighlightSide | "full";
export type HighlightDocument = {
  content: string;
  lines: DiffLineRef[];
};
export type HighlightCacheEntry = {
  documentKey: string;
  chunksByLine: TextChunk[][];
};

export function registerAdditionalSyntaxParsers(): void {
  addDefaultParsers([
    {
      filetype: "python",
      aliases: ["py"],
      wasm: packageFilePath("tree-sitter-python/tree-sitter-python.wasm"),
      queries: {
        highlights: [packageFilePath("tree-sitter-python/queries/highlights.scm")],
      },
    },
    {
      filetype: "json",
      wasm: packageFilePath("tree-sitter-json/tree-sitter-json.wasm"),
      queries: {
        highlights: [packageFilePath("tree-sitter-json/queries/highlights.scm")],
      },
    },
  ]);
}

export function createDiffSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: parseColor(COLORS.text) },
    attribute: { fg: parseColor("#8bd5ff") },
    boolean: { fg: parseColor("#ffb86c") },
    comment: { fg: parseColor("#7f8a96"), italic: true },
    constant: { fg: parseColor("#ffb86c") },
    constructor: { fg: parseColor("#8bd5ff") },
    function: { fg: parseColor("#8bd5ff") },
    keyword: { fg: parseColor("#ff9d66") },
    module: { fg: parseColor("#d8b84c") },
    number: { fg: parseColor("#38d5e8") },
    operator: { fg: parseColor("#c792ea") },
    property: { fg: parseColor("#82aaff") },
    punctuation: { fg: parseColor("#94a3b8") },
    string: { fg: parseColor("#66d187") },
    tag: { fg: parseColor("#ff7b8a") },
    type: { fg: parseColor("#d8b84c") },
    variable: { fg: parseColor("#d9dee5") },
  });
}

export function buildHighlightDocument(lines: DiffLineRef[]): HighlightDocument {
  return {
    content: lines.map((line) => line.text).join("\n"),
    lines,
  };
}

export function preserveSyntaxLineChunks(
  lines: DiffLineRef[],
  currentLineChunks: Map<string, TextChunk[]>,
  currentLineKeys: Map<string, string>,
  nextLineChunks: Map<string, TextChunk[]>,
  nextLineKeys: Map<string, string>,
): void {
  for (const line of lines) {
    const lineKey = syntaxLineKey(line);
    const previousChunks = currentLineChunks.get(line.id);
    if (previousChunks && currentLineKeys.get(line.id) === lineKey) {
      nextLineChunks.set(line.id, previousChunks);
      nextLineKeys.set(line.id, lineKey);
    }
  }
}

export function syntaxLineKey(line: DiffLineRef): string {
  return `${line.kind}\0${line.text}`;
}

export function syntaxDocumentCacheKey(filePath: string, filetype: string, side: HighlightCacheSide, lines: DiffLineRef[]): string {
  const firstLineId = lines[0]?.id ?? "";
  const lastLineId = lines.at(-1)?.id ?? "";
  return `${filetype}\0${side}\0${filePath}\0${firstLineId}\0${lastLineId}\0${lines.length}`;
}

export function syntaxDocumentKey(filetype: string, content: string): string {
  return `${filetype}\0${content}`;
}

export function applySyntaxChunks(
  document: HighlightDocument,
  chunksByLine: TextChunk[][],
  lineChunks: Map<string, TextChunk[]>,
  lineKeys: Map<string, string>,
): void {
  for (let index = 0; index < document.lines.length; index += 1) {
    const line = document.lines[index];
    if (line) {
      lineChunks.set(line.id, chunksByLine[index] ?? []);
      lineKeys.set(line.id, syntaxLineKey(line));
    }
  }
}

export function splitTextChunksByLine(chunks: TextChunk[]): TextChunk[][] {
  const lines: TextChunk[][] = [[]];
  for (const chunk of chunks) {
    const parts = chunk.text.split("\n");
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      if (part.length > 0) {
        lines[lines.length - 1]?.push({ ...chunk, text: part });
      }
      if (index < parts.length - 1) {
        lines.push([]);
      }
    }
  }
  return lines;
}

function packageFilePath(specifier: string): string {
  return fileURLToPath(import.meta.resolve(specifier));
}
