import type { KeyEvent } from "@opentui/core";

export type MainInputAction =
  | { type: "forceQuit" }
  | { type: "quit" }
  | { type: "cancel" }
  | { type: "lineUp" }
  | { type: "lineDown" }
  | { type: "pageUp" }
  | { type: "pageDown" }
  | { type: "previousFile" }
  | { type: "nextFile" }
  | { type: "submitOrComment" }
  | { type: "openFilePicker" }
  | { type: "toggleFileTree" }
  | { type: "searchFiles" }
  | { type: "chooseDiffBase" }
  | { type: "openHelp" }
  | { type: "openSession" }
  | { type: "replyAgentTurn" }
  | { type: "toggleFileView" }
  | { type: "startReview" }
  | { type: "selectFile"; index: number };

export type TextInputAction =
  | { type: "quit" }
  | { type: "cancel" }
  | { type: "backspace" }
  | { type: "submit" }
  | { type: "newline" }
  | { type: "deleteComment" }
  | { type: "insert"; text: string };

export type SearchInputAction =
  | { type: "forceQuit" }
  | { type: "quit" }
  | { type: "cancel" }
  | { type: "up" }
  | { type: "down" }
  | { type: "pageUp" }
  | { type: "pageDown" }
  | { type: "backspace" }
  | { type: "submit" }
  | { type: "insert"; text: string };

export type ListModalAction =
  | { type: "forceQuit" }
  | { type: "quit" }
  | { type: "close" }
  | { type: "up" }
  | { type: "down" }
  | { type: "pageUp" }
  | { type: "pageDown" }
  | { type: "submit" };

export type SimpleModalAction = { type: "forceQuit" } | { type: "quit" } | { type: "close" };

export function mainActionFromRaw(sequence: string): MainInputAction | null {
  switch (sequence) {
    case "\u0003":
      return { type: "forceQuit" };
    case "\u001b":
      return { type: "cancel" };
    case "Q":
      return { type: "quit" };
    case "\u001b[A":
    case "k":
      return { type: "lineUp" };
    case "\u001b[B":
    case "j":
      return { type: "lineDown" };
    case "K":
    case "\u001b[5~":
      return { type: "pageUp" };
    case "J":
    case "\u001b[6~":
      return { type: "pageDown" };
    case "\u001b[D":
    case "h":
      return { type: "previousFile" };
    case "\u001b[C":
    case "l":
      return { type: "nextFile" };
    case "c":
    case "\r":
    case "\n":
      return { type: "submitOrComment" };
    case "p":
      return { type: "openFilePicker" };
    case "f":
    case "F":
      return { type: "toggleFileTree" };
    case "P":
      return { type: "searchFiles" };
    case "b":
    case "B":
      return { type: "chooseDiffBase" };
    case "?":
      return { type: "openHelp" };
    case "s":
      return { type: "openSession" };
    case "R":
      return { type: "replyAgentTurn" };
    case "o":
      return { type: "toggleFileView" };
    case "r":
      return { type: "startReview" };
    default:
      return /^[1-9]$/.test(sequence) ? { type: "selectFile", index: Number(sequence) - 1 } : null;
  }
}

export function mainActionFromKey(key: KeyEvent): MainInputAction | null {
  if (key.ctrl && key.name === "c") {
    return { type: "forceQuit" };
  }
  if ((key.shift && key.name === "p") || key.sequence === "P") {
    return { type: "searchFiles" };
  }
  if (key.name === "f" || key.sequence === "f" || (key.shift && key.name === "f") || key.sequence === "F") {
    return { type: "toggleFileTree" };
  }
  if ((key.shift && key.name === "r") || key.sequence === "R") {
    return { type: "replyAgentTurn" };
  }

  switch (key.name || key.sequence) {
    case "escape":
    case "\u001b":
      return { type: "cancel" };
    case "Q":
      return { type: "quit" };
    case "up":
    case "k":
      return { type: "lineUp" };
    case "down":
    case "j":
      return { type: "lineDown" };
    case "K":
    case "pageup":
      return { type: "pageUp" };
    case "J":
    case "pagedown":
      return { type: "pageDown" };
    case "left":
    case "h":
      return { type: "previousFile" };
    case "right":
    case "l":
      return { type: "nextFile" };
    case "c":
    case "enter":
    case "return":
      return { type: "submitOrComment" };
    case "p":
      return { type: "openFilePicker" };
    case "b":
    case "B":
      return { type: "chooseDiffBase" };
    case "?":
      return { type: "openHelp" };
    case "o":
      return { type: "toggleFileView" };
    case "r":
      return { type: "startReview" };
    case "s":
      return { type: "openSession" };
    default:
      return /^[1-9]$/.test(key.sequence) ? { type: "selectFile", index: Number(key.sequence) - 1 } : null;
  }
}

