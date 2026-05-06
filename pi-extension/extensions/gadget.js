import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const REVIEW_CONTEXT_LINES = 3;
const MAX_UNTRACKED_BYTES = 1_000_000;

export default function gadgetExtension(pi) {
  pi.registerCommand("feedback", {
    description: "Give feedback on an assistant turn or the full transcript",
    handler: async (_args, ctx) => {
      const turns = assistantTurns(ctx.sessionManager.getBranch());
      if (turns.length === 0) {
        ctx.ui.notify("No assistant turns to review yet.", "warning");
        return;
      }

      const result = await ctx.ui.custom(
        (tui, theme, _keybindings, done) => new FeedbackOverlay(tui, theme, turns, done),
        {
          overlay: true,
          overlayOptions: {
            width: "92%",
            maxHeight: "86%",
            margin: 1,
          },
        },
      );

      if (!result || result.feedback.trim().length === 0) {
        return;
      }

      const prompt = formatFeedbackPrompt(result);
      await pi.sendUserMessage(prompt, ctx.isIdle() ? undefined : { deliverAs: "steer" });
    },
  });

  pi.registerCommand("review", {
    description: "Review current code changes with saved comments",
    handler: async (_args, ctx) => {
      let state;
      try {
        state = await readDiffState(ctx.cwd);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }

      if (state.files.length === 0) {
        ctx.ui.notify("No code changes found in git diff HEAD.", "info");
        return;
      }

      const result = await ctx.ui.custom(
        (tui, theme, _keybindings, done) => new ReviewOverlay(tui, theme, state, done),
        {
          overlay: true,
          overlayOptions: {
            width: "96%",
            maxHeight: "90%",
            margin: 1,
          },
        },
      );

      if (!result || result.comments.length === 0) {
        return;
      }

      await pi.sendUserMessage(formatReviewPrompt(result.cwd, result.comments), ctx.isIdle() ? undefined : { deliverAs: "steer" });
    },
  });
}

class FeedbackOverlay {
  focused = false;

  constructor(tui, theme, turns, done) {
    this.tui = tui;
    this.theme = theme;
    this.turns = turns;
    this.done = done;
    this.scope = "turn";
    this.turnIndex = turns.length - 1;
    this.previewScroll = 0;
    this.feedback = "";
    this.cursor = 0;
  }

