import {
  parseColor,
  StyledText,
  type TextChunk,
} from "@opentui/core";
import type { DiffFile, DiffLineRef } from "../types";
import { appendStyledChunk, truncateToWidth } from "./text";
import {
  COLORS,
  DIFF_LINE_NUMBER_WIDTH,
  NAV_BORDER,
  type TextStyle,
} from "./theme";

export type DiffVisualRow = {
  lineNumber: string;
  sign: string;
  text: string;
  syntaxChunks: TextChunk[] | null;
};

export type FullFileLineHighlight = "added" | "modified";

export function formatDiffRows(line: DiffLineRef, width: number, syntaxChunks?: TextChunk[]): DiffVisualRow[] {
  if (line.kind === "file") {
    return [{
      lineNumber: " ".repeat(DIFF_LINE_NUMBER_WIDTH),
      sign: " ",
      text: line.text,
      syntaxChunks: null,
    }];
  }

  const usableWidth = Math.max(1, width);
  const contentWidth = Math.max(1, usableWidth - diffLinePrefixWidth());
  const textRows = wrapTextLineWithOffsets(line.text, contentWidth);
  return textRows.map(({ text, start }, index) => ({
    lineNumber: index === 0 ? formatLineNumber(diffDisplayLineNumber(line)) : " ".repeat(DIFF_LINE_NUMBER_WIDTH),
    sign: index === 0 ? diffLineSign(line) : " ",
    text,
    syntaxChunks: line.kind === "hunk" || !syntaxChunks ? null : sliceTextChunks(syntaxChunks, start, text.length),
  }));
}

export function formatDiffViewportRow(content: string, width: number, contentStyle: TextStyle, hasLeftBorder: boolean, borderFg: string): StyledText {
  const chunks: TextChunk[] = [];
  if (width <= 1) {
    appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: borderFg, bg: COLORS.bg });
    return new StyledText(chunks);
  }

  if (hasLeftBorder) {
    appendDiffVerticalBorder(chunks, borderFg);
  }
  const contentWidth = width - 1 - (hasLeftBorder ? 1 : 0);
  appendStyledChunk(chunks, content.slice(0, contentWidth).padEnd(contentWidth), contentStyle);
  appendDiffVerticalBorder(chunks, borderFg);
  return new StyledText(chunks);
}

export function formatDiffViewportDiffRow(row: DiffVisualRow, width: number, contentStyle: TextStyle, hasLeftBorder: boolean, borderFg: string): StyledText {
  const chunks: TextChunk[] = [];
  if (width <= 1) {
    appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: borderFg, bg: COLORS.bg });
    return new StyledText(chunks);
  }

  const numberStyle = { fg: COLORS.muted, bg: contentStyle.bg };
  if (hasLeftBorder) {
    appendDiffVerticalBorder(chunks, borderFg);
  }
  let remainingWidth = width - 1 - (hasLeftBorder ? 1 : 0);
  remainingWidth -= appendClippedStyledChunk(chunks, row.lineNumber, remainingWidth, numberStyle);
  remainingWidth -= appendClippedStyledChunk(chunks, " ", remainingWidth, numberStyle);
  remainingWidth -= appendClippedStyledChunk(chunks, row.sign, remainingWidth, signStyle(row.sign, contentStyle.bg));
  remainingWidth -= appendClippedStyledChunk(chunks, " ", remainingWidth, contentStyle);
  remainingWidth -= appendDiffTextChunks(chunks, row, remainingWidth, contentStyle);
  if (remainingWidth > 0) {
    appendStyledChunk(chunks, " ".repeat(remainingWidth), contentStyle);
  }
  appendDiffVerticalBorder(chunks, borderFg);
  return new StyledText(chunks);
}

export function formatDiffViewportFileHeaderRows(file: DiffFile, width: number, selected: boolean, hasLeadingBorder: boolean, hasLeftBorder: boolean, borderFg: string): StyledText[] {
  return [
    ...(hasLeadingBorder ? [formatDiffViewportBottomBorder(width, hasLeftBorder, borderFg)] : []),
    formatDiffViewportFileHeader(file, width, selected, hasLeftBorder, borderFg),
  ];
}

export function formatDiffViewportBottomBorder(width: number, hasLeftBorder: boolean, borderFg: string): StyledText {
  return formatDiffViewportHorizontalRule(width, COLORS.bg, hasLeftBorder, borderFg, "bottom");
}

