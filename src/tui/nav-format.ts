import {
  StyledText,
  type TextChunk,
} from "@opentui/core";
import type { DiffFile } from "../types";
import { appendPlainChunk, appendStyledChunk, truncate, truncateMiddle, truncateToWidth } from "./text";
import {
  COLORS,
  NAV_BORDER,
} from "./theme";

export type NavMode = "normal" | "compact";

export function navWidthFor(mode: NavMode): number {
  return mode === "compact" ? 0 : 34;
}

export function formatDiffTopBar(cwd: string, worktreeName: string, branchName: string, width: number, hasLeftBorder: boolean, borderFg: string, reviewLabel: string): StyledText {
  const usableWidth = Math.max(1, width);
  const chunks: TextChunk[] = [];
  appendDiffTopBorder(chunks, cwd, worktreeName, branchName, usableWidth, hasLeftBorder ? NAV_BORDER.topLeft : null, borderFg, reviewLabel);
  return new StyledText(chunks);
}

export function formatDiffBottomBar(filePath: string, width: number, hasLeftBorder: boolean, borderFg: string, rightHint: string | null): StyledText {
  const usableWidth = Math.max(1, width);
  const chunks: TextChunk[] = [];
  if (usableWidth === 1) {
    appendStyledChunk(chunks, hasLeftBorder ? NAV_BORDER.bottomLeft : NAV_BORDER.bottomRight, { fg: borderFg, bg: COLORS.bg });
    return new StyledText(chunks);
  }

  const lineWidth = usableWidth - 1 - (hasLeftBorder ? 1 : 0);
  const hint = rightHint ? ` ${rightHint} ` : "";
  const hintWidth = hint.length <= Math.max(0, lineWidth - 2) ? hint.length : 0;
  const labelWidth = lineWidth - 3 - hintWidth;
  if (labelWidth <= 0) {
    appendDiffLeftCorner(chunks, hasLeftBorder ? NAV_BORDER.bottomLeft : null, borderFg);
    appendStyledChunk(chunks, `${NAV_BORDER.horizontal.repeat(Math.max(0, lineWidth))}${NAV_BORDER.bottomRight}`, { fg: borderFg, bg: COLORS.bg });
    return new StyledText(chunks);
  }

  const label = truncateToWidth(filePath, labelWidth);
  appendDiffLeftCorner(chunks, hasLeftBorder ? NAV_BORDER.bottomLeft : null, borderFg);
  appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: borderFg, bg: COLORS.bg });
  appendPlainChunk(chunks, " ");
  appendStyledChunk(chunks, label, { fg: COLORS.statSelected });
  appendPlainChunk(chunks, " ");
  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(Math.max(0, labelWidth - label.length)), { fg: borderFg, bg: COLORS.bg });
  if (hintWidth > 0) {
    appendStyledChunk(chunks, hint, { fg: borderFg, bg: COLORS.bg });
  }
  appendStyledChunk(chunks, NAV_BORDER.bottomRight, { fg: borderFg, bg: COLORS.bg });
  return new StyledText(chunks);
}

export function formatNavBox(rows: string[], width: number, height: number, hint: string): string {
  const innerWidth = Math.max(1, width - 2);
  if (height <= 1) {
    return truncate(hint, width);
  }
  if (height === 2) {
    return [
      `${NAV_BORDER.topLeft}${NAV_BORDER.horizontal.repeat(innerWidth)}${NAV_BORDER.topRight}`,
      formatNavHintBottomBorder(hint, innerWidth),
    ].join("\n");
  }

  const visibleRows = rows.slice(0, Math.max(0, height - 2));
  while (visibleRows.length < Math.max(0, height - 2)) {
    visibleRows.push("");
  }
  const top = `${NAV_BORDER.topLeft}${NAV_BORDER.horizontal.repeat(innerWidth)}${NAV_BORDER.topRight}`;
  return [top, ...visibleRows.map((row) => `${NAV_BORDER.vertical}${truncate(row, innerWidth)}${NAV_BORDER.vertical}`), formatNavHintBottomBorder(hint, innerWidth)].join("\n");
}

export function formatFileCardNav(rows: Array<{ file: DiffFile; selected: boolean }>, width: number, height: number, hint: string): StyledText {
  const innerWidth = Math.max(1, width - 2);
  const chunks: TextChunk[] = [];
  if (height <= 1) {
    appendStyledChunk(chunks, truncate(hint, width), { fg: COLORS.muted });
    return new StyledText(chunks);
  }

  appendPlainChunk(chunks, `${NAV_BORDER.topLeft}${NAV_BORDER.horizontal.repeat(innerWidth)}${NAV_BORDER.topRight}\n`);

  const visibleRows = Math.max(0, height - 2);
  let renderedRows = 0;
  for (const row of rows) {
    if (renderedRows >= visibleRows) {
      break;
    }
    appendNavCardLine(chunks, truncate(row.file.filePath, innerWidth - 2), innerWidth, row.selected);
    renderedRows += 1;
    if (renderedRows >= visibleRows) {
      break;
    }
    appendStatsLine(chunks, row.file, innerWidth, row.selected);
    renderedRows += 1;
  }

  while (renderedRows < visibleRows) {
    appendNavCardLine(chunks, "", innerWidth, false);
    renderedRows += 1;
  }

  if (height > 1) {
    appendStyledNavHintBottomBorder(chunks, hint, innerWidth);
  }
  return new StyledText(chunks);
}