  handleInput(data) {
    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "ctrl+g")) {
      this.submit();
      return;
    }
    if (matchesKey(data, "ctrl+t")) {
      this.scope = this.scope === "turn" ? "transcript" : "turn";
      this.previewScroll = 0;
      return;
    }
    if (matchesKey(data, "ctrl+n") || matchesKey(data, "pageDown")) {
      this.turnIndex = Math.min(this.turns.length - 1, this.turnIndex + 1);
      this.previewScroll = 0;
      return;
    }
    if (matchesKey(data, "ctrl+p") || matchesKey(data, "pageUp")) {
      this.turnIndex = Math.max(0, this.turnIndex - 1);
      this.previewScroll = 0;
      return;
    }
    if (matchesKey(data, "alt+up")) {
      this.previewScroll = Math.max(0, this.previewScroll - 1);
      return;
    }
    if (matchesKey(data, "alt+down")) {
      this.previewScroll += 1;
      return;
    }
    this.editFeedback(data);
  }

  editFeedback(data) {
    if (matchesKey(data, "backspace")) {
      if (this.cursor > 0) {
        this.feedback = this.feedback.slice(0, this.cursor - 1) + this.feedback.slice(this.cursor);
        this.cursor -= 1;
      }
      return;
    }
    if (matchesKey(data, "delete")) {
      this.feedback = this.feedback.slice(0, this.cursor) + this.feedback.slice(this.cursor + 1);
      return;
    }
    if (matchesKey(data, "left")) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (matchesKey(data, "right")) {
      this.cursor = Math.min(this.feedback.length, this.cursor + 1);
      return;
    }
    if (matchesKey(data, "home")) {
      this.cursor = lineStart(this.feedback, this.cursor);
      return;
    }
    if (matchesKey(data, "end")) {
      this.cursor = lineEnd(this.feedback, this.cursor);
      return;
    }
    if (matchesKey(data, "return")) {
      this.insertText("\n");
      return;
    }
    const printable = printableText(data);
    if (printable) {
      this.insertText(printable);
    }
  }

  insertText(text) {
    this.feedback = this.feedback.slice(0, this.cursor) + text + this.feedback.slice(this.cursor);
    this.cursor += text.length;
  }

  submit() {
    this.done({
      scope: this.scope,
      turn: this.turns[this.turnIndex],
      turnIndex: this.turnIndex,
      turnCount: this.turns.length,
      feedback: this.feedback.trim(),
    });
  }

  render(width) {
    const overlayWidth = Math.max(24, Math.min(width, 120));
    const innerWidth = overlayWidth - 2;
    const previewHeight = 13;
    const editorHeight = 7;
    const lines = [];
    const turn = this.turns[this.turnIndex];
    const scopeLabel = this.scope === "turn"
      ? `Turn ${this.turnIndex + 1}/${this.turns.length}`
      : "Transcript";

    lines.push(borderTop(this.theme, innerWidth, " Gadget Feedback "));
    lines.push(row(this.theme, innerWidth, `${this.theme.fg("accent", scopeLabel)}  ${this.theme.fg("dim", "Ctrl+T scope | Ctrl+P/N turn | Alt+Up/Down scroll")}`));
    lines.push(row(this.theme, innerWidth, this.scope === "turn" ? turn.title : "Feedback applies to the current transcript branch."));
    lines.push(separator(this.theme, innerWidth));

    const previewText = this.scope === "turn" ? turn.text : transcriptSummary(this.turns);
    const previewLines = wrapTextBlock(previewText || "(empty)", innerWidth - 2);
    const maxPreviewScroll = Math.max(0, previewLines.length - previewHeight);
    this.previewScroll = clamp(this.previewScroll, 0, maxPreviewScroll);
    for (const line of fixedWindow(previewLines, this.previewScroll, previewHeight)) {
      lines.push(row(this.theme, innerWidth, ` ${this.theme.fg("muted", line)}`));
    }

    lines.push(separator(this.theme, innerWidth));
    lines.push(row(this.theme, innerWidth, this.theme.fg("accent", "Feedback")));
    for (const line of renderEditableText(this.feedback, this.cursor, innerWidth - 2, editorHeight)) {
      lines.push(row(this.theme, innerWidth, ` ${line}`));
    }
    lines.push(borderBottom(this.theme, innerWidth, " Ctrl+G submit | Esc cancel "));
    return lines;
  }

  invalidate() {}
  dispose() {}
}

class ReviewOverlay {
  focused = false;

  constructor(tui, theme, state, done) {
    this.tui = tui;
    this.theme = theme;
    this.state = state;
    this.done = done;
    this.fileIndex = 0;
    this.lineIndex = 0;
    this.fileScroll = 0;
    this.lineScroll = 0;
    this.comments = new Map();
    this.editing = false;
    this.draft = "";
    this.draftCursor = 0;
    this.status = "";
  }

