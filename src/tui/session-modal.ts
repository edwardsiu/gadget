import { MouseButton, StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import type { AgentSessionInfo } from "../types";
import {
  COLORS,
  DIFF_BORDER_FG,
  FILE_MODAL_MARGIN_X,
  FILE_MODAL_MARGIN_Y,
  NAV_BORDER,
} from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateMiddle, truncateToWidth } from "./text";
import type { RuntimeSession } from "../runtimes/types";

const SESSION_MODAL_WIDTH = 72;
const SESSION_MODAL_MIN_HEIGHT = 5;

export class SessionModal {
  readonly renderable: TextRenderable;

  private scrollOffset = 0;
  private visibleRowCount = 1;
  private choiceCount = 0;

  constructor(
    renderer: CliRenderer,
    private readonly handlers: {
      onSelectSession?: (index: number) => void;
      onScrollSessions?: (delta: number) => void;
    } = {},
  ) {
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
      onMouseDown: (event) => {
        if (event.button !== MouseButton.LEFT || this.choiceCount === 0) {
          return;
        }
        const row = event.y - this.renderable.screenY - 1;
        const sessionIndex = this.scrollOffset + row;
        if (row < 0 || row >= this.visibleRowCount || sessionIndex >= this.choiceCount) {
          return;
        }
        this.handlers.onSelectSession?.(sessionIndex);
      },
      onMouseScroll: (event) => {
        if (this.choiceCount === 0) {
          return;
        }
        const direction = verticalScrollDirection(event.scroll?.direction, event.modifiers.shift);
        if (!direction) {
          return;
        }
        this.handlers.onScrollSessions?.(direction === "down" ? 1 : -1);
      },
    });
  }

  render(options: {
    open: boolean;
    info: AgentSessionInfo;
    rendererWidth: number;
    rendererHeight: number;
    choices?: RuntimeSession[];
    selectedChoiceIndex?: number;
    scrollOffset?: number;
  }): void {
    this.renderable.visible = options.open;
    this.scrollOffset = options.scrollOffset ?? 0;
    this.choiceCount = options.choices?.length ?? 0;
    if (!options.open) {
      return;
    }

    const rows = options.choices
      ? sessionChoiceRows(options.choices)
      : sessionRows(options.info).map((row) => ({ ...row, selected: false }));
    const width = this.width(options.rendererWidth);
    const height = this.height(rows.length, options.rendererHeight);
    this.visibleRowCount = Math.max(1, height - 2);
    this.renderable.width = width;
    this.renderable.height = height;
    this.renderable.left = centeredOffset(options.rendererWidth, width);
    this.renderable.top = centeredOffset(options.rendererHeight, height);
    this.renderable.content = formatSessionModal(rows, width, height, options.scrollOffset ?? 0, options.selectedChoiceIndex ?? -1, Boolean(options.choices));
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

function sessionChoiceRows(sessions: RuntimeSession[]): Array<{ label: string | null; value: string; selected: boolean }> {
  return sessions.map((session, index) => {
    const preview = session.preview.trim() || "(no preview yet)";
    return {
      label: String(index + 1),
      value: `${session.client} ${session.worktreeName} ${session.status} ${session.cwd} ${preview}`,
      selected: false,
    };
  });
}

function formatSessionModal(
  rows: Array<{ label: string | null; value: string; selected: boolean }>,
  width: number,
  height: number,
  scrollOffset: number,
  selectedIndex: number,
  selecting: boolean,
): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, width - 2);
  const visibleRows = Math.max(1, height - 2);
  appendSessionModalTopBorder(chunks, innerWidth, selecting);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    const sourceIndex = scrollOffset + rowIndex;
    const row = rows[sourceIndex] ?? null;
    appendSessionModalLine(chunks, row, innerWidth, sourceIndex === selectedIndex);
  }
  appendPlainChunk(chunks, "\n");
  appendSessionModalBottomBorder(chunks, innerWidth, selecting);
  return new StyledText(chunks);
}

function appendSessionModalTopBorder(chunks: TextChunk[], width: number, selecting: boolean): void {
  const title = selecting ? " Select Session " : " Session ";
  appendStyledChunk(chunks, NAV_BORDER.topLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (title.length + 1 > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, title, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(Math.max(0, width - title.length - 1))}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendSessionModalBottomBorder(chunks: TextChunk[], width: number, selecting: boolean): void {
  const hint = selecting ? " Select [Enter]  Clipboard [Esc] " : " Close [Esc] ";
  appendStyledChunk(chunks, NAV_BORDER.bottomLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (hint.length > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.bottomRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, width - hint.length)), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, hint, { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendSessionModalLine(chunks: TextChunk[], row: { label: string | null; value: string } | null, width: number, selected: boolean): void {
  const contentWidth = Math.max(1, width - 2);
  let content = "";
  if (row) {
    content = row.label ? formatLabeledValue(row.label, row.value, contentWidth) : truncateToWidth(row.value, contentWidth);
  }
  const paddingWidth = Math.max(0, width - content.length - 2);
  const bg = selected ? COLORS.selected : COLORS.panel;
  const fg = selected ? "#ffffff" : COLORS.text;
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg, bg });
  appendStyledChunk(chunks, content, { fg, bg });
  appendStyledChunk(chunks, `${" ".repeat(paddingWidth)} `, { fg, bg });
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