function appendDiffTopBorder(
  chunks: TextChunk[],
  cwd: string,
  worktreeName: string,
  branchName: string,
  width: number,
  leftCorner: string | null,
  borderFg: string,
  reviewLabel: string,
): void {
  const help = " Help [?] ";
  if (width === 1) {
    appendStyledChunk(chunks, leftCorner ?? NAV_BORDER.topRight, { fg: borderFg, bg: COLORS.bg });
    return;
  }

  const lineWidth = width - 1 - (leftCorner ? 1 : 0);
  if (lineWidth <= 0) {
    appendDiffLeftCorner(chunks, leftCorner, borderFg);
    appendStyledChunk(chunks, NAV_BORDER.topRight, { fg: borderFg, bg: COLORS.bg });
    return;
  }

  const helpLabel = help.length <= lineWidth ? help : "";
  const reviewText = reviewLabel ? ` ${reviewLabel} ` : "";
  const reviewTextWidth = reviewText.length <= Math.max(0, lineWidth - helpLabel.length) ? reviewText.length : 0;
  const labelWidth = Math.max(0, lineWidth - helpLabel.length - reviewTextWidth - 3);
  const labels = fitDiffTopLabels(cwd, worktreeName, branchName, labelWidth);
  const usedWidth = labels.cwd.length + labels.worktreeSeparator.length + labels.worktree.length + labels.branchSeparator.length + labels.branch.length;
  const labelSegmentWidth = usedWidth > 0 ? usedWidth + 3 : 0;
  const spacerWidth = Math.max(0, lineWidth - labelSegmentWidth - reviewTextWidth - helpLabel.length);

  appendDiffLeftCorner(chunks, leftCorner, borderFg);
  if (usedWidth > 0) {
    appendStyledChunk(chunks, NAV_BORDER.horizontal, { fg: borderFg, bg: COLORS.bg });
    appendStyledChunk(chunks, " ", { bg: COLORS.bg });
    appendStyledChunk(chunks, labels.cwd, { fg: COLORS.statInfo, bg: COLORS.bg });
    appendStyledChunk(chunks, labels.worktreeSeparator, { fg: COLORS.muted, bg: COLORS.bg });
    appendStyledChunk(chunks, labels.worktree, { fg: COLORS.text, bg: COLORS.bg });
    appendStyledChunk(chunks, labels.branchSeparator, { fg: COLORS.muted, bg: COLORS.bg });
    appendStyledChunk(chunks, labels.branch, { fg: COLORS.statMixed, bg: COLORS.bg });
    appendStyledChunk(chunks, " ", { bg: COLORS.bg });
  }
  appendStyledChunk(chunks, NAV_BORDER.horizontal.repeat(spacerWidth), { fg: borderFg, bg: COLORS.bg });
  if (reviewTextWidth > 0) {
    appendStyledChunk(chunks, reviewText, { fg: borderFg, bg: COLORS.bg });
  }
  if (helpLabel.length > 0) {
    appendStyledChunk(chunks, helpLabel, { fg: COLORS.muted, bg: COLORS.bg });
  }
  appendStyledChunk(chunks, NAV_BORDER.topRight, { fg: borderFg, bg: COLORS.bg });
}

function appendDiffLeftCorner(chunks: TextChunk[], leftCorner: string | null, borderFg: string): void {
  if (leftCorner) {
    appendStyledChunk(chunks, leftCorner, { fg: borderFg, bg: COLORS.bg });
  }
}