  handleInput(data) {
    if (this.editing) {
      this.handleEditorInput(data);
      return;
    }

    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "ctrl+g")) {
      this.submit();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.openEditor();
      return;
    }
    if (matchesKey(data, "d")) {
      this.deleteComment();
      return;
    }
    if (matchesKey(data, "j") || matchesKey(data, "down")) {
      this.moveLine(1);
      return;
    }
    if (matchesKey(data, "k") || matchesKey(data, "up")) {
      this.moveLine(-1);
      return;
    }
    if (matchesKey(data, "l") || matchesKey(data, "right")) {
      this.moveFile(1);
      return;
    }
    if (matchesKey(data, "h") || matchesKey(data, "left")) {
      this.moveFile(-1);
      return;
    }
    if (matchesKey(data, "pageDown")) {
      this.moveLine(10);
      return;
    }
    if (matchesKey(data, "pageUp")) {
      this.moveLine(-10);
    }
  }

  handleEditorInput(data) {
    if (matchesKey(data, "escape")) {
      this.editing = false;
      this.status = "Comment cancelled.";
      return;
    }
    if (matchesKey(data, "ctrl+g")) {
      this.saveComment();
      return;
    }
    if (matchesKey(data, "backspace")) {
      if (this.draftCursor > 0) {
        this.draft = this.draft.slice(0, this.draftCursor - 1) + this.draft.slice(this.draftCursor);
        this.draftCursor -= 1;
      }
      return;
    }
    if (matchesKey(data, "delete")) {
      this.draft = this.draft.slice(0, this.draftCursor) + this.draft.slice(this.draftCursor + 1);
      return;
    }
    if (matchesKey(data, "left")) {
      this.draftCursor = Math.max(0, this.draftCursor - 1);
      return;
    }
    if (matchesKey(data, "right")) {
      this.draftCursor = Math.min(this.draft.length, this.draftCursor + 1);
      return;
    }
    if (matchesKey(data, "home")) {
      this.draftCursor = lineStart(this.draft, this.draftCursor);
      return;
    }
    if (matchesKey(data, "end")) {
      this.draftCursor = lineEnd(this.draft, this.draftCursor);
      return;
    }
    if (matchesKey(data, "return")) {
      this.insertDraft("\n");
      return;
    }
    const printable = printableText(data);
    if (printable) {
      this.insertDraft(printable);
    }
  }

  insertDraft(text) {
    this.draft = this.draft.slice(0, this.draftCursor) + text + this.draft.slice(this.draftCursor);
    this.draftCursor += text.length;
  }

  selectedFile() {
    return this.state.files[this.fileIndex];
  }

  selectedLine() {
    return this.selectedFile()?.lines[this.lineIndex];
  }

  selectedKey() {
    const file = this.selectedFile();
    const line = this.selectedLine();
    return file && line ? `${file.filePath}:${line.id}` : "";
  }

  moveFile(delta) {
    const next = clamp(this.fileIndex + delta, 0, this.state.files.length - 1);
    if (next === this.fileIndex) {
      return;
    }
    this.fileIndex = next;
    this.lineIndex = 0;
    this.lineScroll = 0;
  }

  moveLine(delta) {
    const file = this.selectedFile();
    if (!file) {
      return;
    }
    this.lineIndex = clamp(this.lineIndex + delta, 0, file.lines.length - 1);
  }

  openEditor() {
    const line = this.selectedLine();
    if (!line) {
      return;
    }
    this.draft = this.comments.get(this.selectedKey())?.comment ?? "";
    this.draftCursor = this.draft.length;
    this.editing = true;
    this.status = `Commenting on ${lineLabel(line)}`;
  }

  saveComment() {
    const value = this.draft.trim();
    const file = this.selectedFile();
    const line = this.selectedLine();
    if (!file || !line) {
      this.editing = false;
      return;
    }
    if (value.length === 0) {
      this.comments.delete(this.selectedKey());
      this.status = "Comment removed.";
    } else {
      this.comments.set(this.selectedKey(), {
        file,
        line,
        comment: value,
        savedAt: Date.now(),
      });
      this.status = "Comment saved.";
    }
    this.editing = false;
  }

  deleteComment() {
    if (this.comments.delete(this.selectedKey())) {
      this.status = "Comment deleted.";
    }
  }

  submit() {
    const comments = [...this.comments.values()].sort((left, right) => left.savedAt - right.savedAt);
    if (comments.length === 0) {
      this.status = "No saved comments.";
      return;
    }
    this.done({ cwd: this.state.cwd, comments });
  }

  render(width) {
    const overlayWidth = Math.max(48, Math.min(width, 150));
    const innerWidth = overlayWidth - 2;
    const leftWidth = clamp(Math.floor(innerWidth * 0.28), 22, 42);
    const rightWidth = innerWidth - leftWidth - 1;
    const bodyHeight = this.editing ? 17 : 22;
    const file = this.selectedFile();
    const line = this.selectedLine();
    const lines = [];

    lines.push(borderTop(this.theme, innerWidth, " Gadget Review "));
    lines.push(row(this.theme, innerWidth, `${this.theme.fg("accent", `${this.comments.size} saved`)}  ${this.theme.fg("dim", "H/L files | J/K lines | Enter comment | D delete | Ctrl+G submit | Esc cancel")}`));
    lines.push(separator(this.theme, innerWidth));

    const fileLines = this.renderFileList(leftWidth, bodyHeight);
    const diffLines = this.renderDiffLines(file, line, rightWidth, bodyHeight);
    for (let index = 0; index < bodyHeight; index += 1) {
      lines.push(row(this.theme, innerWidth, `${fileLines[index] ?? " ".repeat(leftWidth)} ${diffLines[index] ?? " ".repeat(rightWidth)}`));
    }

    if (this.editing) {
      lines.push(separator(this.theme, innerWidth));
      lines.push(row(this.theme, innerWidth, this.theme.fg("accent", `Comment ${file?.filePath ?? ""} ${line ? lineLabel(line) : ""}`)));
      for (const editorLine of renderEditableText(this.draft, this.draftCursor, innerWidth - 2, 6)) {
        lines.push(row(this.theme, innerWidth, ` ${editorLine}`));
      }
      lines.push(row(this.theme, innerWidth, this.theme.fg("dim", "Ctrl+G save | Esc cancel")));
    } else if (this.status) {
      lines.push(separator(this.theme, innerWidth));
      lines.push(row(this.theme, innerWidth, this.theme.fg("muted", this.status)));
    }

    lines.push(borderBottom(this.theme, innerWidth, " /review "));
    return lines;
  }

  renderFileList(width, height) {
    const files = this.state.files;
    this.fileScroll = keepVisible(this.fileIndex, this.fileScroll, height);
    const result = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
      const index = this.fileScroll + rowIndex;
      const file = files[index];
      if (!file) {
        result.push(" ".repeat(width));
        continue;
      }
      const selected = index === this.fileIndex;
      const count = [...this.comments.values()].filter((comment) => comment.file.filePath === file.filePath).length;
      const marker = selected ? ">" : " ";
      const stats = `+${file.additions}/-${file.removals}`;
      const suffix = count > 0 ? ` [${count}]` : "";
      const text = `${marker} ${file.filePath} ${stats}${suffix}`;
      result.push(padStyled(selected ? this.theme.bg("selectedBg", truncateToWidth(text, width, "", true)) : truncateToWidth(text, width, "", true), width));
    }
    return result;
  }

  renderDiffLines(file, selectedLine, width, height) {
    if (!file) {
      return Array.from({ length: height }, () => " ".repeat(width));
    }
    this.lineScroll = keepVisible(this.lineIndex, this.lineScroll, height);
    const result = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
      const index = this.lineScroll + rowIndex;
      const line = file.lines[index];
      if (!line) {
        result.push(" ".repeat(width));
        continue;
      }
      const selected = line === selectedLine;
      const saved = this.comments.has(`${file.filePath}:${line.id}`);
      const gutter = `${selected ? ">" : " "} ${saved ? "*" : " "} ${lineNumber(line).padStart(5)} `;
      const contentWidth = Math.max(1, width - visibleWidth(gutter));
      const raw = truncateToWidth(line.raw, contentWidth, "", true);
      const colored = gutter + colorDiffLine(this.theme, line, raw);
      result.push(padStyled(selected ? this.theme.bg("selectedBg", colored) : colored, width));
    }
    return result;
  }

  invalidate() {}
  dispose() {}
}

