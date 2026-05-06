import { MouseButton, StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import type { AgentFeedbackTurn } from "../types";
import {
  COLORS,
  DIFF_BORDER_FG,
  FILE_MODAL_MARGIN_X,
  FILE_MODAL_MARGIN_Y,
  NAV_BORDER,
} from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateMiddle, truncateToWidth } from "./text";

const FEEDBACK_TURN_MODAL_WIDTH = 78;
const FEEDBACK_TURN_MODAL_MIN_HEIGHT = 5;
const FEEDBACK_TURN_MODAL_MAX_ROWS = 10;

type FeedbackTurnRow = {
  shortcut: string;
  label: string;
  preview: string;
};

export class FeedbackTurnModal {
  readonly renderable: TextRenderable;

  private scrollOffset = 0;
  private visibleRowCount = 1;
  private choiceCount = 0;

  constructor(
    renderer: CliRenderer,
    private readonly handlers: {
      onSelectTurn?: (index: number) => void;
      onScrollTurns?: (delta: number) => void;
    } = {},
  ) {
    this.renderable = new TextRenderable(renderer, {
      id: "gadget-feedback-turn-modal",
      position: "absolute",
      zIndex: 113,
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
      onMouseDown: (event) => {
        if (event.button !== MouseButton.LEFT || this.choiceCount === 0) {
          return;
        }
        const row = event.y - this.renderable.screenY - 1;
        const turnIndex = this.scrollOffset + row;
        if (row < 0 || row >= this.visibleRowCount || turnIndex >= this.choiceCount) {
          return;
        }
        this.handlers.onSelectTurn?.(turnIndex);
      },
      onMouseScroll: (event) => {
        if (this.choiceCount === 0) {
          return;
        }
        const direction = verticalScrollDirection(event.scroll?.direction, event.modifiers.shift);
        if (!direction) {
          return;
        }
        this.handlers.onScrollTurns?.(direction === "down" ? 1 : -1);
      },
    });
  }

  render(options: {
    open: boolean;
    turns: AgentFeedbackTurn[];
    selectedIndex: number;
    scrollOffset: number;
    rendererWidth: number;
    rendererHeight: number;
  }): void {
    this.renderable.visible = options.open;
    this.scrollOffset = options.scrollOffset;
    this.choiceCount = options.turns.length;
    if (!options.open) {
      return;
    }

    const rows = feedbackTurnRows(options.turns);
    const width = this.width(options.rendererWidth);
    const height = this.height(rows.length, options.rendererHeight);
    this.visibleRowCount = Math.max(1, height - 2);
    this.renderable.width = width;
    this.renderable.height = height;
    this.renderable.left = centeredOffset(options.rendererWidth, width);
    this.renderable.top = centeredOffset(options.rendererHeight, height);
    this.renderable.content = formatFeedbackTurnModal(rows, width, height, options.scrollOffset, options.selectedIndex);
  }

  renderedHeight(rowCount: number, rendererHeight: number): number {
    return this.height(rowCount, rendererHeight);
  }

  visibleRows(rowCount: number, rendererHeight: number): number {
    return Math.max(1, this.height(rowCount, rendererHeight) - 2);
  }

  private width(rendererWidth: number): number {
    const maxWidth = Math.max(12, rendererWidth - FILE_MODAL_MARGIN_X * 2);
    return Math.min(maxWidth, FEEDBACK_TURN_MODAL_WIDTH);
  }

  private height(rowCount: number, rendererHeight: number): number {
    const maxHeight = Math.max(FEEDBACK_TURN_MODAL_MIN_HEIGHT, rendererHeight - FILE_MODAL_MARGIN_Y * 2);
    const visibleRows = Math.min(FEEDBACK_TURN_MODAL_MAX_ROWS, Math.max(1, rowCount));
    return Math.min(maxHeight, Math.max(FEEDBACK_TURN_MODAL_MIN_HEIGHT, visibleRows + 2));
  }
}

function feedbackTurnRows(turns: AgentFeedbackTurn[]): FeedbackTurnRow[] {
  return turns.map((turn, index) => ({
    shortcut: quickSelectLabel(index),
    label: turn.label,
    preview: turn.text.replace(/\s+/g, " ").trim(),
  }));
}

function formatFeedbackTurnModal(rows: FeedbackTurnRow[], width: number, height: number, scrollOffset: number, selectedIndex: number): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, width - 2);
  const visibleRows = Math.max(1, height - 2);
  appendFeedbackTurnModalTopBorder(chunks, innerWidth);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    const sourceIndex = scrollOffset + rowIndex;
    appendFeedbackTurnModalLine(chunks, rows[sourceIndex] ?? null, innerWidth, sourceIndex === selectedIndex);
  }
  appendPlainChunk(chunks, "\n");
  appendFeedbackTurnModalBottomBorder(chunks, innerWidth);
  return new StyledText(chunks);
}

function appendFeedbackTurnModalTopBorder(chunks: TextChunk[], width: number): void {
  const title = " Select Agent Turn ";
  appendStyledChunk(chunks, NAV_BORDER.topLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (title.length + 1 > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, title, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(Math.max(0, width - title.length - 1))}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFeedbackTurnModalBottomBorder(chunks: TextChunk[], width: number): void {
  const hint = " Select [Enter] | Cancel [Esc] ";
  appendStyledChunk(chunks, NAV_BORDER.bottomLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (hint.length > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.bottomRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, width - hint.length)), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, hint, { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFeedbackTurnModalLine(chunks: TextChunk[], row: FeedbackTurnRow | null, width: number, selected: boolean): void {
  const contentWidth = Math.max(1, width - 2);
  const content = row ? formatTurnValue(row, contentWidth) : "";
  const paddingWidth = Math.max(0, width - content.length - 2);
  const bg = selected ? COLORS.selected : COLORS.panel;
  const fg = selected ? "#ffffff" : COLORS.text;
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg, bg });
  appendStyledChunk(chunks, content, { fg, bg });
  appendStyledChunk(chunks, `${" ".repeat(paddingWidth)} `, { fg, bg });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function formatTurnValue(row: FeedbackTurnRow, width: number): string {
  const prefix = `[${row.shortcut}] ${row.label}`;
  if (!row.preview) {
    return truncateToWidth(prefix, width);
  }

  const separator = "  ";
  const previewWidth = Math.max(0, width - prefix.length - separator.length);
  if (previewWidth <= 0) {
    return truncateToWidth(prefix, width);
  }
  return `${prefix}${separator}${truncateMiddle(row.preview, previewWidth)}`;
}

function quickSelectLabel(index: number): string {
  return index === 9 ? "0" : String(index + 1);
}

function centeredOffset(outer: number, inner: number): number {
  return Math.max(0, Math.floor((outer - inner) / 2));
}

function verticalScrollDirection(direction: "up" | "down" | "left" | "right" | undefined, shift: boolean): "up" | "down" | null {
  if (!direction) {
    return null;
  }
  const effectiveDirection = shift
    ? direction === "up"
      ? "left"
      : direction === "down"
        ? "right"
        : direction
    : direction;
  return effectiveDirection === "up" || effectiveDirection === "down" ? effectiveDirection : null;
}
