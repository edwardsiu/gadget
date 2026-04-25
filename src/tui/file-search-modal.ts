import { MouseButton, StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import {
  COLORS,
  DIFF_BORDER_FG,
  NAV_BORDER,
} from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateMiddle, truncateToWidth } from "./text";

const MAX_VISIBLE_FILE_SEARCH_ROWS = 10;

export type FuzzyFileMatch = {
  filePath: string;
  score: number;
};

export class FileSearchModal {
  readonly renderable: TextRenderable;

  private scrollOffset = 0;
  private visibleRowCount = 1;
  private matchesLength = 0;

  constructor(
    renderer: CliRenderer,
    private readonly handlers: {
      onSelectMatch: (index: number) => void;
      onScroll: (delta: number) => void;
    },
  ) {
    this.renderable = new TextRenderable(renderer, {
      id: "gadget-file-search-modal",
      position: "absolute",
      zIndex: 120,
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
        if (event.button !== MouseButton.LEFT) {
          return;
        }
        const row = event.y - this.renderable.screenY - 2;
        const matchIndex = this.scrollOffset + row;
        if (row < 0 || row >= this.visibleRowCount || matchIndex >= this.matchesLength) {
          return;
        }
        this.handlers.onSelectMatch(matchIndex);
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
    query: string;
    matches: FuzzyFileMatch[];
    placeholder: string;
    selectedMatchIndex: number;
    scrollOffset: number;
    currentFilePath: string;
    rendererWidth: number;
    rendererHeight: number;
  }): void {
    this.renderable.visible = options.open;
    this.scrollOffset = options.scrollOffset;
    this.matchesLength = options.matches.length;
    this.visibleRowCount = this.visibleRows(options.matches.length, options.rendererHeight);
    if (!options.open) {
      return;
    }

    const width = this.width(options.rendererWidth);
    const height = this.renderedHeight(options.matches.length, options.rendererHeight);
    this.renderable.width = width;
    this.renderable.height = height;
    this.renderable.left = 0;
    this.renderable.top = Math.max(0, options.rendererHeight - height);
    this.renderable.content = formatFileSearchModal(
      options.query,
      options.matches,
      options.placeholder,
      options.selectedMatchIndex,
      options.scrollOffset,
      options.currentFilePath,
      width,
      height,
    );
  }

  visibleRows(matchesLength: number, rendererHeight: number): number {
    return Math.max(1, this.renderedHeight(matchesLength, rendererHeight) - 3);
  }

  renderedHeight(matchesLength: number, rendererHeight: number): number {
    return this.height(matchesLength, rendererHeight);
  }

  private width(rendererWidth: number): number {
    return Math.max(3, rendererWidth);
  }

  private height(matchesLength: number, rendererHeight: number): number {
    const maxHeight = Math.max(4, rendererHeight);
    const visibleMatchRows = Math.min(MAX_VISIBLE_FILE_SEARCH_ROWS, Math.max(1, matchesLength));
    const naturalHeight = Math.max(4, visibleMatchRows + 3);
    return Math.min(maxHeight, naturalHeight);
  }
}

function formatFileSearchModal(
  query: string,
  matches: FuzzyFileMatch[],
  placeholder: string,
  selectedMatchIndex: number,
  scrollOffset: number,
  currentFilePath: string,
  width: number,
  height: number,
): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, width - 2);
  const visibleRows = Math.max(1, height - 3);
  appendFileSearchTopBorder(chunks, innerWidth);
  appendPlainChunk(chunks, "\n");
  appendFileSearchQueryLine(chunks, query, innerWidth);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    const matchIndex = scrollOffset + rowIndex;
    const match = matches[matchIndex];
    if (match) {
      appendFileSearchMatchLine(chunks, match.filePath, innerWidth, matchIndex === selectedMatchIndex);
    } else {
      appendFileSearchEmptyLine(chunks, innerWidth, matches.length === 0 && rowIndex === 0 ? placeholder : "");
    }
  }
  appendPlainChunk(chunks, "\n");
  appendFileSearchBottomBorder(chunks, innerWidth, currentFilePath);
  return new StyledText(chunks);
}

function appendFileSearchTopBorder(chunks: TextChunk[], width: number): void {
  const title = " Search files ";
  appendStyledChunk(chunks, NAV_BORDER.topLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (title.length + 1 > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, title, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(Math.max(0, width - title.length - 1))}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileSearchQueryLine(chunks: TextChunk[], query: string, width: number): void {
  const contentWidth = Math.max(1, width - 2);
  const value = truncateToWidth(`> ${query}`, contentWidth);
  const paddingWidth = Math.max(0, contentWidth - value.length);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.muted, bg: COLORS.commentBg });
  appendStyledChunk(chunks, value, { fg: COLORS.text, bg: COLORS.commentBg });
  appendStyledChunk(chunks, " ".repeat(paddingWidth + 1), { fg: COLORS.text, bg: COLORS.commentBg });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileSearchMatchLine(chunks: TextChunk[], filePath: string, width: number, selected: boolean): void {
  const bg = selected ? COLORS.selected : COLORS.panel;
  const contentWidth = Math.max(1, width - 2);
  const label = truncateMiddle(filePath, contentWidth);
  const paddingWidth = Math.max(0, contentWidth - label.length);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg });
  appendStyledChunk(chunks, label, { fg: selected ? "#ffffff" : COLORS.text, bg });
  appendStyledChunk(chunks, " ".repeat(paddingWidth + 1), { fg: COLORS.text, bg });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileSearchEmptyLine(chunks: TextChunk[], width: number, text: string): void {
  const contentWidth = Math.max(1, width - 2);
  const value = truncateToWidth(text, contentWidth);
  const paddingWidth = Math.max(0, contentWidth - value.length);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, value, { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, " ".repeat(paddingWidth + 1), { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileSearchBottomBorder(chunks: TextChunk[], width: number, currentFilePath: string): void {
  const hint = " Open [Enter] | Close [Esc] ";
  const hintWidth = hint.length <= Math.max(0, width - 2) ? hint.length : 0;
  const labelWidth = Math.max(0, width - hintWidth - 3);
  const label = truncateToWidth(currentFilePath, labelWidth);
  appendStyledChunk(chunks, NAV_BORDER.bottomLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (label.length === 0 && hintWidth === 0) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.bottomRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  if (label.length > 0) {
    appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    appendStyledChunk(chunks, " ", { bg: COLORS.panel });
    appendStyledChunk(chunks, label, { fg: COLORS.statSelected, bg: COLORS.panel });
    appendStyledChunk(chunks, " ", { bg: COLORS.panel });
  }
  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, width - label.length - hintWidth - (label.length > 0 ? 3 : 0))), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (hintWidth > 0) {
    appendStyledChunk(chunks, hint, { fg: COLORS.muted, bg: COLORS.panel });
  }
  appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
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