function assistantTurns(entries) {
  return entries
    .filter((entry) => entry.type === "message" && entry.message?.role === "assistant")
    .map((entry, index) => {
      const text = messageText(entry.message);
      const title = `Assistant turn ${index + 1} - ${entry.timestamp ?? entry.id}`;
      return {
        id: entry.id,
        timestamp: entry.timestamp,
        title,
        text,
      };
    });
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (block?.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      if (block?.type === "tool-call") {
        return `[tool call: ${block.toolName ?? "tool"}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function transcriptSummary(turns) {
  return turns
    .map((turn, index) => {
      const firstLine = turn.text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "(empty)";
      return `${index + 1}. ${firstLine}`;
    })
    .join("\n");
}

function formatFeedbackPrompt(result) {
  if (result.scope === "transcript") {
    return [
      "Feedback on the current conversation transcript:",
      "",
      result.feedback,
    ].join("\n");
  }

  return [
    `Feedback on assistant turn ${result.turnIndex + 1} of ${result.turnCount}:`,
    `Turn entry: ${result.turn.id}`,
    result.turn.timestamp ? `Turn timestamp: ${result.turn.timestamp}` : "",
    "",
    "Turn excerpt:",
    "```",
    truncatePlain(result.turn.text, 4000),
    "```",
    "",
    result.feedback,
  ].filter((line) => line !== "").join("\n");
}

async function readDiffState(cwd) {
  const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const diff = await runGit(root, ["diff", "HEAD", "--no-color", "--no-ext-diff", `--unified=${REVIEW_CONTEXT_LINES}`, "--"]);
  const files = parseUnifiedDiff(diff);
  files.push(...await readUntrackedDiffs(root));
  return { cwd: root, files };
}

function runGit(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", ["--no-optional-locks", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) {
        resolvePromise(out);
      } else {
        reject(new Error(err || `git ${args.join(" ")} failed`));
      }
    });
  });
}