export function textActionFromRaw(sequence: string): TextInputAction | null {
  if (sequence === "\u0003") {
    return { type: "quit" };
  }
  const pastedText = inputPasteText(sequence);
  if (pastedText !== null) {
    return { type: "insert", text: pastedText };
  }
  if (isShiftEnterSequence(sequence)) {
    return { type: "newline" };
  }
  if (isDeleteCommentSequence(sequence)) {
    return { type: "deleteComment" };
  }
  switch (sequence) {
    case "\u001b":
      return { type: "cancel" };
    case "\u007f":
    case "\b":
      return { type: "backspace" };
    case "\r":
    case "\n":
      return { type: "submit" };
    default:
      return isPrintableSequence(sequence) ? { type: "insert", text: sequence } : null;
  }
}

export function textActionFromKey(key: KeyEvent): TextInputAction | null {
  if (key.name === "escape" || key.sequence === "\u001b") {
    return { type: "cancel" };
  }
  if (key.name === "backspace" || key.sequence === "\u007f") {
    return { type: "backspace" };
  }
  if (key.shift && (key.name === "enter" || key.name === "return")) {
    return { type: "newline" };
  }
  if (isDeleteCommentKey(key)) {
    return { type: "deleteComment" };
  }
  if (key.name === "enter" || key.name === "return" || key.sequence === "\r") {
    return { type: "submit" };
  }
  if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " ") {
    return { type: "insert", text: key.sequence };
  }
  return null;
}

export function searchActionFromRaw(sequence: string): SearchInputAction | null {
  switch (sequence) {
    case "\u0003":
      return { type: "forceQuit" };
    case "\u001b":
      return { type: "cancel" };
    case "\u001b[A":
      return { type: "up" };
    case "\u001b[B":
      return { type: "down" };
    case "\u001b[5~":
      return { type: "pageUp" };
    case "\u001b[6~":
      return { type: "pageDown" };
    case "\u007f":
    case "\b":
      return { type: "backspace" };
    case "\r":
    case "\n":
      return { type: "submit" };
    default:
      return isPrintableSequence(sequence) ? { type: "insert", text: sequence } : null;
  }
}

export function searchActionFromKey(key: KeyEvent): SearchInputAction | null {
  switch (key.name || key.sequence) {
    case "escape":
    case "\u001b":
      return { type: "cancel" };
    case "up":
      return { type: "up" };
    case "down":
      return { type: "down" };
    case "pageup":
      return { type: "pageUp" };
    case "pagedown":
      return { type: "pageDown" };
    case "backspace":
    case "\u007f":
      return { type: "backspace" };
    case "enter":
    case "return":
      return { type: "submit" };
    default:
      return !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " "
        ? { type: "insert", text: key.sequence }
        : null;
  }
}

export function fileModalActionFromRaw(sequence: string): ListModalAction | null {
  switch (sequence) {
    case "\u0003":
      return { type: "forceQuit" };
    case "Q":
      return { type: "quit" };
    case "p":
      return { type: "close" };
    case "\u001b[A":
    case "\u001b[D":
    case "k":
    case "h":
      return { type: "up" };
    case "\u001b[B":
    case "\u001b[C":
    case "j":
    case "l":
      return { type: "down" };
    default:
      return null;
  }
}

