import { MouseButton, StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import type { DiffBaseCandidate } from "../git";
import { COLORS, DIFF_BORDER_FG, NAV_BORDER } from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateMiddle, truncateToWidth } from "./text";

const MAX_VISIBLE_DIFF_BASE_ROWS = 8;

export class DiffBaseModal {
  readonly renderable: TextRenderable;

  private scrollOffset = 0;
  private visibleRowCount = 1;
  private candidatesLength = 0;

  constructor(
    renderer: CliRenderer,
    private readonly handlers: {
      onSelectCandidate: (index: number) => void;
      onScroll: (delta: number) => void;
    },
  ) {
    this.renderable = new TextRenderable(renderer, {
      id: "gadget-diff-base-modal",
      position: "absolute",
      zIndex: 130,
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
        const candidateIndex = this.scrollOffset + row;
        if (row < 0 || row >= this.visibleRowCount || candidateIndex >= this.candidatesLength) {
          return;
        }
        this.handlers.onSelectCandidate(candidateIndex);
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
    candidates: DiffBaseCandidate[];
    selectedCandidateIndex: number;
    scrollOffset: number;
    currentBaseLabel: string;
    loading: boolean;
    error: string | null;
    rendererWidth: number;
    rendererHeight: number;
  }): void {
    this.renderable.visible = options.open;
    this.scrollOffset = options.scrollOffset;
    this.candidatesLength = options.candidates.length;
    this.visibleRowCount = this.visibleRows(options.candidates.length, options.rendererHeight);
    if (!options.open) {
      return;
    }

    const width = this.width(options.rendererWidth);
    const height = this.renderedHeight(options.candidates.length, options.rendererHeight);
    this.renderable.width = width;
    this.renderable.height = height;
    this.renderable.left = 0;
    this.renderable.top = Math.max(0, options.rendererHeight - height);
    this.renderable.content = formatDiffBaseModal(
      options.candidates,
      options.selectedCandidateIndex,
      options.scrollOffset,
      options.currentBaseLabel,
      options.loading,
      options.error,
      width,
      height,
    );
  }

  visibleRows(candidatesLength: number, rendererHeight: number): number {
    return Math.max(1, this.renderedHeight(candidatesLength, rendererHeight) - 2);
  }

  renderedHeight(candidatesLength: number, rendererHeight: number): number {
    return this.height(candidatesLength, rendererHeight);
  }

  private width(rendererWidth: number): number {
    return Math.max(3, rendererWidth);
  }

  private height(candidatesLength: number, rendererHeight: number): number {
    const maxHeight = Math.max(3, rendererHeight);
    const visibleRows = Math.min(MAX_VISIBLE_DIFF_BASE_ROWS, Math.max(1, candidatesLength));
    return Math.min(maxHeight, visibleRows + 2);
  }
}

function formatDiffBaseModal(
  candidates: DiffBaseCandidate[],
  selectedCandidateIndex: number,
  scrollOffset: number,
  currentBaseLabel: string,
  loading: boolean,
  error: string | null,
  width: number,
  height: number,
): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, width - 2);
  const visibleRows = Math.max(1, height - 2);
  appendDiffBaseTopBorder(chunks, innerWidth);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    const candidateIndex = scrollOffset + rowIndex;
    const candidate = candidates[candidateIndex];
    if (candidate) {
      appendDiffBaseLine(chunks, candidate, innerWidth, candidateIndex === selectedCandidateIndex);
    } else if (error && rowIndex === 0) {
      appendDiffBaseEmptyLine(chunks, innerWidth, error);
    } else if (loading && rowIndex === 0) {
      appendDiffBaseEmptyLine(chunks, innerWidth, "Loading possible diff bases...");
    } else {
      appendDiffBaseEmptyLine(chunks, innerWidth, candidates.length === 0 && rowIndex === 0 ? "No candidate diff bases found" : "");
    }
  }
  appendPlainChunk(chunks, "\n");
  appendDiffBaseBottomBorder(chunks, innerWidth, currentBaseLabel);
  return new StyledText(chunks);
}

function appendDiffBaseTopBorder(chunks: TextChunk[], width: number): void {
  const title = " Diff base ";
  const hint = " Down [J] | Up [K] ";
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

function appendDiffBaseLine(chunks: TextChunk[], candidate: DiffBaseCandidate, width: number, selected: boolean): void {
  const bg = selected ? COLORS.selected : COLORS.panel;
  const detail = ` ${candidate.detail}`;
  const source = `[${candidate.source}]`;
  const contentWidth = Math.max(1, width - 2);
  const sourceWidth = source.length;
  const detailWidth = Math.min(detail.length, Math.max(0, Math.floor(contentWidth * 0.35)));
  const refWidth = Math.max(1, contentWidth - sourceWidth - detailWidth - 2);
  const ref = truncateMiddle(candidate.label, refWidth);
  const detailLabel = detailWidth > 0 ? truncateToWidth(detail, detailWidth) : "";
  const paddingWidth = Math.max(0, contentWidth - sourceWidth - ref.length - detailLabel.length - 2);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg });
  appendStyledChunk(chunks, source, { fg: COLORS.statInfo, bg });
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg });
  appendStyledChunk(chunks, ref, { fg: selected ? "#ffffff" : COLORS.text, bg });
  appendStyledChunk(chunks, " ".repeat(paddingWidth), { fg: COLORS.text, bg });
  appendStyledChunk(chunks, detailLabel, { fg: COLORS.muted, bg });
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendDiffBaseEmptyLine(chunks: TextChunk[], width: number, text: string): void {
  const contentWidth = Math.max(1, width - 2);
  const value = truncateToWidth(text, contentWidth);
  const paddingWidth = Math.max(0, contentWidth - value.length);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, value, { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, " ".repeat(paddingWidth + 1), { fg: COLORS.muted, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendDiffBaseBottomBorder(chunks: TextChunk[], width: number, currentBaseLabel: string): void {
  const hint = " Select [Enter] | Close [Esc] ";
  const hintWidth = hint.length <= Math.max(0, width - 2) ? hint.length : 0;
  const labelText = currentBaseLabel ? `Base: ${currentBaseLabel}` : "";
  const labelWidth = Math.max(0, width - hintWidth - 3);
  const label = truncateToWidth(labelText, labelWidth);
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
