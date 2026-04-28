import { BoxRenderable, StyledText, TextRenderable, createTextAttributes, parseColor, type CliRenderer, type TextChunk } from "@opentui/core";
import { COLORS, COMMENT_BORDER, MIN_COMMENT_BODY_LINES } from "./theme";
import { clamp } from "./text";
import { wrapTextLine } from "./text";

export type InlineCommentBox = {
  box: BoxRenderable;
  text: TextRenderable;
  height: number;
};

const COMMENT_PADDING = 1;
const COMMENT_CURSOR_ATTRIBUTES = createTextAttributes({ inverse: true });

type CommentLayoutRow = {
  text: string;
  startIndex: number;
  endIndex: number;
  cursorColumn?: number;
};

export function createInlineCommentBox(options: {
  renderer: CliRenderer;
  id?: string;
  value: string;
  width: number;
  submitLabel: string;
  showHints?: boolean;
  showDeleteHint?: boolean;
  cursorVisible?: boolean;
  cursorIndex?: number;
}): InlineCommentBox {
  const height = inlineCommentHeight(options.value, options.width, options.cursorVisible !== undefined, options.cursorIndex);
  const id = options.id ?? "gadget-inline-comment";
  const box = new BoxRenderable(options.renderer, {
    id,
    height,
    width: options.width,
    backgroundColor: COLORS.commentBg,
    flexDirection: "column",
    shouldFill: true,
  });
  const text = new TextRenderable(options.renderer, {
    id: `${id}-text`,
    height,
    width: options.width,
    fg: COLORS.text,
    bg: COLORS.commentBg,
    truncate: true,
    content: formatInlineComment(options.value, options.width, options.submitLabel, options.showHints ?? true, options.showDeleteHint ?? false, options.cursorVisible, options.cursorIndex),
    selectable: false,
  });
  box.add(text);
  return { box, text, height };
}

export function formatInlineComment(
  value: string,
  width: number,
  submitLabel: string,
  showHints = true,
  showDeleteHint = false,
  cursorVisible?: boolean,
  cursorIndex?: number,
): string | StyledText {
  const innerWidth = Math.max(10, width - 2);
  const contentWidth = innerWidth - COMMENT_PADDING;
  const content = wrapCommentLines(value, contentWidth, cursorVisible, cursorIndex);
  const paddedContent = [...content];
  while (paddedContent.length < MIN_COMMENT_BODY_LINES) {
    paddedContent.push("");
  }
  const top = `${COMMENT_BORDER.topLeft}${COMMENT_BORDER.horizontal.repeat(innerWidth)}${COMMENT_BORDER.topRight}`;
  const bottom = showHints
    ? formatCommentBottomBorder(innerWidth, submitLabel, showDeleteHint)
    : `${COMMENT_BORDER.bottomLeft}${COMMENT_BORDER.horizontal.repeat(innerWidth)}${COMMENT_BORDER.bottomRight}`;
  if (cursorVisible === undefined || cursorIndex === undefined) {
    return [top, ...paddedContent.map((line) => borderedLine(`${" ".repeat(COMMENT_PADDING)}${line}`, innerWidth)), bottom].join("\n");
  }

  const cursorRows = layoutCommentRows(value, contentWidth, cursorIndex);
  while (cursorRows.length < MIN_COMMENT_BODY_LINES) {
    cursorRows.push({ text: "", startIndex: value.length, endIndex: value.length });
  }
  return formatCommentWithCursor(top, cursorRows, bottom, innerWidth, cursorVisible);
}

export function inlineCommentHeight(value: string, width: number, showCursor = false, cursorIndex?: number): number {
  const innerWidth = Math.max(10, width - 2);
  return Math.max(MIN_COMMENT_BODY_LINES, wrapCommentLines(value, innerWidth - COMMENT_PADDING, showCursor ? false : undefined, cursorIndex).length) + 2;
}

export function commentCursorIndexAtPoint(value: string, width: number, row: number, column: number): number {
  const contentWidth = Math.max(1, width);
  const layout = layoutCommentRows(value, contentWidth);
  const clampedRow = clamp(row, 0, Math.max(0, layout.length - 1));
  const target = layout[clampedRow] ?? { text: "", startIndex: value.length, endIndex: value.length };
  const clampedColumn = clamp(column, 0, target.text.length);
  return clamp(target.startIndex + clampedColumn, target.startIndex, target.endIndex);
}

export function moveCommentCursorVertically(value: string, width: number, cursorIndex: number, direction: -1 | 1, preferredColumn?: number | null): { index: number; column: number } {
  const contentWidth = Math.max(1, width);
  const layout = layoutCommentRows(value, contentWidth);
  const currentRow = rowIndexForCursor(layout, clamp(cursorIndex, 0, value.length));
  const current = layout[currentRow] ?? { text: "", startIndex: 0, endIndex: 0 };
  const column = preferredColumn ?? clamp(cursorIndex - current.startIndex, 0, current.text.length);
  const targetRow = clamp(currentRow + direction, 0, Math.max(0, layout.length - 1));
  const target = layout[targetRow] ?? current;
  const index = clamp(target.startIndex + column, target.startIndex, target.endIndex);
  return { index, column };
}

