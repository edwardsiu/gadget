import { MouseButton, StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import type { DiffFile } from "../types";
import { COLORS, DIFF_BORDER_FG, NAV_BORDER } from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateToWidth } from "./text";

const MAX_VISIBLE_FILE_ROWS = 10;

export class FileSelectorModal {
  readonly renderable: TextRenderable;

  private scrollOffset = 0;
  private visibleRowCount = 1;
  private filesLength = 0;

  constructor(
    renderer: CliRenderer,
    private readonly handlers: {
      onSelectFile: (index: number) => void;
      onScroll: (delta: number) => void;
    },
  ) {
    this.renderable = new TextRenderable(renderer, {
      id: "gadget-file-modal",
      position: "absolute",
      zIndex: 100,
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
        const row = event.y - this.renderable.screenY - 1;
        const fileIndex = this.scrollOffset + row;
        if (row < 0 || row >= this.visibleRowCount || fileIndex >= this.filesLength) {
          return;
        }
        this.handlers.onSelectFile(fileIndex);
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
    files: DiffFile[];
    selectedFileIndex: number;
    scrollOffset: number;
    currentFilePath: string;
    rendererWidth: number;
    rendererHeight: number;
  }): void {
    this.renderable.visible = options.open;
    this.scrollOffset = options.scrollOffset;
    this.filesLength = options.files.length;
    this.visibleRowCount = this.visibleRows(options.files, options.rendererHeight);
    if (!options.open) {
      return;
    }

    const width = this.width(options.rendererWidth);
    const height = this.renderedHeight(options.files, options.rendererHeight);
    this.renderable.width = width;
    this.renderable.height = height;
    this.renderable.left = 0;
    this.renderable.top = Math.max(0, options.rendererHeight - height);
    this.renderable.content = formatFileModal(
      options.files,
      options.selectedFileIndex,
      options.scrollOffset,
      options.currentFilePath,
      width,
      height,
    );
  }

  visibleRows(files: DiffFile[], rendererHeight: number): number {
    return Math.max(1, this.renderedHeight(files, rendererHeight) - 2);
  }

  renderedHeight(files: DiffFile[], rendererHeight: number): number {
    return this.height(files.length, rendererHeight);
  }

  private width(rendererWidth: number): number {
    return Math.max(3, rendererWidth);
  }

  private height(filesLength: number, rendererHeight: number): number {
    const maxHeight = Math.max(3, rendererHeight);
    const visibleFileRows = Math.min(MAX_VISIBLE_FILE_ROWS, Math.max(1, filesLength));
    return Math.min(maxHeight, visibleFileRows + 2);
  }
}

function formatFileModal(
  files: DiffFile[],
  selectedFileIndex: number,
  scrollOffset: number,
  currentFilePath: string,
  width: number,
  height: number,
): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, width - 2);
  const visibleRows = Math.max(1, height - 2);
  appendFileModalTopBorder(chunks, innerWidth);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    const fileIndex = scrollOffset + rowIndex;
    const file = files[fileIndex];
    if (file) {
      appendFileModalLine(chunks, file, innerWidth, fileIndex === selectedFileIndex);
    } else {
      appendEmptyFileModalLine(chunks, innerWidth);
    }
  }
  appendPlainChunk(chunks, "\n");
  appendFileModalBottomBorder(chunks, innerWidth, currentFilePath);
  return new StyledText(chunks);
}

function appendFileModalTopBorder(chunks: TextChunk[], width: number): void {
  const title = " Files ";
  const hint = " Down [J] | Up [K] | Close [P] ";
  appendStyledChunk(chunks, NAV_BORDER.topLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (title.length + 1 > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  const titleWidth = title.length + 1;
  const hintLabel = titleWidth + hint.length <= width ? hint : "";
  const fillerWidth = Math.max(0, width - titleWidth - hintLabel.length);
  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, title, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(fillerWidth), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (hintLabel) {
    appendStyledChunk(chunks, hintLabel, { fg: COLORS.muted, bg: COLORS.panel });
  }
  appendStyledChunk(chunks, NAV_BORDER.topRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileModalBottomBorder(chunks: TextChunk[], width: number, currentFilePath: string): void {
  const labelWidth = Math.max(0, width - 3);
  const label = truncateToWidth(currentFilePath, labelWidth);
  appendStyledChunk(chunks, NAV_BORDER.bottomLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (label.length === 0) {
    appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(width), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { bg: COLORS.panel });
  appendStyledChunk(chunks, label, { fg: COLORS.statSelected, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, width - label.length - 3)), { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendFileModalLine(chunks: TextChunk[], file: DiffFile, width: number, selected: boolean): void {
  const bg = selected ? COLORS.selected : COLORS.panel;
  const stats = fileModalStatsText(file);
  const contentWidth = Math.max(1, width - 2);
  const filePathWidth = Math.max(1, contentWidth - stats.length - 1);
  const filePath = styledFilePathParts(file.filePath, filePathWidth);
  const paddingWidth = Math.max(0, contentWidth - filePath.width - stats.length - 1);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg });
  if (filePath.prefix) {
    appendStyledChunk(chunks, filePath.prefix, { fg: selected ? COLORS.text : COLORS.muted, bg });
  }
  appendStyledChunk(chunks, filePath.basename, { fg: COLORS.fileName, bg });
  appendStyledChunk(chunks, " ".repeat(paddingWidth + 1), { fg: COLORS.text, bg });
  appendStyledFileModalStats(chunks, file, bg);
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function styledFilePathParts(filePath: string, width: number): { prefix: string; basename: string; width: number } {
  const usableWidth = Math.max(1, width);
  const lastSlashIndex = filePath.lastIndexOf("/");
  const rawPrefix = lastSlashIndex >= 0 ? filePath.slice(0, lastSlashIndex + 1) : "";
  const rawBasename = lastSlashIndex >= 0 ? filePath.slice(lastSlashIndex + 1) : filePath;
  if (filePath.length <= usableWidth) {
    return {
      prefix: rawPrefix,
      basename: rawBasename,
      width: filePath.length,
    };
  }
  if (rawBasename.length >= usableWidth) {
    const basename = truncateToWidth(rawBasename, usableWidth);
    return {
      prefix: "",
      basename,
      width: basename.length,
    };
  }

  const prefix = truncateToWidth(rawPrefix, usableWidth - rawBasename.length);
  return {
    prefix,
    basename: rawBasename,
    width: prefix.length + rawBasename.length,
  };
}

function appendEmptyFileModalLine(chunks: TextChunk[], width: number): void {
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ".repeat(width), { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendStyledFileModalStats(chunks: TextChunk[], file: DiffFile, bg: string): void {
  appendStyledChunk(chunks, "(", { fg: COLORS.muted, bg });
  appendStyledChunk(chunks, `+${file.additions}`, { fg: COLORS.statAdd, bg });
  appendStyledChunk(chunks, "/", { fg: COLORS.muted, bg });
  appendStyledChunk(chunks, `-${file.removals}`, { fg: COLORS.statRemove, bg });
  appendStyledChunk(chunks, ")", { fg: COLORS.muted, bg });
}

function fileModalStatsText(file: DiffFile): string {
  return `(+${file.additions}/-${file.removals})`;
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
