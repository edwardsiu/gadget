import { parseColor, type TextChunk } from "@opentui/core";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width);
  }
  return `...${value.slice(-(width - 3))}`;
}

export function truncateToWidth(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (value.length <= width) {
    return value;
  }
  if (width === 1) {
    return "…";
  }
  return `…${value.slice(-(width - 1))}`;
}

export function truncateMiddle(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (value.length <= width) {
    return value;
  }
  if (width === 1) {
    return "…";
  }

  const leftWidth = Math.ceil((width - 1) / 2);
  const rightWidth = Math.floor((width - 1) / 2);
  return `${value.slice(0, leftWidth)}…${value.slice(-rightWidth)}`;
}

export function appendPlainChunk(chunks: TextChunk[], text: string): void {
  chunks.push({ __isChunk: true, text });
}

export function appendStyledChunk(chunks: TextChunk[], text: string, style: { fg?: string; bg?: string }): void {
  chunks.push({
    __isChunk: true,
    text,
    ...(style.fg ? { fg: parseColor(style.fg) } : {}),
    ...(style.bg ? { bg: parseColor(style.bg) } : {}),
  });
}

export function wrapTextLine(value: string, width: number): string[] {
  if (value === "") {
    return [""];
  }
  const rows: string[] = [];
  let remaining = value;
  while (remaining.length > width) {
    const breakAt = remaining.lastIndexOf(" ", width);
    const rowEnd = breakAt > 0 ? breakAt : width;
    rows.push(remaining.slice(0, rowEnd));
    remaining = remaining.slice(rowEnd).replace(/^ /, "");
  }
  rows.push(remaining);
  return rows;
}