function formatDiffViewportFileHeader(file: DiffFile, width: number, selected: boolean, hasLeftBorder: boolean, borderFg: string): StyledText {
  const chunks: TextChunk[] = [];
  if (width <= 1) {
    appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: borderFg, bg: COLORS.bg });
    return new StyledText(chunks);
  }

  const bg = selected ? COLORS.selected : COLORS.diffHeaderBg;
  const statsWidth = fileHeaderStatsText(file).length;
  const contentWidth = Math.max(0, width - 1 - (hasLeftBorder ? 1 : 0));
  const prefix = "> ";
  if (contentWidth === 0) {
    if (hasLeftBorder) {
      appendDiffVerticalBorder(chunks, borderFg);
    }
    appendDiffVerticalBorder(chunks, borderFg);
    return new StyledText(chunks);
  }
  if (contentWidth < prefix.length + statsWidth + 2) {
    const label = truncateToWidth(`${prefix}${file.filePath}`, contentWidth);
    if (hasLeftBorder) {
      appendDiffVerticalBorder(chunks, borderFg);
    }
    appendStyledChunk(chunks, label.padEnd(contentWidth), { fg: COLORS.fileName, bg });
    appendDiffVerticalBorder(chunks, borderFg);
    return new StyledText(chunks);
  }

  const pathWidth = Math.max(1, contentWidth - prefix.length - statsWidth - 2);
  const filePath = truncateToWidth(file.filePath, pathWidth);
  const paddingWidth = Math.max(1, contentWidth - prefix.length - filePath.length - statsWidth);

  if (hasLeftBorder) {
    appendDiffVerticalBorder(chunks, borderFg);
  }
  appendStyledChunk(chunks, prefix, { fg: COLORS.statInfo, bg });
  appendStyledChunk(chunks, filePath, { fg: COLORS.fileName, bg });
  appendStyledChunk(chunks, " ".repeat(paddingWidth), { fg: COLORS.text, bg });
  appendStyledFileHeaderStats(chunks, file, bg);
  appendDiffVerticalBorder(chunks, borderFg);
  return new StyledText(chunks);
}

function formatDiffViewportHorizontalRule(width: number, bg: string, hasLeftBorder: boolean, borderFg: string, edge: "top" | "bottom"): StyledText {
  const chunks: TextChunk[] = [];
  if (width <= 1) {
    appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: borderFg, bg: COLORS.bg });
    return new StyledText(chunks);
  }

  if (hasLeftBorder) {
    appendDiffVerticalBorder(chunks, borderFg);
  }
  const contentWidth = Math.max(0, width - 1 - (hasLeftBorder ? 1 : 0));
  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(contentWidth), { fg: borderFg, bg });
  appendStyledChunk(chunks, edge === "top" ? NAV_BORDER.topRight : NAV_BORDER.bottomRight, { fg: borderFg, bg: COLORS.bg });
  return new StyledText(chunks);
}

export function visibleLineIndexes(
  lines: DiffLineRef[],
  scrollTop: number,
  viewportRows: number,
  width: number,
  overscanRows: number,
): number[] {
  if (lines.length === 0) {
    return [];
  }

  const visibleTop = Math.max(0, scrollTop - overscanRows);
  const visibleBottom = Math.max(visibleTop, scrollTop + viewportRows + overscanRows - 1);
  const indexes: number[] = [];
  let row = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    const lineHeight = formatDiffRows(line, width).length;
    const lineTop = row;
    const lineBottom = row + lineHeight - 1;
    row += lineHeight;

    if (lineBottom < visibleTop) {
      continue;
    }
    if (lineTop > visibleBottom) {
      break;
    }
    indexes.push(index);
  }
  return indexes;
}

function appendStyledFileHeaderStats(chunks: TextChunk[], file: DiffFile, bg: string): void {
  appendStyledChunk(chunks, "(", { fg: COLORS.muted, bg });
  appendStyledChunk(chunks, `+${file.additions}`, { fg: COLORS.statAdd, bg });
  appendStyledChunk(chunks, "/", { fg: COLORS.muted, bg });
  appendStyledChunk(chunks, `-${file.removals}`, { fg: COLORS.statRemove, bg });
  appendStyledChunk(chunks, ")", { fg: COLORS.muted, bg });
}

function fileHeaderStatsText(file: DiffFile): string {
  return `(+${file.additions}/-${file.removals})`;
}

export function lineFg(line: DiffLineRef): string {
  if (line.kind === "add") {
    return COLORS.addFg;
  }
  if (line.kind === "remove") {
    return COLORS.removeFg;
  }
  if (line.kind === "hunk") {
    return COLORS.hunkFg;
  }
  return COLORS.text;
}

export function lineBg(line: DiffLineRef, fullFileHighlights?: Map<number, FullFileLineHighlight>): string {
  const fullFileHighlight = line.newLine === null ? null : fullFileHighlights?.get(line.newLine);
  if (fullFileHighlight === "added") {
    return COLORS.addBg;
  }
  if (fullFileHighlight === "modified") {
    return COLORS.modifiedBg;
  }
  if (line.kind === "add") {
    return COLORS.addBg;
  }
  if (line.kind === "remove") {
    return COLORS.removeBg;
  }
  if (line.kind === "hunk") {
    return COLORS.hunkBg;
  }
  return COLORS.bg;
}

