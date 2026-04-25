import { StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import type { AgentSessionInfo } from "../types";
import {
  COLORS,
  DIFF_BORDER_FG,
  FILE_MODAL_MARGIN_X,
  FILE_MODAL_MARGIN_Y,
  NAV_BORDER,
} from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateMiddle, truncateToWidth } from "./text";

const SESSION_MODAL_WIDTH = 72;
const SESSION_MODAL_MIN_HEIGHT = 5;

export class SessionModal {
  readonly renderable: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.renderable = new TextRenderable(renderer, {
      id: "gadget-session-modal",
      position: "absolute",
      zIndex: 112,
      top: 0,
      left: 0,
      width: 1,
      height: 1,
      fg: COLORS.text,
      bg: COLORS.panel,
      content: "",
      visible: false,
      truncate: true,
      selectable: false,
    });
  }

  render(options: { open: boolean; info: AgentSessionInfo; rendererWidth: number; rendererHeight: number }): void {
    this.renderable.visible = options.open;
    if (!options.open) {
      return;
    }

    const rows = sessionRows(options.info);
    const width = this.width(options.rendererWidth);
    const height = this.height(rows.length, options.rendererHeight);
    this.renderable.width = width;
    this.renderable.height = height;
    this.renderable.left = centeredOffset(options.rendererWidth, width);
    this.renderable.top = centeredOffset(options.rendererHeight, height);
    this.renderable.content = formatSessionModal(rows, width, height);
  }

  private width(rendererWidth: number): number {
    const maxWidth = Math.max(12, rendererWidth - FILE_MODAL_MARGIN_X * 2);
    return Math.min(maxWidth, SESSION_MODAL_WIDTH);
  }

  private height(rowCount: number, rendererHeight: number): number {
    const maxHeight = Math.max(SESSION_MODAL_MIN_HEIGHT, rendererHeight - FILE_MODAL_MARGIN_Y * 2);
    return Math.min(maxHeight, Math.max(SESSION_MODAL_MIN_HEIGHT, rowCount + 2));
  }
}

function sessionRows(info: AgentSessionInfo): Array<{ label: string | null; value: string }> {
  if (!info.sessionId && (!info.details || info.details.length === 0)) {
    return [{ label: null, value: info.mode }];
  }

  const rows = [{ label: "Mode", value: info.mode }];
  if (info.sessionId) {
    rows.push({ label: "Session ID", value: info.sessionId });
  }
  rows.push(...(info.details ?? []));
  return rows;
}

function formatSessionModal(rows: Array<{ label: string | null; value: string }>, width: number, height: number): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, width - 2);
  const visibleRows = Math.max(1, height - 2);
  appendSessionModalTopBorder(chunks, innerWidth);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    appendSessionModalLine(chunks, rows[rowIndex] ?? null, innerWidth);
  }
  appendPlainChunk(chunks, "\n");
  appendSessionModalBottomBorder(chunks, innerWidth);
  return new StyledText(chunks);
}

function appendSessionModalTopBorder(chunks: TextChunk[], width: number): void {
  const title = " Session ";
  appendStyledChunk(chunks, NAV_BORDER.topLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (title.length + 1 > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, title, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(Math.max(0, width - title.length - 1))}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendSessionModalBottomBorder(chunks: TextChunk[], width: number): void {
  const hint = " Close [Esc] ";
  appendStyledChunk(chunks, NAV_BORDER.bottomLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (hint.length > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.bottomRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, width - hint.length)), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, hint, { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendSessionModalLine(chunks: TextChunk[], row: { label: string | null; value: string } | null, width: number): void {
  const contentWidth = Math.max(1, width - 2);
  let content = "";
  if (row) {
    content = row.label ? formatLabeledValue(row.label, row.value, contentWidth) : truncateToWidth(row.value, contentWidth);
  }
  const paddingWidth = Math.max(0, width - content.length - 2);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, content, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, `${" ".repeat(paddingWidth)} `, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function formatLabeledValue(label: string, value: string, width: number): string {
  const prefix = `${label}: `;
  if (prefix.length >= width) {
    return truncateToWidth(`${prefix}${value}`, width);
  }
  return `${prefix}${truncateMiddle(value, width - prefix.length)}`;
}

function centeredOffset(outer: number, inner: number): number {
  return Math.max(0, Math.floor((outer - inner) / 2));
}