function parseUnifiedDiff(diff) {
  const lines = diff.split(/\r?\n/);
  const files = [];
  let current = null;
  let currentRaw = [];
  let oldLine = 0;
  let newLine = 0;
  let hunkHeader = null;
  let lineId = 0;

  const finish = () => {
    if (current) {
      current.rawDiff = currentRaw.join("\n");
      files.push(current);
    }
  };

  for (let rawIndex = 0; rawIndex < lines.length; rawIndex += 1) {
    const raw = lines[rawIndex] ?? "";
    if (raw === "" && rawIndex === lines.length - 1) {
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      finish();
      const filePath = parseDiffGitPath(raw);
      current = { filePath, additions: 0, removals: 0, lines: [], rawDiff: "" };
      currentRaw = [raw];
      oldLine = 0;
      newLine = 0;
      hunkHeader = null;
      lineId = 0;
      continue;
    }

    if (!current) {
      continue;
    }
    currentRaw.push(raw);

    if (raw.startsWith("+++ b/")) {
      current.filePath = raw.slice("+++ b/".length);
      continue;
    }

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      hunkHeader = raw;
      current.lines.push(diffLine(current.filePath, lineId++, "hunk", null, null, hunkHeader, raw, raw));
      continue;
    }

    if (!hunkHeader) {
      if (raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("index ")) {
        continue;
      }
      current.lines.push(diffLine(current.filePath, lineId++, "file", null, null, null, raw, raw));
      continue;
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      current.additions += 1;
      current.lines.push(diffLine(current.filePath, lineId++, "add", null, newLine, hunkHeader, raw.slice(1), raw));
      newLine += 1;
      continue;
    }

    if (raw.startsWith("-") && !raw.startsWith("---")) {
      current.removals += 1;
      current.lines.push(diffLine(current.filePath, lineId++, "remove", oldLine, null, hunkHeader, raw.slice(1), raw));
      oldLine += 1;
      continue;
    }

    if (raw.startsWith("\\")) {
      current.lines.push(diffLine(current.filePath, lineId++, "file", null, null, null, raw, raw));
      continue;
    }

    current.lines.push(diffLine(current.filePath, lineId++, "context", oldLine, newLine, hunkHeader, raw.startsWith(" ") ? raw.slice(1) : raw, raw));
    oldLine += 1;
    newLine += 1;
  }

  finish();
  return files;
}

function diffLine(filePath, id, kind, oldLine, newLine, hunkHeader, text, raw) {
  return {
    id: `${filePath}:${id}`,
    filePath,
    kind,
    oldLine,
    newLine,
    hunkHeader,
    text,
    raw,
  };
}

function parseDiffGitPath(raw) {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
  return match?.[2] ?? raw.replace(/^diff --git /, "");
}

async function readUntrackedDiffs(cwd) {
  const status = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = status.split("\0").filter(Boolean);
  const files = [];

  for (const entry of entries) {
    if (!entry.startsWith("?? ")) {
      continue;
    }
    const filePath = entry.slice(3);
    const absolute = join(cwd, filePath);
    if (!existsSync(absolute)) {
      continue;
    }
    const stat = statSync(absolute);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) {
      continue;
    }

    let text;
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const contentLines = text.endsWith("\n") ? text.slice(0, -1).split(/\r?\n/) : text.split(/\r?\n/);
    const hunkHeader = `@@ -0,0 +1,${contentLines.length} @@`;
    const lines = [diffLine(filePath, 0, "hunk", null, null, hunkHeader, hunkHeader, hunkHeader)];
    contentLines.forEach((line, index) => {
      lines.push(diffLine(filePath, index + 1, "add", null, index + 1, hunkHeader, line, `+${line}`));
    });
    files.push({
      filePath,
      additions: contentLines.length,
      removals: 0,
      lines,
      rawDiff: [`diff --git a/${filePath} b/${filePath}`, "new file mode 100644", "--- /dev/null", `+++ b/${filePath}`, hunkHeader, ...contentLines.map((line) => `+${line}`)].join("\n"),
    });
  }

  return files;
}