export function fileModalActionFromKey(key: KeyEvent): ListModalAction | null {
  if (key.ctrl && key.name === "c") {
    return { type: "forceQuit" };
  }

  switch (key.name || key.sequence) {
    case "Q":
      return { type: "quit" };
    case "p":
      return { type: "close" };
    case "up":
    case "left":
    case "k":
    case "h":
      return { type: "up" };
    case "down":
    case "right":
    case "j":
    case "l":
      return { type: "down" };
    default:
      return null;
  }
}

export function diffBaseActionFromRaw(sequence: string): ListModalAction | null {
  switch (sequence) {
    case "\u0003":
      return { type: "forceQuit" };
    case "Q":
      return { type: "quit" };
    case "\u001b":
    case "b":
    case "B":
      return { type: "close" };
    case "\u001b[A":
    case "k":
      return { type: "up" };
    case "\u001b[B":
    case "j":
      return { type: "down" };
    case "\u001b[5~":
    case "K":
      return { type: "pageUp" };
    case "\u001b[6~":
    case "J":
      return { type: "pageDown" };
    case "\r":
    case "\n":
      return { type: "submit" };
    default:
      return null;
  }
}

export function diffBaseActionFromKey(key: KeyEvent): ListModalAction | null {
  if (key.ctrl && key.name === "c") {
    return { type: "forceQuit" };
  }

  switch (key.name || key.sequence) {
    case "escape":
    case "\u001b":
    case "b":
    case "B":
      return { type: "close" };
    case "Q":
      return { type: "quit" };
    case "up":
    case "k":
      return { type: "up" };
    case "down":
    case "j":
      return { type: "down" };
    case "pageup":
    case "K":
      return { type: "pageUp" };
    case "pagedown":
    case "J":
      return { type: "pageDown" };
    case "enter":
    case "return":
      return { type: "submit" };
    default:
      return null;
  }
}

export function simpleModalActionFromRaw(sequence: string): SimpleModalAction | null {
  switch (sequence) {
    case "\u0003":
      return { type: "forceQuit" };
    case "\u001b":
      return { type: "close" };
    default:
      return null;
  }
}

export function simpleModalActionFromKey(key: KeyEvent): SimpleModalAction | null {
  if (key.ctrl && key.name === "c") {
    return { type: "forceQuit" };
  }

  switch (key.name || key.sequence) {
    case "escape":
    case "\u001b":
      return { type: "close" };
    default:
      return null;
  }
}

export function isHandledRawInput(sequence: string): boolean {
  if (mainActionFromRaw(sequence) || textActionFromRaw(sequence) || searchActionFromRaw(sequence)) {
    return true;
  }
  return isPrintableSequence(sequence);
}

export function isVerticalScroll(direction: "up" | "down" | "left" | "right" | undefined, shift: boolean): boolean {
  return verticalScrollDirection(direction, shift) !== null;
}

function isPrintableSequence(sequence: string): boolean {
  return sequence.length === 1 && sequence >= " " && sequence !== "\u007f";
}

function inputPasteText(sequence: string): string | null {
  if (sequence.startsWith("\u001b[200~") && sequence.endsWith("\u001b[201~")) {
    return normalizeInputText(sequence.slice("\u001b[200~".length, -"\u001b[201~".length));
  }
  if (sequence.length <= 1 || sequence.includes("\u001b") || sequence.includes("\u0003")) {
    return null;
  }
  return normalizeInputText(sequence);
}

function normalizeInputText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function isShiftEnterSequence(sequence: string): boolean {
  return sequence === "\u001b[13;2u" || sequence === "\u001b[13;2~" || sequence === "\u001b[27;2;13~";
}

function isDeleteCommentSequence(sequence: string): boolean {
  return sequence === "\u0018";
}

function isDeleteCommentKey(key: KeyEvent): boolean {
  return key.ctrl && (key.name === "x" || key.sequence === "x" || key.sequence === "X");
}

export function verticalScrollDirection(direction: "up" | "down" | "left" | "right" | undefined, shift: boolean): "up" | "down" | null {
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