function wrapCommentLines(value: string, width: number, cursorVisible?: boolean, cursorIndex?: number): string[] {
  const contentWidth = Math.max(1, width);
  if (cursorVisible !== undefined && cursorIndex !== undefined) {
    return layoutCommentRows(value, contentWidth, cursorIndex).map((row) => row.text);
  }
  const lines = value.split("\n");
  const wrapped = lines.flatMap((line) => wrapTextLine(line, contentWidth));
  return wrapped.length === 0 ? [""] : wrapped;
}

function layoutCommentRows(value: string, width: number, cursorIndex?: number): CommentLayoutRow[] {
  const contentWidth = Math.max(1, width);
  const rows: CommentLayoutRow[] = [];
  let lineStart = 0;

  for (const line of value.split("\n")) {
    const lineEnd = lineStart + line.length;
    if (line.length === 0) {
      rows.push({ text: "", startIndex: lineStart, endIndex: lineStart });
    } else {
      for (let offset = 0; offset < line.length; offset += contentWidth) {
        const startIndex = lineStart + offset;
        const endIndex = Math.min(lineStart + offset + contentWidth, lineEnd);
        rows.push({ text: value.slice(startIndex, endIndex), startIndex, endIndex });
      }
    }
    lineStart = lineEnd + 1;
  }

  if (rows.length === 0) {
    rows.push({ text: "", startIndex: 0, endIndex: 0 });
  }

  if (cursorIndex !== undefined) {
    return rowsWithCursorCell(rows, clamp(cursorIndex, 0, value.length), contentWidth);
  }
  return rows;
}

function rowsWithCursorCell(rows: CommentLayoutRow[], cursorIndex: number, width: number): CommentLayoutRow[] {
  const nextRows = rows.map((row) => ({ ...row }));
  const rowIndex = rowIndexForCursor(nextRows, cursorIndex);
  const row = nextRows[rowIndex];
  if (!row) {
    return nextRows;
  }
  row.cursorColumn = clamp(cursorIndex - row.startIndex, 0, row.text.length);
  if (row.text.length < width) {
    if (row.cursorColumn === row.text.length) {
      row.text = `${row.text} `;
    }
    return nextRows;
  }
  if (row.cursorColumn === row.text.length) {
    delete row.cursorColumn;
    nextRows.splice(rowIndex + 1, 0, { text: " ", startIndex: cursorIndex, endIndex: cursorIndex, cursorColumn: 0 });
  }
  return nextRows;
}

function rowIndexForCursor(rows: CommentLayoutRow[], cursorIndex: number): number {
  const exactStart = rows.findIndex((row) => cursorIndex === row.startIndex);
  if (exactStart >= 0) {
    return exactStart;
  }
  const containing = rows.findIndex((row) => cursorIndex > row.startIndex && cursorIndex <= row.endIndex);
  return containing >= 0 ? containing : Math.max(0, rows.length - 1);
}

function formatCommentWithCursor(top: string, content: CommentLayoutRow[], bottom: string, width: number, cursorVisible: boolean): StyledText {
  const chunks: TextChunk[] = [];
  appendTextChunk(chunks, `${top}\n`);
  content.forEach((row) => {
    appendTextChunk(chunks, COMMENT_BORDER.vertical);
    appendTextChunk(chunks, " ".repeat(COMMENT_PADDING));
    appendCommentContentChunks(chunks, row.text, width - COMMENT_PADDING, cursorVisible ? row.cursorColumn : undefined);
    appendTextChunk(chunks, COMMENT_BORDER.vertical);
    appendTextChunk(chunks, "\n");
  });
  appendTextChunk(chunks, bottom);
  return new StyledText(chunks);
}

function appendCommentContentChunks(chunks: TextChunk[], value: string, width: number, cursorColumn?: number): void {
  const padded = value.padEnd(width);
  if (cursorColumn === undefined) {
    appendTextChunk(chunks, padded);
    return;
  }

  const clampedColumn = clamp(cursorColumn, 0, Math.max(0, width - 1));
  appendTextChunk(chunks, padded.slice(0, clampedColumn));
  appendTextChunk(chunks, padded[clampedColumn] ?? " ", COMMENT_CURSOR_ATTRIBUTES);
  appendTextChunk(chunks, padded.slice(clampedColumn + 1));
}

function appendTextChunk(chunks: TextChunk[], text: string, attributes?: number): void {
  if (text.length === 0) {
    return;
  }
  chunks.push({
    __isChunk: true,
    text,
    fg: parseColor(COLORS.text),
    bg: parseColor(COLORS.commentBg),
    ...(attributes !== undefined ? { attributes } : {}),
  });
}

function borderedLine(value: string, width: number): string {
  const truncated = value.length > width ? value.slice(0, width) : value;
  return `${COMMENT_BORDER.vertical}${truncated.padEnd(width)}${COMMENT_BORDER.vertical}`;
}

function formatCommentBottomBorder(width: number, submitLabel: string, showDeleteHint: boolean): string {
  const deleteHint = showDeleteHint ? " | Delete [Ctrl+X]" : "";
  const hint = ` ${submitLabel} [⏎] | Cancel [Esc]${deleteHint} `;
  if (hint.length > width) {
    return `${COMMENT_BORDER.bottomLeft}${COMMENT_BORDER.horizontal.repeat(width)}${COMMENT_BORDER.bottomRight}`;
  }
  return `${COMMENT_BORDER.bottomLeft}${COMMENT_BORDER.horizontal.repeat(width - hint.length)}${hint}${COMMENT_BORDER.bottomRight}`;
}
