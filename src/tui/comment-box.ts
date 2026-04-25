import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { COLORS, COMMENT_BORDER, MIN_COMMENT_BODY_LINES } from "./theme";
import { wrapTextLine } from "./text";

export type InlineCommentBox = {
  box: BoxRenderable;
  text: TextRenderable;
  height: number;
};

const COMMENT_CURSOR = "█";
const COMMENT_PADDING = 1;

export function createInlineCommentBox(options: {
  renderer: CliRenderer;
  id?: string;
  value: string;
  width: number;
  submitLabel: string;
  showHints?: boolean;
  showDeleteHint?: boolean;
  cursorVisible?: boolean;
}): InlineCommentBox {
  const height = inlineCommentHeight(options.value, options.width, options.cursorVisible !== undefined);
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
    content: formatInlineComment(options.value, options.width, options.submitLabel, options.showHints ?? true, options.showDeleteHint ?? false, options.cursorVisible),
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
): string {
  const innerWidth = Math.max(10, width - 2);
  const content = wrapCommentLines(value, innerWidth - COMMENT_PADDING, cursorVisible);
  const paddedContent = [...content];
  while (paddedContent.length < MIN_COMMENT_BODY_LINES) {
    paddedContent.push("");
  }
  const top = `${COMMENT_BORDER.topLeft}${COMMENT_BORDER.horizontal.repeat(innerWidth)}${COMMENT_BORDER.topRight}`;
  const bottom = showHints
    ? formatCommentBottomBorder(innerWidth, submitLabel, showDeleteHint)
    : `${COMMENT_BORDER.bottomLeft}${COMMENT_BORDER.horizontal.repeat(innerWidth)}${COMMENT_BORDER.bottomRight}`;
  return [top, ...paddedContent.map((line) => borderedLine(`${" ".repeat(COMMENT_PADDING)}${line}`, innerWidth)), bottom].join("\n");
}

export function inlineCommentHeight(value: string, width: number, showCursor = false): number {
  const innerWidth = Math.max(10, width - 2);
  return Math.max(MIN_COMMENT_BODY_LINES, wrapCommentLines(value, innerWidth - COMMENT_PADDING, showCursor ? false : undefined).length) + 2;
}

function wrapCommentLines(value: string, width: number, cursorVisible?: boolean): string[] {
  const contentWidth = Math.max(1, width);
  const lines = commentLinesWithCursor(value, cursorVisible);
  const wrapped = lines.flatMap((line) => wrapTextLine(line, contentWidth));
  return wrapped.length === 0 ? [""] : wrapped;
}

function commentLinesWithCursor(value: string, cursorVisible: boolean | undefined): string[] {
  const lines = value.split("\n");
  if (cursorVisible === undefined) {
    return lines;
  }
  lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""}${cursorVisible ? COMMENT_CURSOR : " "}`;
  return lines;
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