function formatReviewPrompt(cwd, comments) {
  return comments
    .map((comment, index) => {
      const filePath = resolve(cwd, comment.file.filePath);
      const lineNumber = comment.line.newLine ?? comment.line.oldLine;
      const isDeletedLine = comment.line.kind === "remove" && comment.line.oldLine !== null;
      const header = `Comment ${index + 1}:`;
      const location = `File: ${isDeletedLine || lineNumber === null ? filePath : `${filePath}:${lineNumber}`}`;
      const deleted = isDeletedLine ? `Deleted line: old line ${comment.line.oldLine}` : "";
      const hunk = hunkForLine(comment.file, comment.line);
      return [
        header,
        location,
        deleted,
        hunk.trim().length > 0 ? "Hunk:" : "",
        hunk.trim().length > 0 ? "```diff" : "",
        hunk,
        hunk.trim().length > 0 ? "```" : "",
        "",
        comment.comment,
      ].filter((line) => line !== "").join("\n");
    })
    .join("\n\n---\n\n");
}

function hunkForLine(file, selected, radius = 4) {
  const index = file.lines.findIndex((line) => line.id === selected.id);
  if (index < 0) {
    return selected.raw;
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(file.lines.length, index + radius + 1);
  let hunkStart = -1;
  if (selected.hunkHeader) {
    for (let i = index; i >= 0; i -= 1) {
      if (file.lines[i]?.kind === "hunk") {
        hunkStart = i;
        break;
      }
    }
  }
  const sliceStart = hunkStart >= 0 ? Math.max(hunkStart, start) : start;
  return file.lines.slice(sliceStart, end).map((line) => line.raw).join("\n");
}

function lineNumber(line) {
  if (line.kind === "hunk") {
    return "@@";
  }
  const value = line.newLine ?? line.oldLine;
  return value === null ? "" : String(value);
}

function lineLabel(line) {
  const value = line.newLine ?? line.oldLine;
  if (value === null) {
    return line.kind;
  }
  return `${line.kind}:${value}`;
}

function colorDiffLine(theme, line, value) {
  if (line.kind === "add") {
    return theme.fg("toolDiffAdded", value);
  }
  if (line.kind === "remove") {
    return theme.fg("toolDiffRemoved", value);
  }
  if (line.kind === "hunk") {
    return theme.fg("accent", value);
  }
  return value;
}

function renderEditableText(value, cursor, width, height) {
  const marked = value.slice(0, cursor) + "|" + value.slice(cursor);
  const source = marked.length === 1 ? "|" : marked;
  const wrapped = wrapTextBlock(source, width);
  return fixedWindow(wrapped, Math.max(0, wrapped.length - height), height).map((line) => truncateToWidth(line, width, "", true));
}

function wrapTextBlock(text, width) {
  const lines = [];
  for (const part of text.split(/\r?\n/)) {
    const wrapped = wrapTextWithAnsi(part, Math.max(1, width));
    lines.push(...(wrapped.length > 0 ? wrapped : [""]));
  }
  return lines;
}

function fixedWindow(lines, scroll, height) {
  const result = lines.slice(scroll, scroll + height);
  while (result.length < height) {
    result.push("");
  }
  return result;
}

function row(theme, width, content) {
  return `${theme.fg("border", "|")}${padStyled(truncateToWidth(content, width, "", true), width)}${theme.fg("border", "|")}`;
}

function borderTop(theme, width, title) {
  return border(theme, width, "/", "\\", title);
}

function borderBottom(theme, width, title) {
  return border(theme, width, "\\", "/", title);
}

function separator(theme, width) {
  return `${theme.fg("border", "|")}${theme.fg("borderMuted", "-".repeat(width))}${theme.fg("border", "|")}`;
}

function border(theme, width, left, right, title) {
  const label = title.length + 2 < width ? title : "";
  const before = label ? "-".repeat(2) : "-".repeat(width);
  const after = label ? "-".repeat(Math.max(0, width - visibleWidth(before + label))) : "";
  return theme.fg("border", `${left}${before}${label}${after}${right}`);
}

function padStyled(value, width) {
  return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
}

function keepVisible(index, scroll, height) {
  if (index < scroll) {
    return index;
  }
  if (index >= scroll + height) {
    return index - height + 1;
  }
  return scroll;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lineStart(value, cursor) {
  const safeCursor = clamp(cursor, 0, value.length);
  return safeCursor === 0 ? 0 : value.lastIndexOf("\n", safeCursor - 1) + 1;
}

function lineEnd(value, cursor) {
  const safeCursor = clamp(cursor, 0, value.length);
  const next = value.indexOf("\n", safeCursor);
  return next === -1 ? value.length : next;
}

function printableText(data) {
  if (data.length === 1 && data.charCodeAt(0) >= 32) {
    return data;
  }
  return undefined;
}

function truncatePlain(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n[truncated]`;
}