function fitDiffTopLabels(cwd: string, worktreeName: string, branchName: string, width: number): {
  cwd: string;
  worktreeSeparator: string;
  worktree: string;
  branchSeparator: string;
  branch: string;
} {
  if (width <= 0) {
    return { cwd: "", worktreeSeparator: "", worktree: "", branchSeparator: "", branch: "" };
  }

  const worktreeSeparator = worktreeName ? "  " : "";
  const branchSeparator = branchName ? "  " : "";
  if (branchName === "" || width < branchSeparator.length + 2) {
    return {
      cwd: truncateMiddle(cwd, width),
      worktreeSeparator: "",
      worktree: "",
      branchSeparator: "",
      branch: "",
    };
  }

  const fullWidth = cwd.length + worktreeSeparator.length + worktreeName.length + branchSeparator.length + branchName.length;
  if (fullWidth <= width) {
    return { cwd, worktreeSeparator, worktree: worktreeName, branchSeparator, branch: branchName };
  }

  const minimumBranchWidth = Math.min(branchName.length, Math.max(1, Math.floor(width * 0.35)));
  let branchWidth = minimumBranchWidth;
  let remainingWidth = width - branchSeparator.length - branchWidth;
  if (remainingWidth <= 0) {
    return {
      cwd: truncateMiddle(cwd, width),
      worktreeSeparator: "",
      worktree: "",
      branchSeparator: "",
      branch: "",
    };
  }

  const worktreeBudget = worktreeName ? Math.min(worktreeName.length, Math.max(1, Math.floor(remainingWidth * 0.25))) : 0;
  let worktreeWidth = Math.min(worktreeName.length, worktreeBudget);
  const activeWorktreeSeparator = worktreeWidth > 0 ? worktreeSeparator : "";
  remainingWidth -= activeWorktreeSeparator.length + worktreeWidth;
  if (remainingWidth <= 0) {
    branchWidth = width - branchSeparator.length;
    return {
      cwd: "",
      worktreeSeparator: "",
      worktree: "",
      branchSeparator,
      branch: truncateMiddle(branchName, Math.max(0, branchWidth)),
    };
  }

  let cwdWidth = remainingWidth;
  if (branchName.length <= branchWidth) {
    branchWidth = branchName.length;
    cwdWidth = width - branchSeparator.length - branchWidth - activeWorktreeSeparator.length - worktreeWidth;
  }
  if (worktreeName.length <= worktreeWidth) {
    worktreeWidth = worktreeName.length;
    cwdWidth = width - branchSeparator.length - branchWidth - activeWorktreeSeparator.length - worktreeWidth;
  }

  return {
    cwd: truncateMiddle(cwd, Math.max(0, cwdWidth)),
    worktreeSeparator: activeWorktreeSeparator,
    worktree: truncateMiddle(worktreeName, worktreeWidth),
    branchSeparator,
    branch: truncateMiddle(branchName, branchWidth),
  };
}

function formatNavHintBottomBorder(value: string, width: number): string {
  const hint = ` ${value} `;
  if (hint.length > width) {
    return `${NAV_BORDER.bottomLeft}${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.bottomRight}`;
  }

  const leftWidth = Math.floor((width - hint.length) / 2);
  const rightWidth = width - hint.length - leftWidth;
  return `${NAV_BORDER.bottomLeft}${NAV_BORDER.horizontal.repeat(leftWidth)}${hint}${NAV_BORDER.horizontal.repeat(rightWidth)}${NAV_BORDER.bottomRight}`;
}

function appendStyledNavHintBottomBorder(chunks: TextChunk[], value: string, width: number): void {
  const hint = ` ${value} `;
  if (hint.length > width) {
    appendPlainChunk(chunks, `${NAV_BORDER.bottomLeft}${NAV_BORDER.horizontal.repeat(width)}${NAV_BORDER.bottomRight}`);
    return;
  }

  const leftWidth = Math.floor((width - hint.length) / 2);
  const rightWidth = width - hint.length - leftWidth;
  appendPlainChunk(chunks, `${NAV_BORDER.bottomLeft}${NAV_BORDER.horizontal.repeat(leftWidth)}`);
  appendStyledChunk(chunks, hint, { fg: COLORS.muted });
  appendPlainChunk(chunks, `${NAV_BORDER.horizontal.repeat(rightWidth)}${NAV_BORDER.bottomRight}`);
}

function appendStatsLine(chunks: TextChunk[], file: DiffFile, width: number, selected: boolean): void {
  const addText = `+${file.additions}`;
  const removeText = `-${file.removals}`;
  const divider = "/";
  const prefix = " ";
  const suffixWidth = Math.max(0, width - prefix.length - addText.length - divider.length - removeText.length);
  const selectedStyle = selected ? { bg: COLORS.selected } : {};
  appendPlainChunk(chunks, NAV_BORDER.vertical);
  appendStyledChunk(chunks, prefix, selectedStyle);
  appendStyledChunk(chunks, addText, { ...selectedStyle, fg: COLORS.statAdd });
  appendStyledChunk(chunks, divider, selectedStyle);
  appendStyledChunk(chunks, removeText, { ...selectedStyle, fg: COLORS.statRemove });
  appendStyledChunk(chunks, " ".repeat(suffixWidth), selectedStyle);
  appendPlainChunk(chunks, `${NAV_BORDER.vertical}\n`);
}

function appendNavCardLine(chunks: TextChunk[], value: string, width: number, selected: boolean): void {
  appendPlainChunk(chunks, NAV_BORDER.vertical);
  appendStyledChunk(
    chunks,
    ` ${truncate(value, Math.max(1, width - 2)).trimEnd()}`.padEnd(width),
    selected ? { fg: "#ffffff", bg: COLORS.selected } : { fg: COLORS.text },
  );
  appendPlainChunk(chunks, `${NAV_BORDER.vertical}\n`);
}
