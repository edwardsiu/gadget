import { StyledText, TextRenderable, type CliRenderer, type TextChunk } from "@opentui/core";
import {
  COLORS,
  DIFF_BORDER_FG,
  FILE_MODAL_MARGIN_X,
  FILE_MODAL_MARGIN_Y,
  HELP_MODAL_ROWS,
  HELP_MODAL_WIDTH,
  NAV_BORDER,
} from "./theme";
import { appendPlainChunk, appendStyledChunk, truncateToWidth } from "./text";

export class HelpModal {
  readonly renderable: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.renderable = new TextRenderable(renderer, {
      id: "gadget-help-modal",
      position: "absolute",
      zIndex: 110,
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

  render(options: { open: boolean; rendererWidth: number; rendererHeight: number }): void {
    this.renderable.visible = options.open;
    if (!options.open) {
      return;
    }

    const width = this.width(options.rendererWidth);
    const height = this.height(options.rendererHeight);
    this.renderable.width = width;
    this.renderable.height = height;
    this.renderable.left = centeredOffset(options.rendererWidth, width);
    this.renderable.top = centeredOffset(options.rendererHeight, height);
    this.renderable.content = formatHelpModal(width, height);
  }

  private width(rendererWidth: number): number {
    const maxWidth = Math.max(12, rendererWidth - FILE_MODAL_MARGIN_X * 2);
    return Math.min(maxWidth, HELP_MODAL_WIDTH);
  }

  private height(rendererHeight: number): number {
    const maxHeight = Math.max(3, rendererHeight - FILE_MODAL_MARGIN_Y * 2);
    return Math.min(maxHeight, HELP_MODAL_ROWS.length + 2);
  }
}

function formatHelpModal(width: number, height: number): StyledText {
  const chunks: TextChunk[] = [];
  const innerWidth = Math.max(1, width - 2);
  const visibleRows = Math.max(1, height - 2);
  appendHelpModalTopBorder(chunks, innerWidth);
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    appendPlainChunk(chunks, "\n");
    appendHelpModalLine(chunks, HELP_MODAL_ROWS[rowIndex] ?? "", innerWidth);
  }
  appendPlainChunk(chunks, "\n");
  appendHelpModalBottomBorder(chunks, innerWidth);
  return new StyledText(chunks);
}

function appendHelpModalTopBorder(chunks: TextChunk[], width: number): void {
  const title = " Keybindings ";
  appendStyledChunk(chunks, NAV_BORDER.topLeft, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  if (title.length + 1 > width) {
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
    return;
  }

  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, title, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(Math.max(0, width - title.length - 1))}${NAV_BORDER.topRight}`, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function appendHelpModalBottomBorder(chunks: TextChunk[], width: number): void {
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

function appendHelpModalLine(chunks: TextChunk[], text: string, width: number): void {
  const content = truncateToWidth(text, Math.max(1, width - 2));
  const paddingWidth = Math.max(0, width - content.length - 2);
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
  appendStyledChunk(chunks, " ", { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, content, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, `${" ".repeat(paddingWidth)} `, { fg: COLORS.text, bg: COLORS.panel });
  appendStyledChunk(chunks, NAV_BORDER.vertical, { fg: DIFF_BORDER_FG, bg: COLORS.panel });
}

function centeredOffset(outer: number, inner: number): number {
  return Math.max(0, Math.floor((outer - inner) / 2));
}
