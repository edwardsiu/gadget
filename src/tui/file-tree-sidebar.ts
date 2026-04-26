import { MouseButton, StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import { COLORS, DIFF_BORDER_FG, NAV_BORDER } from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateToWidth } from "./text";

export type FileTreeRow =
  | { type: "folder"; path: string; name: string; depth: number; expanded: boolean }
  | { type: "file"; path: string; name: string; depth: number; selected: boolean };

export class FileTreeSidebar {
  readonly renderable: TextRenderable;

  private scrollOffset = 0;
  private visibleRowCount = 1;
  private rows: FileTreeRow[] = [];

  constructor(
    renderer: CliRenderer,
    private readonly handlers: {
      onSelectRow: (row: FileTreeRow) => void;
      onScroll: (delta: number) => void;
    },
  ) {
    this.renderable = new TextRenderable(renderer, {
      id: "gadget-file-tree-sidebar",
      width: 0,
      height: "100%",
      fg: COLORS.text,
      bg: COLORS.panel,
      content: "",
      truncate: true,
      selectable: false,
      visible: false,
      onMouseDown: (event) => {
        if (event.button !== MouseButton.LEFT) {
          return;
        }
        const rowIndex = event.y - this.renderable.screenY - 1;
        const row = this.rows[this.scrollOffset + rowIndex];
        if (rowIndex < 0 || rowIndex >= this.visibleRowCount || !row) {
          return;
        }
        this.handlers.onSelectRow(row);
      },
      onMouseScroll: (event) => {
        const direction = verticalScrollDirection(event.scroll?.direction, event.modifiers.shift);
        if (!direction) {
          return;
        }
        this.handlers.onScroll(direction === "down" ? 1 : -1);
      },
    });
  }

  render(options: {
    open: boolean;
    rows: FileTreeRow[];
    scrollOffset: number;
    width: number;
    height: number;
    loading: boolean;
    currentFilePath: string;
  }): void {
    this.renderable.visible = options.open;
    this.renderable.width = options.open ? options.width : 0;
    this.renderable.height = options.height;
    this.scrollOffset = options.scrollOffset;
    this.rows = options.rows;
    this.visibleRowCount = this.visibleRows(options.height);
    if (!options.open) {
      this.renderable.content = "";
      return;
    }

    this.renderable.content = formatFileTreeSidebar({
      rows: options.rows,
      scrollOffset: options.scrollOffset,
      width: options.width,
      height: options.height,
      loading: options.loading,
      currentFilePath: options.currentFilePath,
    });
  }

  visibleRows(height: number): number {
    return Math.max(1, height - 2);
  }
}

function formatFileTreeSidebar(options: {
  rows: FileTreeRow[];
  scrollOffset: number;
  width: number;
  height: number;
  loading: boolean;
  currentFilePath: string;
}): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, options.width - 2);
  const visibleRows = Math.max(1, options.height - 2);
  appendFileTreeTopBorder(chunks, innerWidth);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    const row = options.rows[options.scrollOffset + rowIndex];
    if (row) {
      appendFileTreeRow(chunks, row, innerWidth);
    } else if (options.loading && rowIndex === 0) {
      appendFileTreeMessage(chunks, "Loading files...", innerWidth);
    } else if (!options.loading && options.rows.length === 0 && rowIndex === 0) {
      appendFileTreeMessage(chunks, "No files", innerWidth);
    } else {
      appendFileTreeMessage(chunks, "", innerWidth);
    }
  }
  appendPlainChunk(chunks, "\n");
  appendFileTreeBottomBorder(chunks, innerWidth, options.currentFilePath);
  return new StyledText(chunks);
}

function appendFileTreeTopBorder(chunks: TextChunk[], width: number): void {
  const title = " Files ";
  const hint = " Close [F] ";
  appendStyledChunk(chunks, NAV_BORDER.topLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, title, { fg: COLORS.text, bg: COLORS.panel });
  const hintLabel = title.length + hint.length + 1 <= width ? hint : "";
  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, width - title.length - hintLabel.length - 1)), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (hintLabel) {
    appendStyledChunk(chunks, hintLabel, { fg: COLORS.muted, bg: COLORS.panel });
  }
  appendStyledChunk(chunks, NAV_BORDER.topRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileTreeBottomBorder(chunks: TextChunk[], width: number, currentFilePath: string): void {
  const label = truncateToWidth(currentFilePath, Math.max(0, width - 3));
  appendStyledChunk(chunks, NAV_BORDER.bottomLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (label) {
    appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    appendStyledChunk(chunks, " ", { bg: COLORS.panel });
    appendStyledChunk(chunks, label, { fg: COLORS.statSelected, bg: COLORS.panel });
    appendStyledChunk(chunks, " ", { bg: COLORS.panel });
    appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, width - label.length - 3)), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  } else {
    appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(width), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  }
  appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileTreeRow(chunks: TextChunk[], row: FileTreeRow, width: number): void {
  const bg = row.type === "file" && row.selected ? COLORS.selected : COLORS.panel;
  const marker = row.type === "folder" ? (row.expanded ? "▾ " : "▸ ") : "  ";
  const indent = "  ".repeat(row.depth);
  const label = row.type === "folder" ? `${marker}${row.name}/` : `${marker}${row.name}`;
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, truncateToWidth(`${indent}${label}`, width).padEnd(width), {
    fg: row.type === "folder" ? COLORS.statInfo : row.selected ? "#ffffff" : COLORS.text,
    bg,
  });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileTreeMessage(chunks: TextChunk[], value: string, width: number): void {
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, truncateToWidth(` ${value}`, width).padEnd(width), { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
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
        : direction === "right"
          ? "down"
          : "up"
    : direction;
  return effectiveDirection === "up" || effectiveDirection === "down" ? effectiveDirection : null;
}