export function fullFileLineHighlights(file: DiffFile): Map<number, FullFileLineHighlight> {
  const highlights = new Map<number, FullFileLineHighlight>();
  let changeBlock: DiffLineRef[] = [];

  const flushChangeBlock = () => {
    if (changeBlock.length === 0) {
      return;
    }

    const hasRemoval = changeBlock.some((line) => line.kind === "remove");
    const highlight: FullFileLineHighlight = hasRemoval ? "modified" : "added";
    for (const line of changeBlock) {
      if (line.kind === "add" && line.newLine !== null) {
        highlights.set(line.newLine, highlight);
      }
    }
    changeBlock = [];
  };

  for (const line of file.lines) {
    if (line.kind === "add" || line.kind === "remove") {
      changeBlock.push(line);
      continue;
    }
    flushChangeBlock();
  }
  flushChangeBlock();

  return highlights;
}

function appendDiffVerticalBorder(chunks: TextChunk[], borderFg: string): void {
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: borderFg, bg: COLORS.bg });
}

function appendClippedStyledChunk(chunks: TextChunk[], text: string, width: number, style: TextStyle): number {
  if (width <= 0) {
    return 0;
  }
  const clipped = text.slice(0, width);
  if (clipped.length > 0) {
    appendStyledChunk(chunks, clipped, style);
  }
  return clipped.length;
}

function appendDiffTextChunks(chunks: TextChunk[], row: DiffVisualRow, width: number, style: TextStyle): number {
  if (!row.syntaxChunks || row.syntaxChunks.length === 0) {
    return appendClippedStyledChunk(chunks, row.text, width, style);
  }

  let usedWidth = 0;
  for (const chunk of row.syntaxChunks) {
    if (usedWidth >= width) {
      break;
    }
    const availableWidth = width - usedWidth;
    const text = chunk.text.slice(0, availableWidth);
    if (text.length === 0) {
      continue;
    }
    chunks.push({
      __isChunk: true,
      text,
      fg: chunk.fg ?? parseColor(style.fg),
      bg: parseColor(style.bg),
      ...(chunk.attributes !== undefined ? { attributes: chunk.attributes } : {}),
      ...(chunk.link ? { link: chunk.link } : {}),
    });
    usedWidth += text.length;
  }
  return usedWidth;
}

function signStyle(sign: string, bg: string): TextStyle {
  if (sign === "+") {
    return { fg: COLORS.statAdd, bg };
  }
  if (sign === "-") {
    return { fg: COLORS.statRemove, bg };
  }
  return { fg: COLORS.muted, bg };
}

function diffLinePrefixWidth(): number {
  return DIFF_LINE_NUMBER_WIDTH + 3;
}

function formatLineNumber(lineNumber: number | null): string {
  if (lineNumber === null) {
    return " ".repeat(DIFF_LINE_NUMBER_WIDTH);
  }
  return truncateLineNumber(String(lineNumber));
}

function truncateLineNumber(value: string): string {
  if (value.length <= DIFF_LINE_NUMBER_WIDTH) {
    return value.padStart(DIFF_LINE_NUMBER_WIDTH);
  }
  return value.slice(-DIFF_LINE_NUMBER_WIDTH);
}

function diffDisplayLineNumber(line: DiffLineRef): number | null {
  if (line.kind === "remove") {
    return line.oldLine;
  }
  if (line.kind === "hunk") {
    return null;
  }
  return line.newLine ?? line.oldLine;
}

function diffLineSign(line: DiffLineRef): string {
  if (line.kind === "add") {
    return "+";
  }
  if (line.kind === "remove") {
    return "-";
  }
  if (line.kind === "hunk") {
    return "@";
  }
  return " ";
}

function sliceTextChunks(chunks: TextChunk[], start: number, width: number): TextChunk[] {
  const end = start + width;
  const slicedChunks: TextChunk[] = [];
  let chunkStart = 0;
  for (const chunk of chunks) {
    const chunkEnd = chunkStart + chunk.text.length;
    if (chunkEnd <= start) {
      chunkStart = chunkEnd;
      continue;
    }
    if (chunkStart >= end) {
      break;
    }

    const sliceStart = Math.max(0, start - chunkStart);
    const sliceEnd = Math.min(chunk.text.length, end - chunkStart);
    const text = chunk.text.slice(sliceStart, sliceEnd);
    if (text.length > 0) {
      slicedChunks.push({ ...chunk, text });
    }
    chunkStart = chunkEnd;
  }
  return slicedChunks;
}

function wrapTextLineWithOffsets(value: string, width: number): Array<{ text: string; start: number }> {
  const contentWidth = Math.max(1, width);
  if (value === "") {
    return [{ text: "", start: 0 }];
  }

  const rows: Array<{ text: string; start: number }> = [];
  let start = 0;
  while (value.length - start > contentWidth) {
    const remaining = value.slice(start);
    const breakAt = remaining.lastIndexOf(" ", contentWidth);
    const rowEnd = breakAt > 0 ? breakAt : contentWidth;
    rows.push({ text: remaining.slice(0, rowEnd), start });
    start += rowEnd;
    if (value[start] === " ") {
      start += 1;
    }
  }
  rows.push({ text: value.slice(start), start });
  return rows;
}
