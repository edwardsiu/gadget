import {
  getTreeSitterClient,
  pathToFiletype,
  MouseButton,
  treeSitterToTextChunks,
  type TextChunk,
  type TextRenderable,
} from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { basename } from "node:path";
import { createComment, formatReviewPrompt } from "../comments";
import { createDiffWatcher, listDiffBaseCandidates, listSearchableFiles, readDiffState, type DiffBaseCandidate, type ReadDiffStateOptions, type WorktreeInfo } from "../git";
import {
  createScratchpadDocument,
  formatScratchpadPrompt,
  scratchpadCommentKey,
  scratchpadDocumentToDiffFile,
  type ScratchpadCommentDraft,
  type ScratchpadDocument,
} from "../scratchpad";
import type { AgentAdapter, AgentComment, DiffFile, DiffLineRef, DiffState } from "../types";
import { createInlineCommentBox, formatInlineComment, inlineCommentHeight } from "./comment-box";
import { diffStateSignature, mergeDiffRefreshOptions } from "./diff-state";
import {
  formatDiffRows,
  formatDiffViewportDiffRow,
  formatDiffViewportRow,
  fullFileLineHighlights,
  lineBg,
  lineFg,
  visibleLineIndexes,
} from "./diff-format";
import { buildSearchableFileEntries, matchFilePaths, type SearchableFileEntry } from "./file-search-model";
import type { FuzzyFileMatch } from "./file-search-modal";
import type { FileTreeRow } from "./file-tree-sidebar";
import {
  applySyntaxChunks,
  buildHighlightDocument,
  createDiffSyntaxStyle,
  preserveSyntaxLineChunks,
  registerAdditionalSyntaxParsers,
  splitTextChunksByLine,
  syntaxDocumentCacheKey,
  syntaxDocumentKey,
  syntaxLineKey,
  type HighlightCacheEntry,
  type HighlightCacheSide,
  type HighlightDocument,
} from "./syntax";
import {
  createOpenedFile,
  currentFileStatusLine,
  nearestLineIndexForLineNumber,
  readCurrentFileLines,
  selectedCurrentLineNumber,
} from "./file-view";
import {
  diffBaseActionFromKey,
  diffBaseActionFromRaw,
  fileModalActionFromKey,
  fileModalActionFromRaw,
  isHandledRawInput,
  isVerticalScroll,
  mainActionFromKey,
  mainActionFromRaw,
  searchActionFromKey,
  searchActionFromRaw,
  simpleModalActionFromKey,
  simpleModalActionFromRaw,
  textActionFromKey,
  textActionFromRaw,
  verticalScrollDirection,
} from "./input";
import { navWidthFor, type NavMode } from "./nav-format";
import { GadgetRenderer } from "./renderer";
import { clamp } from "./text";
import {
  COLORS,
  DIFF_BORDER_FG,
  DIFF_BOTTOM_BAR_LINES,
  DIFF_TOP_BAR_LINES,
  FILE_TREE_SIDEBAR_WIDTH,
  INPUT_LINES,
  NAV_CARD_HEIGHT,
  FILE_SEARCH_MAX_MATCHES,
  REVIEW_BORDER_FG,
  SYNTAX_HIGHLIGHT_OVERSCAN_ROWS,
} from "./theme";

type InputMode = "none" | "comment" | "file-search" | "scratchpad-content";
type FileViewMode = "diff" | "file";
type DiffBaseOverrideSource = "github" | "manual";
type ReviewCommentDraft = {
  key: string;
  file: DiffFile;
  line: DiffLineRef;
  value: string;
  includeHunk: boolean;
  savedAt: number;
};
type ReviewCommentTarget = {
  key: string;
  file: DiffFile;
  line: DiffLineRef;
  includeHunk: boolean;
};
type ScratchpadCommentTarget = {
  key: string;
  lineNumber: number;
};
export type InitialFileTarget = {
  filePath: string;
  lineNumber?: number;
};

registerAdditionalSyntaxParsers();

export async function runGadgetUi(options: {
  cwd: string;
  adapter: AgentAdapter;
  worktree?: WorktreeInfo;
  initialFile?: InitialFileTarget;
}): Promise<void> {
  const app = new GadgetUi(options.cwd, options.adapter, options.worktree, options.initialFile);
  await app.start();
  await new Promise<void>(() => undefined);
}

class GadgetUi {
  private view: GadgetRenderer | null = null;
  private state: DiffState;
  private selectedFileIndex = 0;
  private selectedLineIndex = 0;
  private navScrollOffset = 0;
  private mode: InputMode = "none";
  private navMode: NavMode = "compact";
  private fileViewMode: FileViewMode = "diff";
  private fileModalOpen = false;
  private fileSearchModalOpen = false;
  private fileTreeOpen = false;
  private fileTreeScrollOffset = 0;
  private fileTreeRows: FileTreeRow[] = [];
  private fileTreeExpandedDirs = new Set<string>();
  private diffBaseModalOpen = false;
  private helpModalOpen = false;
  private sessionModalOpen = false;
  private fileModalScrollOffset = 0;
  private fileSearchScrollOffset = 0;
  private fileSearchSelectedIndex = 0;
  private diffBaseModalScrollOffset = 0;
  private diffBaseSelectedIndex = 0;
  private diffBaseCandidates: DiffBaseCandidate[] = [];
  private diffBaseLoading = false;
  private diffBaseError: string | null = null;
  private diffBaseOverride: string | null = null;
  private diffBaseOverrideSource: DiffBaseOverrideSource | null = null;
  private diffBaseLoadGeneration = 0;
  private githubDiffBaseLoadGeneration = 0;
  private searchableFiles: string[] = [];
  private searchableFileEntries: SearchableFileEntry[] = [];
  private searchableFilesLoaded = false;
  private searchableFilesRefreshing = false;
  private searchableFilesRefreshGeneration = 0;
  private fileSearchMatches: FuzzyFileMatch[] = [];
  private openedFilePaths = new Set<string>();
  private reviewMode = false;
  private reviewComments = new Map<string, ReviewCommentDraft>();
  private activeReviewTarget: ReviewCommentTarget | null = null;
  private scratchpadMode = false;
  private scratchpadDocument: ScratchpadDocument | null = null;
  private scratchpadComments = new Map<string, ScratchpadCommentDraft>();
  private activeScratchpadTarget: ScratchpadCommentTarget | null = null;
  private input = "";
  private status = "starting";
  private watcher: ReturnType<typeof createDiffWatcher> | null = null;
  private lineIds: string[] = [];
  private inlineCommentText: TextRenderable | null = null;
  private inlineCommentHeightRows = 0;
  private syntaxClient = getTreeSitterClient();
  private syntaxStyle = createDiffSyntaxStyle();
  private syntaxGeneration = 0;
  private syntaxLineChunks = new Map<string, TextChunk[]>();
  private syntaxLineKeys = new Map<string, string>();
  private syntaxDocumentCache = new Map<string, HighlightCacheEntry>();
  private pendingSyntaxDocuments = new Set<string>();
  private fullFileLines = new Map<string, DiffLineRef[]>();
  private lineRenderables = new Map<number, TextRenderable[]>();
  private rawInputHandler: ((sequence: string) => boolean) | null = null;
  private shuttingDown = false;
  private revealSelectedLine = true;
  private pinSelectedLineToTop = false;
  private centerSelectedLineInViewport = false;
  private ignoreQuitKeyUntil = 0;
  private terminalFocused = true;
  private ignoreDiffClicksUntil = 0;
  private commentCursorVisible = true;
  private commentCursorTimer: ReturnType<typeof setInterval> | null = null;
  private diffLoaded = false;
  private diffStateSignature = "";
  private diffRefreshInFlight = false;
  private pendingDiffRefreshOptions: ReadDiffStateOptions | null = null;
  private initialWorktreeConsumed = false;

  constructor(
    private readonly cwd: string,
    private readonly adapter: AgentAdapter,
    private readonly initialWorktree?: WorktreeInfo,
    private readonly initialFile?: InitialFileTarget,
  ) {
    this.state = {
      cwd: initialWorktree?.cwd ?? cwd,
      baseRef: "HEAD",
      baseRefLabel: "HEAD",
      branchName: initialWorktree?.branchName ?? "HEAD",
      repositoryRoot: initialWorktree?.repositoryRoot ?? cwd,
      worktreeName: initialWorktree?.worktreeName ?? basename(cwd),
      worktreePath: initialWorktree?.worktreePath ?? cwd,
      files: [],
      refreshedAt: Date.now(),
    };
  }

  async start(): Promise<void> {
    this.view = await GadgetRenderer.create({
      navWidth: () => navWidthFor(this.navMode),
      fileTreeWidth: () => this.fileTreeWidth(),
      onFileTreeRowMouseDown: (row) => {
        void this.handleFileTreeRow(row);
      },
      onFileTreeScroll: (delta) => this.scrollFileTree(delta),
      onNavFileMouseDown: (row) => {
        const fileIndex = this.fileIndexFromNavRow(row);
        if (fileIndex !== null) {
          this.selectFile(fileIndex);
        }
      },
      onNavScroll: (direction, shift) => {
        const scrollDirection = verticalScrollDirection(direction, shift);
        if (scrollDirection) {
          this.scrollNav(scrollDirection === "down" ? 1 : -1);
        }
      },
      onDiffBottomBarMouseDown: () => this.openFileModal(),
      onDiffScroll: (direction, shift) => {
        if (this.mode === "comment" || !isVerticalScroll(direction, shift)) {
          return;
        }
        setTimeout(() => this.syncSelectionToScroll(), 0);
      },
      onSelectFile: (index) => this.selectFile(index),
      onFileModalScroll: (delta) => this.scrollFileModal(delta),
      onSelectFileSearchMatch: (index) => {
        this.fileSearchSelectedIndex = index;
        void this.openSelectedFileSearchMatch();
      },
      onFileSearchScroll: (delta) => this.scrollFileSearch(delta),
      onSelectDiffBaseCandidate: (index) => {
        this.diffBaseSelectedIndex = index;
        void this.applySelectedDiffBase();
      },
      onDiffBaseScroll: (delta) => this.scrollDiffBaseModal(delta),
    });
    this.bindInput();
    this.startCommentCursorTimer();
    this.renderAll();
    const connectPromise = this.connectAdapter();
    const trackedDiffPromise = this.refreshDiffAndRender({ includeUntracked: false });
    void this.refreshSearchableFileCache({ render: false, updateStatus: false });

    this.watcher = createDiffWatcher(this.cwd, () => {
      void this.refreshDiffAndRender().catch((error) => this.setStatus(error.message));
    });

    await Promise.all([connectPromise, trackedDiffPromise]);
    await this.openInitialFileTarget();
    void this.refreshDiffAndRender().catch((error) => this.setStatus(error.message));
    void this.refreshGitHubDiffBase().catch(() => undefined);
  }

  private bindInput(): void {
    if (!this.view) {
      return;
    }
    this.ignoreQuitKeyUntil = Date.now() + 3_000;
    this.rawInputHandler = (sequence) => {
      void this.handleRawInput(sequence);
      return isHandledRawInput(sequence);
    };
    this.view.prependInputHandler(this.rawInputHandler);
    this.view.onBlur(() => {
      this.terminalFocused = false;
    });
    this.view.onFocus(() => {
      this.terminalFocused = true;
      this.ignoreDiffClicksUntil = Date.now() + 300;
    });
    this.view.onKeypress((key) => {
      void this.handleKey(key);
    });
  }

  private startCommentCursorTimer(): void {
    this.commentCursorTimer = setInterval(() => {
      if (this.shuttingDown || this.mode !== "comment" || !this.inlineCommentText) {
        return;
      }
      this.commentCursorVisible = !this.commentCursorVisible;
      this.renderInlineCommentInput();
    }, 500);
  }

  private async handleRawInput(sequence: string): Promise<void> {
    if (this.mode !== "none") {
      await this.handleInputSequence(sequence);
      return;
    }

    if (this.helpModalOpen) {
      this.handleHelpModalSequence(sequence);
      return;
    }

    if (this.sessionModalOpen) {
      this.handleSessionModalSequence(sequence);
      return;
    }

    if (this.diffBaseModalOpen) {
      await this.handleDiffBaseModalSequence(sequence);
      return;
    }

    if (this.fileModalOpen) {
      this.handleFileModalSequence(sequence);
      return;
    }

    if (this.fileSearchModalOpen) {
      this.mode = "file-search";
      await this.handleFileSearchInputSequence(sequence);
      return;
    }

    await this.applyMainInputAction(mainActionFromRaw(sequence));
  }

  private async handleInputSequence(sequence: string): Promise<void> {
    if (this.mode === "file-search") {
      await this.handleFileSearchInputSequence(sequence);
      return;
    }

    await this.applyTextInputAction(textActionFromRaw(sequence));
  }

  private async handleInputKey(key: KeyEvent): Promise<void> {
    if (this.mode === "file-search") {
      await this.handleFileSearchInputKey(key);
      return;
    }

    await this.applyTextInputAction(textActionFromKey(key));
  }

  private async applyTextInputAction(action: ReturnType<typeof textActionFromRaw>): Promise<void> {
    if (!action) {
      return;
    }

    switch (action.type) {
      case "quit":
        this.shutdownNow();
        return;
      case "cancel":
        if (this.mode === "scratchpad-content") {
          this.cancelScratchpad();
          return;
        }
        if (this.mode === "comment" && this.reviewMode) {
          this.cancelActiveReviewEdit();
          return;
        }
        if (this.mode === "comment" && this.scratchpadMode) {
          this.cancelActiveScratchpadEdit();
          return;
        }
        this.mode = "none";
        this.input = "";
        this.setStatus("input cancelled");
        this.renderAll();
        return;
      case "backspace":
        this.input = this.input.slice(0, -1);
        this.renderCommentInputChange();
        return;
      case "newline":
        if (this.mode === "comment" || this.mode === "scratchpad-content") {
          this.input += "\n";
          this.renderCommentInputChange();
        }
        return;
      case "deleteComment":
        if (this.mode === "comment") {
          this.deleteActiveAnnotationComment();
        }
        return;
      case "insert":
        if (this.mode === "comment" || this.mode === "scratchpad-content") {
          this.input += action.text;
          this.renderCommentInputChange();
        }
        return;
      case "submit": {
        const value = this.input.trim();
        const mode = this.mode;
        if (mode === "comment" && this.reviewMode) {
          this.saveActiveAnnotationComment();
          return;
        }
        if (mode === "comment" && this.scratchpadMode) {
          this.saveActiveScratchpadComment();
          return;
        }
        if (mode === "scratchpad-content") {
          this.saveScratchpadContent(this.input);
          return;
        }
        this.mode = "none";
        this.input = "";
        if (!value) {
          this.renderAll();
          return;
        }
        if (mode === "comment") {
          await this.submitComment(value);
        }
        return;
      }
    }
  }

  private async handleKey(key: KeyEvent): Promise<void> {
    if (this.mode !== "none") {
      await this.handleInputKey(key);
      return;
    }

    if (this.helpModalOpen) {
      this.handleHelpModalKey(key);
      return;
    }

    if (this.sessionModalOpen) {
      this.handleSessionModalKey(key);
      return;
    }

    if (this.diffBaseModalOpen) {
      await this.handleDiffBaseModalKey(key);
      return;
    }

    if (this.fileModalOpen) {
      this.handleFileModalKey(key);
      return;
    }

    if (this.fileSearchModalOpen) {
      this.mode = "file-search";
      await this.handleFileSearchInputKey(key);
      return;
    }

    await this.applyMainInputAction(mainActionFromKey(key));
  }

  private async applyMainInputAction(action: ReturnType<typeof mainActionFromRaw>): Promise<void> {
    if (!action) {
      return;
    }
    switch (action.type) {
      case "forceQuit":
        this.shutdownNow();
        return;
      case "quit":
        if (!this.shouldIgnoreQuitKey()) {
          this.shutdownNow();
        }
        return;
      case "cancel":
        if (this.fileTreeOpen) {
          this.closeFileTree();
        } else if (this.reviewMode) {
          this.cancelReview();
        } else if (this.scratchpadMode) {
          this.cancelScratchpad();
        }
        return;
      case "lineUp":
        this.selectLine(this.selectedLineIndex - 1);
        return;
      case "lineDown":
        this.selectLine(this.selectedLineIndex + 1);
        return;
      case "pageUp":
        this.pageLines(-1);
        return;
      case "pageDown":
        this.pageLines(1);
        return;
      case "previousFile":
        this.selectFile(this.selectedFileIndex - 1);
        return;
      case "nextFile":
        this.selectFile(this.selectedFileIndex + 1);
        return;
      case "submitOrComment":
        if (this.reviewMode) {
          await this.completeReview();
          return;
        }
        if (this.scratchpadMode) {
          await this.completeScratchpad();
          return;
        }
        this.openComment();
        return;
      case "openFilePicker":
        this.openFileModal();
        return;
      case "toggleFileTree":
        await this.toggleFileTree();
        return;
      case "searchFiles":
        await this.openFileSearchModal();
        return;
      case "chooseDiffBase":
        await this.openDiffBaseModal();
        return;
      case "openHelp":
        this.openHelpModal();
        return;
      case "openSession":
        this.openSessionModal();
        return;
      case "replyAgentTurn":
        await this.enterScratchpadMode();
        return;
      case "toggleFileView":
        await this.toggleFileViewMode();
        return;
      case "startReview":
        this.enterReviewMode();
        return;
      case "selectFile":
        this.selectFile(action.index);
        return;
    }
  }

  private async handleFileSearchInputSequence(sequence: string): Promise<void> {
    await this.applyFileSearchAction(searchActionFromRaw(sequence));
  }

  private async handleFileSearchInputKey(key: KeyEvent): Promise<void> {
    await this.applyFileSearchAction(searchActionFromKey(key));
  }

  private async applyFileSearchAction(action: ReturnType<typeof searchActionFromRaw>): Promise<void> {
    if (!action) {
      return;
    }
    switch (action.type) {
      case "forceQuit":
        this.shutdownNow();
        return;
      case "quit":
        this.shutdownNow();
        return;
      case "cancel":
        this.closeFileSearchModal();
        return;
      case "up":
        this.selectFileSearchMatch(this.fileSearchSelectedIndex - 1);
        return;
      case "down":
        this.selectFileSearchMatch(this.fileSearchSelectedIndex + 1);
        return;
      case "pageUp":
        this.pageFileSearch(-1);
        return;
      case "pageDown":
        this.pageFileSearch(1);
        return;
      case "backspace":
        this.input = this.input.slice(0, -1);
        this.updateFileSearchMatches();
        this.renderFileSearchInputChange();
        return;
      case "submit":
        await this.openSelectedFileSearchMatch();
        return;
      case "insert":
        this.input += action.text;
        this.updateFileSearchMatches();
        this.renderFileSearchInputChange();
        return;
    }
  }

  private async handleDiffBaseModalSequence(sequence: string): Promise<void> {
    await this.applyDiffBaseModalAction(diffBaseActionFromRaw(sequence));
  }

  private async handleDiffBaseModalKey(key: KeyEvent): Promise<void> {
    await this.applyDiffBaseModalAction(diffBaseActionFromKey(key));
  }

  private async applyDiffBaseModalAction(action: ReturnType<typeof diffBaseActionFromRaw>): Promise<void> {
    if (!action) {
      return;
    }
    switch (action.type) {
      case "forceQuit":
        this.shutdownNow();
        return;
      case "quit":
        if (!this.shouldIgnoreQuitKey()) {
          this.shutdownNow();
        }
        return;
      case "close":
        this.closeDiffBaseModal();
        return;
      case "up":
        this.selectDiffBaseCandidate(this.diffBaseSelectedIndex - 1);
        return;
      case "down":
        this.selectDiffBaseCandidate(this.diffBaseSelectedIndex + 1);
        return;
      case "pageUp":
        this.pageDiffBaseCandidates(-1);
        return;
      case "pageDown":
        this.pageDiffBaseCandidates(1);
        return;
      case "submit":
        await this.applySelectedDiffBase();
        return;
    }
  }

  private handleFileModalSequence(sequence: string): void {
    this.applyFileModalAction(fileModalActionFromRaw(sequence));
  }

  private handleFileModalKey(key: KeyEvent): void {
    this.applyFileModalAction(fileModalActionFromKey(key));
  }

  private applyFileModalAction(action: ReturnType<typeof fileModalActionFromRaw>): void {
    if (!action) {
      return;
    }
    switch (action.type) {
      case "forceQuit":
        this.shutdownNow();
        return;
      case "quit":
        if (!this.shouldIgnoreQuitKey()) {
          this.shutdownNow();
        }
        return;
      case "close":
        this.closeFileModal();
        return;
      case "up":
        this.selectFileFromModal(this.selectedFileIndex - 1);
        return;
      case "down":
        this.selectFileFromModal(this.selectedFileIndex + 1);
        return;
      case "pageUp":
      case "pageDown":
      case "submit":
        return;
    }
  }

  private handleHelpModalSequence(sequence: string): void {
    this.applyHelpModalAction(simpleModalActionFromRaw(sequence));
  }

  private handleHelpModalKey(key: KeyEvent): void {
    this.applyHelpModalAction(simpleModalActionFromKey(key));
  }

  private applyHelpModalAction(action: ReturnType<typeof simpleModalActionFromRaw>): void {
    if (!action) {
      return;
    }
    switch (action.type) {
      case "forceQuit":
        this.shutdownNow();
        return;
      case "quit":
        this.shutdownNow();
        return;
      case "close":
        this.closeHelpModal();
        return;
    }
  }

  private handleSessionModalSequence(sequence: string): void {
    this.applySessionModalAction(simpleModalActionFromRaw(sequence));
  }

  private handleSessionModalKey(key: KeyEvent): void {
    this.applySessionModalAction(simpleModalActionFromKey(key));
  }

  private applySessionModalAction(action: ReturnType<typeof simpleModalActionFromRaw>): void {
    if (!action) {
      return;
    }
    switch (action.type) {
      case "forceQuit":
        this.shutdownNow();
        return;
      case "quit":
        this.shutdownNow();
        return;
      case "close":
        this.closeSessionModal();
        return;
    }
  }

  private async connectAdapter(): Promise<void> {
    try {
      await this.adapter.connect?.();
      this.renderStatus();
      this.view?.requestRender();
    } catch (error) {
      this.setStatus(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async refreshDiffAndRender(options: ReadDiffStateOptions = {}): Promise<void> {
    if (this.diffRefreshInFlight) {
      this.pendingDiffRefreshOptions = mergeDiffRefreshOptions(this.pendingDiffRefreshOptions, options);
      return;
    }

    this.diffRefreshInFlight = true;
    try {
      let nextOptions: ReadDiffStateOptions | null = options;
      while (nextOptions) {
        this.pendingDiffRefreshOptions = null;
        if (await this.refreshDiff(nextOptions)) {
          this.renderAll();
        }
        nextOptions = this.pendingDiffRefreshOptions;
      }
    } finally {
      this.diffRefreshInFlight = false;
    }
  }

  private async refreshDiff(options: ReadDiffStateOptions = {}): Promise<boolean> {
    const fallbackSelectedFilePath = this.selectedFile()?.filePath ?? null;
    const nextState = await readDiffState(this.cwd, this.readDiffStateOptions(options));
    this.initialWorktreeConsumed = true;
    const nextSignature = diffStateSignature(nextState);
    if (this.diffLoaded && nextSignature === this.diffStateSignature) {
      return false;
    }
    const selectedFilePath = this.selectedFile()?.filePath ?? fallbackSelectedFilePath;
    this.state = nextState;
    this.diffLoaded = true;
    this.diffStateSignature = nextSignature;
    this.ensureOpenedFilesInState();
    if (selectedFilePath) {
      const nextIndex = this.state.files.findIndex((file) => file.filePath === selectedFilePath);
      if (nextIndex >= 0) {
        this.selectedFileIndex = nextIndex;
      }
    }
    if (this.selectedFileIndex >= this.state.files.length) {
      this.selectedFileIndex = Math.max(0, this.state.files.length - 1);
    }
    this.clampNavScrollOffset();
    this.clampFileModalScrollOffset();
    this.clampDiffBaseModalScrollOffset();
    this.revealSelectedFileInNav();
    this.revealSelectedFileInModal();
    this.preserveSyntaxHighlights();
    const selectedFile = this.selectedFile();
    if (this.fileViewMode === "file" && selectedFile && !this.scratchpadMode) {
      await this.refreshCurrentFileView(selectedFile);
    }
    const selectedLines = this.selectedLines();
    if (!selectedFile || this.selectedLineIndex >= selectedLines.length) {
      this.selectedLineIndex = 0;
      this.revealSelectedLine = true;
    }
    return true;
  }

  private readDiffStateOptions(options: ReadDiffStateOptions): ReadDiffStateOptions {
    return {
      ...options,
      ...(this.diffBaseOverride && !options.baseRef ? { baseRef: this.diffBaseOverride } : {}),
      ...(!this.initialWorktreeConsumed && this.initialWorktree?.cwd === this.cwd ? { worktree: this.initialWorktree } : {}),
    };
  }

  private renderAll(): void {
    this.renderDockSpacer();
    this.renderFileTreeSidebar();
    this.renderNav();
    this.renderDiff();
    this.renderStatus();
    this.renderFileModal();
    this.renderFileSearchModal();
    this.renderDiffBaseModal();
    this.renderHelpModal();
    this.renderSessionModal();
    this.view?.requestRender();
  }

  private renderFileTreeSidebar(): void {
    if (!this.view) {
      return;
    }
    if (this.fileTreeOpen) {
      this.fileTreeRows = this.buildFileTreeRows();
      this.clampFileTreeScrollOffset();
    }
    this.view.renderFileTreeSidebar({
      open: this.fileTreeOpen,
      rows: this.fileTreeRows,
      scrollOffset: this.fileTreeScrollOffset,
      loading: this.searchableFilesRefreshing && !this.searchableFilesLoaded,
    });
  }

  private renderNav(): void {
    if (!this.view) {
      return;
    }
    const navHeight = this.navHeight();
    this.clampNavScrollOffset();
    this.view.renderNav({
      navMode: this.navMode,
      navHeight,
      files: this.state.files,
      scrollOffset: this.navScrollOffset,
      visibleFileCount: this.visibleNavFileCount(),
      selectedFileIndex: this.selectedFileIndex,
    });
  }

  private renderDiff(): void {
    if (!this.view) {
      return;
    }
    const view = this.view;

    for (const id of this.lineIds) {
      view.diffScroll.remove(id);
    }
    this.lineIds = [];
    this.lineRenderables = new Map();
    this.inlineCommentText = null;
    this.inlineCommentHeightRows = 0;

    if (this.mode === "scratchpad-content") {
      this.renderScratchpadContentInput();
      return;
    }

    const file = this.selectedFile();
    const diffWidth = this.diffPaneWidth();
    const diffContentWidth = this.diffContentWidth();
    const hasLeftBorder = this.diffHasLeftBorder();
    const borderFg = this.diffBorderFg();
    let renderedRows = 0;
    if (!file) {
      const emptyMessage = this.diffLoaded
        ? " No working-tree diff. Start an agent edit or run with changes present."
        : " Loading working-tree diff...";
      const empty = view.createTextRenderable({
        id: "gadget-empty-diff",
        height: 1,
        width: diffWidth,
        fg: COLORS.text,
        bg: COLORS.bg,
        content: formatDiffViewportRow(emptyMessage, diffWidth, {
          fg: COLORS.muted,
          bg: COLORS.bg,
        }, hasLeftBorder, borderFg),
        selectable: false,
      });
      view.diffScroll.add(empty);
      this.lineIds.push(empty.id);
      renderedRows += 1;
      this.addDiffFillerRows(renderedRows, diffWidth, hasLeftBorder, borderFg);
      return;
    }

    const lines = this.selectedLines();
    const fullFileHighlights = this.fileViewMode === "file" ? fullFileLineHighlights(file) : undefined;
    lines.forEach((line, index) => {
      const selected = index === this.selectedLineIndex;
      const reviewKey = reviewCommentKey(file.filePath, line);
      const scratchpadKey = scratchpadCommentKey(line.newLine ?? index + 1);
      const savedReviewComment = this.reviewMode ? this.reviewComments.get(reviewKey) ?? null : null;
      const savedScratchpadComment = this.scratchpadMode ? this.scratchpadComments.get(scratchpadKey) ?? null : null;
      const savedAnnotationComment = savedReviewComment ?? savedScratchpadComment;
      const editingReviewComment = this.reviewMode && this.mode === "comment" && this.activeReviewTarget?.key === reviewKey;
      const editingScratchpadComment = this.scratchpadMode && this.mode === "comment" && this.activeScratchpadTarget?.key === scratchpadKey;
      const editingAnnotationComment = editingReviewComment || editingScratchpadComment;
      formatDiffRows(line, diffContentWidth, this.syntaxLineChunks.get(line.id)).forEach((content, rowIndex) => {
        const row = view.createTextRenderable({
          id: `gadget-line-${index}-${rowIndex}`,
          height: 1,
          width: diffWidth,
          fg: COLORS.text,
          bg: COLORS.bg,
          truncate: true,
          content: formatDiffViewportDiffRow(content, diffWidth, {
            fg: selected ? "#ffffff" : lineFg(line),
            bg: selected ? COLORS.selected : lineBg(line, fullFileHighlights),
          }, hasLeftBorder, borderFg),
          selectable: false,
          onMouseDown: (event) => {
            if (event.button !== MouseButton.LEFT) {
              return;
            }
            if (this.shouldIgnoreDiffClick()) {
              return;
            }
            this.openCommentAtLine(index);
          },
        });
        view.diffScroll.add(row);
        this.lineIds.push(row.id);
        const lineRows = this.lineRenderables.get(index) ?? [];
        lineRows.push(row);
        this.lineRenderables.set(index, lineRows);
        renderedRows += 1;
      });

      if (this.isAnnotationMode() && (savedAnnotationComment || editingAnnotationComment)) {
        const commentWidth = this.diffPaneWidth();
        const commentBox = createInlineCommentBox({
          renderer: view.renderer,
          id: `gadget-review-comment-${index}`,
          value: editingAnnotationComment ? this.input : savedAnnotationComment?.value ?? "",
          width: commentWidth,
          submitLabel: "Save",
          showHints: editingAnnotationComment,
          showDeleteHint: editingAnnotationComment && savedAnnotationComment !== null,
          ...(editingAnnotationComment ? { cursorVisible: this.commentCursorVisible } : {}),
        });
        const openSavedComment = () => this.openCommentAtLine(index);
        commentBox.box.onMouseDown = (event) => {
          if (event.button !== MouseButton.LEFT || this.shouldIgnoreDiffClick()) {
            return;
          }
          openSavedComment();
        };
        commentBox.text.onMouseDown = (event) => {
          if (event.button !== MouseButton.LEFT || this.shouldIgnoreDiffClick()) {
            return;
          }
          openSavedComment();
        };
        view.diffScroll.add(commentBox.box);
        this.lineIds.push(commentBox.box.id);
        if (editingAnnotationComment) {
          this.inlineCommentText = commentBox.text;
          this.inlineCommentHeightRows = commentBox.height;
        }
        renderedRows += commentBox.height;
      } else if (selected && this.mode === "comment") {
        const commentWidth = this.diffPaneWidth();
        const commentBox = createInlineCommentBox({
          renderer: view.renderer,
          value: this.input,
          width: commentWidth,
          submitLabel: this.activeCommentSubmitLabel(),
          cursorVisible: this.commentCursorVisible,
        });
        view.diffScroll.add(commentBox.box);
        this.lineIds.push(commentBox.box.id);
        this.inlineCommentText = commentBox.text;
        this.inlineCommentHeightRows = commentBox.height;
        renderedRows += commentBox.height;
      }
    });

    this.addDiffFillerRows(renderedRows, diffWidth, hasLeftBorder, borderFg);

    if (lines[this.selectedLineIndex] && this.revealSelectedLine) {
      this.revealSelectionInViewport(this.pinSelectedLineToTop, this.centerSelectedLineInViewport);
      this.revealSelectedLine = false;
      this.pinSelectedLineToTop = false;
      this.centerSelectedLineInViewport = false;
    }
    this.refreshVisibleSyntaxHighlights();
  }

  private renderScratchpadContentInput(): void {
    if (!this.view) {
      return;
    }
    const view = this.view;

    const diffWidth = this.diffPaneWidth();
    const hasLeftBorder = this.diffHasLeftBorder();
    const borderFg = this.diffBorderFg();
    let renderedRows = 0;
    const title = view.createTextRenderable({
      id: "gadget-scratchpad-content-title",
      height: 1,
      width: diffWidth,
      fg: COLORS.muted,
      bg: COLORS.bg,
      content: formatDiffViewportRow(" Scratchpad content", diffWidth, {
        fg: COLORS.muted,
        bg: COLORS.bg,
      }, hasLeftBorder, borderFg),
      selectable: false,
    });
    view.diffScroll.add(title);
    this.lineIds.push(title.id);
    renderedRows += 1;

    const commentBox = createInlineCommentBox({
      renderer: view.renderer,
      id: "gadget-scratchpad-content-input",
      value: this.input,
      width: diffWidth,
      submitLabel: "Start",
      showHints: true,
    });
    view.diffScroll.add(commentBox.box);
    this.lineIds.push(commentBox.box.id);
    this.inlineCommentText = commentBox.text;
    this.inlineCommentHeightRows = commentBox.height;
    renderedRows += commentBox.height;
    this.addDiffFillerRows(renderedRows, diffWidth, hasLeftBorder, borderFg);
  }

  private renderStatus(): void {
    if (!this.view) {
      return;
    }
    const file = this.selectedFile();
    this.view.renderStatus({
      cwdName: basename(this.state.cwd),
      worktreeName: this.hasWorktree() ? this.state.worktreeName : "",
      branchName: this.state.branchName,
      width: this.diffPaneWidth(),
      hasLeftBorder: this.diffHasLeftBorder(),
      borderFg: this.diffBorderFg(),
      annotationModeLabel: this.annotationModeLabel(),
      bottomDockOpen: this.bottomDockOpen(),
      fileLabel: this.scratchpadMode ? "Scratchpad" : file?.filePath ?? "no file",
      actionHint: this.annotationActionHint(),
    });
  }

  private renderDockSpacer(): void {
    if (!this.view) {
      return;
    }
    this.view.renderDockSpacer({
      bottomBarHeight: this.diffBottomBarHeight(),
      bottomDockHeight: this.bottomDockHeight(),
      width: this.diffPaneWidth(),
    });
  }

  private renderFileModal(): void {
    if (!this.view) {
      return;
    }

    if (this.fileModalOpen) {
      this.clampFileModalScrollOffset();
    }
    this.view.renderFileModal({
      open: this.fileModalOpen,
      files: this.state.files,
      selectedFileIndex: this.selectedFileIndex,
      scrollOffset: this.fileModalScrollOffset,
      currentFilePath: this.selectedFile()?.filePath ?? "no file",
    });
  }

  private renderFileSearchModal(): void {
    if (!this.view) {
      return;
    }
    this.view.renderFileSearchModal({
      open: this.fileSearchModalOpen,
      query: this.input,
      matches: this.fileSearchMatches,
      placeholder: this.fileSearchPlaceholder(),
      selectedMatchIndex: this.fileSearchSelectedIndex,
      scrollOffset: this.fileSearchScrollOffset,
      currentFilePath: this.selectedFile()?.filePath ?? "no file",
    });
  }

  private renderDiffBaseModal(): void {
    if (!this.view) {
      return;
    }
    if (this.diffBaseModalOpen) {
      this.clampDiffBaseModalScrollOffset();
    }
    this.view.renderDiffBaseModal({
      open: this.diffBaseModalOpen,
      candidates: this.diffBaseCandidates,
      selectedCandidateIndex: this.diffBaseSelectedIndex,
      scrollOffset: this.diffBaseModalScrollOffset,
      currentBaseLabel: this.state.baseRefLabel,
      loading: this.diffBaseLoading,
      error: this.diffBaseError,
    });
  }

  private renderHelpModal(): void {
    if (!this.view) {
      return;
    }
    this.view.renderHelpModal(this.helpModalOpen);
  }

  private renderSessionModal(): void {
    if (!this.view) {
      return;
    }
    this.view.renderSessionModal(this.sessionModalOpen, this.adapter.getSessionInfo?.() ?? { mode: this.adapter.label });
  }

  private renderCommentInputChange(): void {
    if (this.mode !== "comment" || !this.inlineCommentText) {
      this.renderAll();
      return;
    }

    this.commentCursorVisible = true;
    const commentWidth = this.diffPaneWidth();
    const commentHeight = inlineCommentHeight(this.input, commentWidth, true);
    if (commentHeight !== this.inlineCommentHeightRows) {
      this.renderAll();
      return;
    }

    this.renderInlineCommentInput();
  }

  private renderInlineCommentInput(): void {
    if (this.mode !== "comment" || !this.inlineCommentText) {
      return;
    }

    this.inlineCommentText.content = formatInlineComment(
      this.input,
      this.diffPaneWidth(),
      this.activeCommentSubmitLabel(),
      true,
      this.isEditingSavedReviewComment() || this.isEditingSavedScratchpadComment(),
      this.commentCursorVisible,
    );
    this.view?.requestRender();
  }

  private preserveSyntaxHighlights(): void {
    const generation = this.syntaxGeneration + 1;
    this.syntaxGeneration = generation;
    const nextLineChunks = new Map<string, TextChunk[]>();
    const nextLineKeys = new Map<string, string>();

    for (const file of this.state.files) {
      preserveSyntaxLineChunks(file.lines, this.syntaxLineChunks, this.syntaxLineKeys, nextLineChunks, nextLineKeys);
    }
    for (const lines of this.fullFileLines.values()) {
      preserveSyntaxLineChunks(lines, this.syntaxLineChunks, this.syntaxLineKeys, nextLineChunks, nextLineKeys);
    }
    this.syntaxLineChunks = nextLineChunks;
    this.syntaxLineKeys = nextLineKeys;
  }

  private refreshVisibleSyntaxHighlights(): void {
    if (!this.view) {
      return;
    }
    const file = this.selectedFile();
    const filetype = file ? pathToFiletype(file.filePath) : null;
    if (!file || !filetype) {
      return;
    }

    const lines = this.selectedLines();
    const lineIndexes = visibleLineIndexes(
      lines,
      Math.round(this.view.diffScroll.scrollTop),
      this.visibleDiffRows(),
      this.diffContentWidth(),
      SYNTAX_HIGHLIGHT_OVERSCAN_ROWS,
    );
    if (!lineIndexes.includes(this.selectedLineIndex)) {
      lineIndexes.push(this.selectedLineIndex);
    }

    const generation = this.syntaxGeneration;
    const tasks = this.visibleSyntaxHighlightTasks(file.filePath, filetype, lines, lineIndexes, generation);
    if (tasks.length === 0) {
      return;
    }

    void Promise.all(tasks).then((results) => {
      if (generation !== this.syntaxGeneration || !results.some(Boolean)) {
        return;
      }
      for (const index of lineIndexes) {
        this.updateRenderedLine(index);
      }
      this.view?.requestRender();
    });
  }

  private visibleSyntaxHighlightTasks(
    filePath: string,
    filetype: string,
    lines: DiffLineRef[],
    lineIndexes: number[],
    generation: number,
  ): Array<Promise<boolean>> {
    if (this.fileViewMode === "file") {
      const visibleLines = lineIndexes.map((index) => lines[index]).filter((line): line is DiffLineRef => {
        return line !== undefined && line.kind !== "file" && this.shouldHighlightLine(line);
      });
      return this.highlightVisibleLineGroup(filePath, filetype, "full", visibleLines, generation);
    }

    const oldLines = lineIndexes.map((index) => lines[index]).filter((line): line is DiffLineRef => {
      return line !== undefined && (line.kind === "context" || line.kind === "remove") && this.shouldHighlightLine(line);
    });
    const newLines = lineIndexes.map((index) => lines[index]).filter((line): line is DiffLineRef => {
      return line !== undefined && (line.kind === "context" || line.kind === "add") && this.shouldHighlightLine(line);
    });
    return [
      ...this.highlightVisibleLineGroup(filePath, filetype, "old", oldLines, generation),
      ...this.highlightVisibleLineGroup(filePath, filetype, "new", newLines, generation),
    ];
  }

  private shouldHighlightLine(line: DiffLineRef): boolean {
    return this.syntaxLineKeys.get(line.id) !== syntaxLineKey(line) || !this.syntaxLineChunks.has(line.id);
  }

  private highlightVisibleLineGroup(
    filePath: string,
    filetype: string,
    side: HighlightCacheSide,
    lines: DiffLineRef[],
    generation: number,
  ): Array<Promise<boolean>> {
    const document = buildHighlightDocument(lines);
    if (document.lines.length === 0) {
      return [];
    }

    const cacheKey = syntaxDocumentCacheKey(filePath, filetype, side, document.lines);
    const documentKey = syntaxDocumentKey(filetype, document.content);
    const cached = this.syntaxDocumentCache.get(cacheKey);
    if (cached?.documentKey === documentKey) {
      applySyntaxChunks(document, cached.chunksByLine, this.syntaxLineChunks, this.syntaxLineKeys);
      return [Promise.resolve(true)];
    }
    if (this.pendingSyntaxDocuments.has(cacheKey)) {
      return [];
    }

    this.pendingSyntaxDocuments.add(cacheKey);
    return [this.highlightVisibleLineGroupAsync(cacheKey, documentKey, document, filetype, generation)];
  }

  private async highlightVisibleLineGroupAsync(
    cacheKey: string,
    documentKey: string,
    document: HighlightDocument,
    filetype: string,
    generation: number,
  ): Promise<boolean> {
    try {
      const result = await this.syntaxClient.highlightOnce(document.content, filetype);
      if (generation !== this.syntaxGeneration || !result.highlights || result.highlights.length === 0) {
        return false;
      }

      const chunksByLine = splitTextChunksByLine(
        treeSitterToTextChunks(document.content, result.highlights, this.syntaxStyle, { enabled: false }),
      );
      this.syntaxDocumentCache.set(cacheKey, { documentKey, chunksByLine });
      applySyntaxChunks(document, chunksByLine, this.syntaxLineChunks, this.syntaxLineKeys);
      return true;
    } catch {
      // Syntax highlighting is best-effort; plain diff text is the fallback.
      return false;
    } finally {
      this.pendingSyntaxDocuments.delete(cacheKey);
    }
  }

  private async refreshCurrentFileView(file: DiffFile): Promise<void> {
    const lines = await readCurrentFileLines(this.state.cwd, file.filePath);
    this.fullFileLines.set(file.filePath, lines);
  }

  private async refreshSelectedCurrentFileView(): Promise<void> {
    const file = this.selectedFile();
    if (!file) {
      return;
    }
    await this.refreshCurrentFileView(file);
  }

  private hasWorktree(): boolean {
    return this.state.worktreePath !== this.state.repositoryRoot;
  }

  private diffBorderFg(): string {
    return this.isAnnotationMode() ? REVIEW_BORDER_FG : DIFF_BORDER_FG;
  }

  private annotationActionHint(): string | null {
    if (!this.isAnnotationMode() || this.isEditingAnnotationComment() || this.mode === "scratchpad-content") {
      return null;
    }
    const submitLabel = this.adapter.label === "clipboard" ? "Copy" : "Submit";
    return `${submitLabel} [Enter] | Discard [Esc]`;
  }

  private annotationModeLabel(): string {
    if (this.reviewMode) {
      return `Review [${this.reviewCommentCount()}]`;
    }
    if (this.scratchpadMode) {
      return `Scratchpad [${this.scratchpadCommentCount()}]`;
    }
    return "";
  }

  private isAnnotationMode(): boolean {
    return this.reviewMode || this.scratchpadMode;
  }

  private isEditingAnnotationComment(): boolean {
    return this.isEditingReviewComment() || this.isEditingScratchpadComment();
  }

  private reviewCommentCount(): number {
    const unsavedActiveComment = this.isEditingReviewComment() &&
      this.activeReviewTarget &&
      !this.reviewComments.has(this.activeReviewTarget.key) &&
      this.input.trim().length > 0;
    return this.reviewComments.size + (unsavedActiveComment ? 1 : 0);
  }

  private isEditingReviewComment(): boolean {
    return this.reviewMode && this.mode === "comment" && this.activeReviewTarget !== null;
  }

  private isEditingSavedReviewComment(): boolean {
    return this.isEditingReviewComment() && this.activeReviewTarget !== null && this.reviewComments.has(this.activeReviewTarget.key);
  }

  private scratchpadCommentCount(): number {
    const unsavedActiveComment = this.isEditingScratchpadComment() &&
      this.activeScratchpadTarget &&
      !this.scratchpadComments.has(this.activeScratchpadTarget.key) &&
      this.input.trim().length > 0;
    return this.scratchpadComments.size + (unsavedActiveComment ? 1 : 0);
  }

  private isEditingScratchpadComment(): boolean {
    return this.scratchpadMode && this.mode === "comment" && this.activeScratchpadTarget !== null;
  }

  private isEditingSavedScratchpadComment(): boolean {
    return this.isEditingScratchpadComment() && this.activeScratchpadTarget !== null && this.scratchpadComments.has(this.activeScratchpadTarget.key);
  }

  private diffPaneWidth(): number {
    if (!this.view) {
      return 80;
    }
    return Math.max(1, this.view.width - navWidthFor(this.navMode) - (this.fileTreeOpen ? this.fileTreeWidth() : 0));
  }

  private diffContentWidth(): number {
    return Math.max(1, this.diffPaneWidth() - 1 - (this.diffHasLeftBorder() ? 1 : 0));
  }

  private diffHasLeftBorder(): boolean {
    return this.navMode === "compact" && !this.fileTreeOpen;
  }

  private fileTreeWidth(): number {
    if (!this.view) {
      return FILE_TREE_SIDEBAR_WIDTH;
    }
    return clamp(FILE_TREE_SIDEBAR_WIDTH, 18, Math.max(18, this.view.width - 20));
  }

  private diffViewportHeight(): number {
    if (!this.view) {
      return 20;
    }
    return Math.max(0, this.view.height - DIFF_TOP_BAR_LINES - this.diffBottomBarHeight() - INPUT_LINES - this.bottomDockHeight());
  }

  private visibleDiffRows(): number {
    return Math.max(1, this.diffViewportHeight());
  }

  private bottomDockHeight(): number {
    if (!this.view) {
      return 0;
    }
    if (this.diffBaseModalOpen) {
      return this.view.diffBaseModal.renderedHeight(this.diffBaseCandidates.length, this.view.height);
    }
    if (this.fileSearchModalOpen) {
      return this.view.fileSearchModal.renderedHeight(this.fileSearchMatches.length, this.view.height);
    }
    if (this.fileModalOpen) {
      return this.view.fileSelectorModal.renderedHeight(this.state.files, this.view.height);
    }
    return 0;
  }

  private bottomDockOpen(): boolean {
    return this.fileModalOpen || this.fileSearchModalOpen || this.diffBaseModalOpen;
  }

  private diffBottomBarHeight(): number {
    return this.bottomDockOpen() ? 0 : DIFF_BOTTOM_BAR_LINES;
  }

  private fileTreeVisibleRows(): number {
    if (!this.view) {
      return 1;
    }
    return this.view.fileTreeSidebar.visibleRows(this.view.height);
  }

  private fileModalVisibleRows(): number {
    if (!this.view) {
      return 1;
    }
    return this.view.fileSelectorModal.visibleRows(this.state.files, this.view.height);
  }

  private fileSearchModalVisibleRows(): number {
    if (!this.view) {
      return 1;
    }
    return this.view.fileSearchModal.visibleRows(this.fileSearchMatches.length, this.view.height);
  }

  private diffBaseModalVisibleRows(): number {
    if (!this.view) {
      return 1;
    }
    return this.view.diffBaseModal.visibleRows(this.diffBaseCandidates.length, this.view.height);
  }

  private addDiffFillerRows(startRow: number, width: number, hasLeftBorder: boolean, borderFg: string): void {
    if (!this.view) {
      return;
    }

    for (let rowIndex = startRow; rowIndex < this.diffViewportHeight(); rowIndex += 1) {
      const row = this.view.createTextRenderable({
        id: `gadget-filler-line-${rowIndex}`,
        height: 1,
        width,
        fg: COLORS.text,
        bg: COLORS.bg,
        truncate: true,
        content: formatDiffViewportRow("", width, { fg: COLORS.text, bg: COLORS.bg }, hasLeftBorder, borderFg),
        selectable: false,
      });
      this.view.diffScroll.add(row);
      this.lineIds.push(row.id);
    }
  }

  private navHeight(): number {
    if (!this.view) {
      return 20;
    }
    return Math.max(1, this.view.height - INPUT_LINES);
  }

  private visibleNavFileCount(): number {
    if (this.navMode === "compact") {
      return Math.max(1, this.navHeight() - 1);
    }
    return Math.max(1, Math.ceil(this.visibleNormalNavFileRows() / NAV_CARD_HEIGHT));
  }

  private visibleNormalNavFileRows(): number {
    return Math.max(0, this.navHeight() - 2);
  }

  private clampedNavScrollOffset(offset: number): number {
    const maxOffset = Math.max(0, this.state.files.length - this.visibleNavFileCount());
    return clamp(offset, 0, maxOffset);
  }

  private clampNavScrollOffset(): void {
    this.navScrollOffset = this.clampedNavScrollOffset(this.navScrollOffset);
  }

  private clampedFileModalScrollOffset(offset: number): number {
    const maxOffset = Math.max(0, this.state.files.length - this.fileModalVisibleRows());
    return clamp(offset, 0, maxOffset);
  }

  private clampedFileTreeScrollOffset(offset: number): number {
    const maxOffset = Math.max(0, this.fileTreeRows.length - this.fileTreeVisibleRows());
    return clamp(offset, 0, maxOffset);
  }

  private clampedFileSearchScrollOffset(offset: number): number {
    const maxOffset = Math.max(0, this.fileSearchMatches.length - this.fileSearchModalVisibleRows());
    return clamp(offset, 0, maxOffset);
  }

  private clampedDiffBaseModalScrollOffset(offset: number): number {
    const maxOffset = Math.max(0, this.diffBaseCandidates.length - this.diffBaseModalVisibleRows());
    return clamp(offset, 0, maxOffset);
  }

  private clampFileModalScrollOffset(): void {
    this.fileModalScrollOffset = this.clampedFileModalScrollOffset(this.fileModalScrollOffset);
  }

  private clampFileTreeScrollOffset(): void {
    this.fileTreeScrollOffset = this.clampedFileTreeScrollOffset(this.fileTreeScrollOffset);
  }

  private clampFileSearchScrollOffset(): void {
    this.fileSearchScrollOffset = this.clampedFileSearchScrollOffset(this.fileSearchScrollOffset);
  }

  private clampDiffBaseModalScrollOffset(): void {
    this.diffBaseModalScrollOffset = this.clampedDiffBaseModalScrollOffset(this.diffBaseModalScrollOffset);
  }

  private revealSelectedFileInNav(): void {
    const visibleFileCount = this.visibleNavFileCount();
    if (this.selectedFileIndex < this.navScrollOffset) {
      this.navScrollOffset = this.selectedFileIndex;
    } else if (this.selectedFileIndex >= this.navScrollOffset + visibleFileCount) {
      this.navScrollOffset = this.selectedFileIndex - visibleFileCount + 1;
    }
    this.clampNavScrollOffset();
  }

  private revealSelectedFileInModal(): void {
    const visibleRows = this.fileModalVisibleRows();
    if (this.selectedFileIndex < this.fileModalScrollOffset) {
      this.fileModalScrollOffset = this.selectedFileIndex;
    } else if (this.selectedFileIndex >= this.fileModalScrollOffset + visibleRows) {
      this.fileModalScrollOffset = this.selectedFileIndex - visibleRows + 1;
    }
    this.clampFileModalScrollOffset();
  }

  private revealSelectedFileInTree(): void {
    const selectedFilePath = this.selectedFile()?.filePath;
    if (!selectedFilePath) {
      return;
    }
    this.expandFileTreePath(selectedFilePath);
    this.fileTreeRows = this.buildFileTreeRows();
    const rowIndex = this.fileTreeRows.findIndex((row) => row.type === "file" && row.path === selectedFilePath);
    if (rowIndex < 0) {
      return;
    }
    const visibleRows = this.fileTreeVisibleRows();
    if (rowIndex < this.fileTreeScrollOffset) {
      this.fileTreeScrollOffset = rowIndex;
    } else if (rowIndex >= this.fileTreeScrollOffset + visibleRows) {
      this.fileTreeScrollOffset = rowIndex - visibleRows + 1;
    }
    this.clampFileTreeScrollOffset();
  }

  private revealSelectedFileSearchMatch(): void {
    const visibleRows = this.fileSearchModalVisibleRows();
    if (this.fileSearchSelectedIndex < this.fileSearchScrollOffset) {
      this.fileSearchScrollOffset = this.fileSearchSelectedIndex;
    } else if (this.fileSearchSelectedIndex >= this.fileSearchScrollOffset + visibleRows) {
      this.fileSearchScrollOffset = this.fileSearchSelectedIndex - visibleRows + 1;
    }
    this.clampFileSearchScrollOffset();
  }

  private revealSelectedDiffBaseCandidate(): void {
    const visibleRows = this.diffBaseModalVisibleRows();
    if (this.diffBaseSelectedIndex < this.diffBaseModalScrollOffset) {
      this.diffBaseModalScrollOffset = this.diffBaseSelectedIndex;
    } else if (this.diffBaseSelectedIndex >= this.diffBaseModalScrollOffset + visibleRows) {
      this.diffBaseModalScrollOffset = this.diffBaseSelectedIndex - visibleRows + 1;
    }
    this.clampDiffBaseModalScrollOffset();
  }

  private fileIndexFromNavRow(row: number): number | null {
    if (this.navMode === "compact") {
      return null;
    }

    if (row <= 0 || row >= this.navHeight() - 1) {
      return null;
    }
    const index = this.navScrollOffset + Math.floor((row - 1) / NAV_CARD_HEIGHT);
    return index < this.state.files.length ? index : null;
  }

  private selectFile(index: number): void {
    if (this.state.files.length === 0) {
      return;
    }
    this.saveActiveAnnotationComment();
    this.selectedFileIndex = clamp(index, 0, this.state.files.length - 1);
    this.revealSelectedFileInNav();
    this.revealSelectedFileInModal();
    this.selectedLineIndex = 0;
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = true;
    this.centerSelectedLineInViewport = false;
    if (this.fileTreeOpen) {
      this.revealSelectedFileInTree();
    }
    if (this.fileViewMode === "file") {
      void this.refreshSelectedCurrentFileView().then(() => {
        this.selectedLineIndex = clamp(this.selectedLineIndex, 0, Math.max(0, this.selectedLines().length - 1));
        this.renderAll();
      }).catch((error) => this.setStatus(error instanceof Error ? error.message : String(error)));
    }
    this.renderAll();
  }

  private scrollNav(delta: number): void {
    const nextOffset = this.navScrollOffset + delta;
    const clampedOffset = this.clampedNavScrollOffset(nextOffset);
    if (clampedOffset === this.navScrollOffset) {
      return;
    }
    this.navScrollOffset = clampedOffset;
    this.renderAll();
  }

  private scrollFileModal(delta: number): void {
    const nextOffset = this.fileModalScrollOffset + delta;
    const clampedOffset = this.clampedFileModalScrollOffset(nextOffset);
    if (clampedOffset === this.fileModalScrollOffset) {
      return;
    }
    this.fileModalScrollOffset = clampedOffset;
    this.renderAll();
  }

  private scrollFileTree(delta: number): void {
    const nextOffset = this.fileTreeScrollOffset + delta;
    const clampedOffset = this.clampedFileTreeScrollOffset(nextOffset);
    if (clampedOffset === this.fileTreeScrollOffset) {
      return;
    }
    this.fileTreeScrollOffset = clampedOffset;
    this.renderAll();
  }

  private scrollFileSearch(delta: number): void {
    const nextOffset = this.fileSearchScrollOffset + delta;
    const clampedOffset = this.clampedFileSearchScrollOffset(nextOffset);
    if (clampedOffset === this.fileSearchScrollOffset) {
      return;
    }
    this.fileSearchScrollOffset = clampedOffset;
    this.renderAll();
  }

  private scrollDiffBaseModal(delta: number): void {
    const nextOffset = this.diffBaseModalScrollOffset + delta;
    const clampedOffset = this.clampedDiffBaseModalScrollOffset(nextOffset);
    if (clampedOffset === this.diffBaseModalScrollOffset) {
      return;
    }
    this.diffBaseModalScrollOffset = clampedOffset;
    this.renderAll();
  }

  private async handleFileTreeRow(row: FileTreeRow): Promise<void> {
    if (row.type === "folder") {
      this.fileTreeExpandedDirs = new Set([...this.folderPathAncestors(row.path), row.path]);
      this.fileTreeRows = this.buildFileTreeRows();
      this.clampFileTreeScrollOffset();
      this.renderAll();
      return;
    }
    await this.openFilePath(row.path, `opened ${row.path}`);
  }

  private buildFileTreeRows(): FileTreeRow[] {
    const selectedFilePath = this.selectedFile()?.filePath ?? "";
    const paths = this.fileTreePaths();
    const root = new Map<string, unknown>();
    for (const filePath of paths) {
      let node = root;
      for (const part of filePath.split("/").filter(Boolean)) {
        if (!node.has(part)) {
          node.set(part, new Map<string, unknown>());
        }
        node = node.get(part) as Map<string, unknown>;
      }
    }

    const rows: FileTreeRow[] = [];
    const visit = (node: Map<string, unknown>, prefix: string, depth: number) => {
      const entries = [...node.entries()].sort(([aName, aValue], [bName, bValue]) => {
        const aFolder = aValue instanceof Map && (aValue as Map<string, unknown>).size > 0;
        const bFolder = bValue instanceof Map && (bValue as Map<string, unknown>).size > 0;
        if (aFolder !== bFolder) {
          return aFolder ? -1 : 1;
        }
        return aName.localeCompare(bName);
      });
      for (const [name, value] of entries) {
        const path = prefix ? `${prefix}/${name}` : name;
        const child = value as Map<string, unknown>;
        const isFolder = child.size > 0 && paths.some((filePath) => filePath.startsWith(`${path}/`));
        if (!isFolder) {
          rows.push({ type: "file", path, name, depth, selected: path === selectedFilePath });
          continue;
        }
        const expanded = this.fileTreeExpandedDirs.has(path);
        rows.push({ type: "folder", path, name, depth, expanded });
        if (expanded) {
          visit(child, path, depth + 1);
        }
      }
    };
    visit(root, "", 0);
    return rows;
  }

  private fileTreePaths(): string[] {
    const paths = new Set([...this.searchableFiles, ...this.state.files.map((file) => file.filePath)]);
    return [...paths].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  private expandFileTreePath(filePath: string): void {
    this.fileTreeExpandedDirs = new Set(this.folderPathAncestors(filePath));
  }

  private folderPathAncestors(path: string): string[] {
    const parts = path.split("/").filter(Boolean);
    const ancestors: string[] = [];
    const limit = path.endsWith("/") ? parts.length : Math.max(0, parts.length - 1);
    for (let index = 0; index < limit; index += 1) {
      ancestors.push(parts.slice(0, index + 1).join("/"));
    }
    return ancestors;
  }

  private selectFileFromModal(index: number): void {
    this.selectFile(index);
  }

  private selectFileSearchMatch(index: number): void {
    if (this.fileSearchMatches.length === 0) {
      return;
    }
    this.fileSearchSelectedIndex = clamp(index, 0, this.fileSearchMatches.length - 1);
    this.revealSelectedFileSearchMatch();
    this.renderAll();
  }

  private pageFileSearch(direction: -1 | 1): void {
    const visibleRows = this.fileSearchModalVisibleRows();
    this.selectFileSearchMatch(this.fileSearchSelectedIndex + direction * visibleRows);
  }

  private async refreshDiffBaseCandidates(): Promise<void> {
    const generation = this.diffBaseLoadGeneration + 1;
    this.diffBaseLoadGeneration = generation;
    this.diffBaseLoading = true;
    this.diffBaseError = null;
    this.renderAll();
    try {
      const candidates = await listDiffBaseCandidates(this.state.cwd, { includePullRequestBase: true });
      if (generation !== this.diffBaseLoadGeneration) {
        return;
      }
      this.diffBaseCandidates = candidates;
      this.diffBaseLoading = false;
      this.selectCurrentDiffBaseCandidate();
      this.clampDiffBaseModalScrollOffset();
      this.renderAll();
    } catch (error) {
      if (generation !== this.diffBaseLoadGeneration) {
        return;
      }
      this.diffBaseLoading = false;
      this.diffBaseError = `Could not load diff bases: ${error instanceof Error ? error.message : String(error)}`;
      this.renderAll();
    }
  }

  private async refreshGitHubDiffBase(): Promise<void> {
    const generation = this.githubDiffBaseLoadGeneration + 1;
    this.githubDiffBaseLoadGeneration = generation;
    const branchName = this.state.branchName;
    const candidates = await listDiffBaseCandidates(this.state.cwd, { includePullRequestBase: true });
    if (
      generation !== this.githubDiffBaseLoadGeneration ||
      this.shuttingDown ||
      this.state.branchName !== branchName ||
      this.diffBaseOverrideSource === "manual"
    ) {
      return;
    }

    if (this.diffBaseModalOpen) {
      this.diffBaseCandidates = candidates;
      this.selectCurrentDiffBaseCandidate();
      this.renderAll();
    }

    const githubCandidate = candidates.find((candidate) => candidate.source === "github");
    if (!githubCandidate || githubCandidate.mergeBase === this.state.baseRef) {
      return;
    }

    this.diffBaseOverride = githubCandidate.ref;
    this.diffBaseOverrideSource = "github";
    this.setStatus(`diff base updated from GitHub: ${githubCandidate.label}`);
    await this.refreshDiffAndRender({ baseRef: githubCandidate.ref });
  }

  private selectCurrentDiffBaseCandidate(): void {
    const selectedIndex = this.diffBaseCandidates.findIndex((candidate) => {
      return candidate.ref === this.diffBaseOverride || candidate.mergeBase === this.state.baseRef;
    });
    this.diffBaseSelectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
    this.revealSelectedDiffBaseCandidate();
  }

  private selectDiffBaseCandidate(index: number): void {
    if (this.diffBaseCandidates.length === 0) {
      return;
    }
    this.diffBaseSelectedIndex = clamp(index, 0, this.diffBaseCandidates.length - 1);
    this.revealSelectedDiffBaseCandidate();
    this.renderAll();
  }

  private pageDiffBaseCandidates(direction: -1 | 1): void {
    const visibleRows = this.diffBaseModalVisibleRows();
    this.selectDiffBaseCandidate(this.diffBaseSelectedIndex + direction * visibleRows);
  }

  private async applySelectedDiffBase(): Promise<void> {
    const candidate = this.diffBaseCandidates[this.diffBaseSelectedIndex];
    if (!candidate || this.diffBaseLoading) {
      return;
    }
    this.diffBaseOverride = candidate.ref;
    this.diffBaseOverrideSource = "manual";
    this.diffBaseModalOpen = false;
    this.setStatus(`diff base: ${candidate.label}`);
    await this.refreshDiffAndRender({ baseRef: candidate.ref });
  }

  private selectLine(index: number): void {
    const lines = this.selectedLines();
    if (lines.length === 0) {
      return;
    }
    this.saveActiveAnnotationComment();
    const previousLineIndex = this.selectedLineIndex;
    this.selectedLineIndex = clamp(index, 0, Math.max(0, lines.length - 1));
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = false;
    this.centerSelectedLineInViewport = false;
    if (this.updateFullFileSelectionInPlace(previousLineIndex, false)) {
      return;
    }
    this.renderAll();
  }

  private pageLines(direction: -1 | 1): void {
    const lines = this.selectedLines();
    if (lines.length === 0) {
      return;
    }
    this.saveActiveAnnotationComment();
    const visibleRows = this.visibleDiffRows();
    const currentVisualRow = this.diffLineVisualStart(this.selectedLineIndex);
    const targetVisualRow = currentVisualRow + direction * visibleRows;
    const previousLineIndex = this.selectedLineIndex;
    this.selectedLineIndex = this.diffLineIndexFromVisualRow(targetVisualRow);
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = true;
    this.centerSelectedLineInViewport = false;
    if (this.updateFullFileSelectionInPlace(previousLineIndex, true)) {
      return;
    }
    this.renderAll();
  }

  private syncSelectionToScroll(): void {
    const lines = this.selectedLines();
    if (this.mode === "comment") {
      return;
    }
    if (lines.length === 0 || !this.view) {
      return;
    }
    const topLine = this.diffLineIndexFromVisualRow(Math.round(this.view.diffScroll.scrollTop));
    if (topLine === this.selectedLineIndex) {
      return;
    }
    const previousLineIndex = this.selectedLineIndex;
    this.selectedLineIndex = topLine;
    this.revealSelectedLine = false;
    this.pinSelectedLineToTop = false;
    this.centerSelectedLineInViewport = false;
    if (this.updateFullFileSelectionInPlace(previousLineIndex, false)) {
      return;
    }
    this.renderAll();
  }

  private updateFullFileSelectionInPlace(previousLineIndex: number, pinToTop: boolean): boolean {
    if (this.fileViewMode !== "file" || this.mode !== "none" || !this.view) {
      return false;
    }
    const currentLineIndex = this.selectedLineIndex;
    const previousUpdated = previousLineIndex === currentLineIndex || this.updateRenderedLine(previousLineIndex);
    const currentUpdated = this.updateRenderedLine(currentLineIndex);
    if (!previousUpdated || !currentUpdated) {
      return false;
    }

    this.revealSelectionInViewport(pinToTop, false);
    this.revealSelectedLine = false;
    this.pinSelectedLineToTop = false;
    this.refreshVisibleSyntaxHighlights();
    this.view?.requestRender();
    return true;
  }

  private updateRenderedLine(lineIndex: number): boolean {
    const file = this.selectedFile();
    const lines = this.selectedLines();
    const line = lines[lineIndex];
    const rows = this.lineRenderables.get(lineIndex);
    if (!line || !rows) {
      return false;
    }

    const diffWidth = this.diffPaneWidth();
    const diffContentWidth = this.diffContentWidth();
    const fullFileHighlights = this.fileViewMode === "file" && file ? fullFileLineHighlights(file) : undefined;
    const visualRows = formatDiffRows(line, diffContentWidth, this.syntaxLineChunks.get(line.id));
    if (visualRows.length !== rows.length) {
      return false;
    }

    const selected = lineIndex === this.selectedLineIndex;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const content = visualRows[rowIndex];
      if (!row || !content) {
        return false;
      }
      row.content = formatDiffViewportDiffRow(content, diffWidth, {
        fg: selected ? "#ffffff" : lineFg(line),
        bg: selected ? COLORS.selected : lineBg(line, fullFileHighlights),
      }, this.diffHasLeftBorder(), this.diffBorderFg());
    }
    return true;
  }

  private diffVisualRowCount(): number {
    return this.selectedLines().reduce((count, line) => count + this.diffLineVisualHeight(line), 0);
  }

  private diffLineVisualStart(lineIndex: number): number {
    const lines = this.selectedLines();
    let row = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      const line = lines[index];
      if (line) {
        row += this.diffLineVisualHeight(line);
      }
    }
    return row;
  }

  private diffLineIndexFromVisualRow(visualRow: number): number {
    const lines = this.selectedLines();
    if (lines.length === 0) {
      return 0;
    }

    const targetRow = Math.max(0, visualRow);
    let row = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }
      row += this.diffLineVisualHeight(line);
      if (targetRow < row) {
        return index;
      }
    }
    return lines.length - 1;
  }

  private diffLineVisualHeight(line: DiffLineRef): number {
    const lineHeight = formatDiffRows(line, this.diffContentWidth()).length;
    if (!this.isAnnotationMode()) {
      return lineHeight;
    }

    const file = this.selectedFile();
    if (!file) {
      return lineHeight;
    }

    const key = this.scratchpadMode ? scratchpadCommentKey(line.newLine ?? 0) : reviewCommentKey(file.filePath, line);
    const savedComment = this.scratchpadMode ? this.scratchpadComments.get(key) : this.reviewComments.get(key);
    const editingComment = this.mode === "comment" && (
      this.scratchpadMode
        ? this.activeScratchpadTarget?.key === key
        : this.activeReviewTarget?.key === key
    );
    if (!savedComment && !editingComment) {
      return lineHeight;
    }

    const value = editingComment ? this.input : savedComment?.value ?? "";
    return lineHeight + inlineCommentHeight(value, this.diffPaneWidth());
  }

  private revealSelectionInViewport(pinToTop: boolean, centerSelection: boolean): void {
    const lines = this.selectedLines();
    if (lines.length === 0 || !this.view) {
      return;
    }
    const line = lines[this.selectedLineIndex];
    if (!line) {
      return;
    }

    const selectedTop = this.diffLineVisualStart(this.selectedLineIndex);
    const selectedBottom = selectedTop + this.diffLineVisualHeight(line) - 1;
    const lineHeight = selectedBottom - selectedTop + 1;
    const visibleRows = this.visibleDiffRows();
    const maxTop = Math.max(0, this.diffVisualRowCount() - visibleRows);
    const currentTop = Math.round(this.view.diffScroll.scrollTop);

    let nextTop = currentTop;
    if (centerSelection) {
      nextTop = selectedTop - Math.floor(Math.max(0, visibleRows - lineHeight) / 2);
    } else if (pinToTop) {
      nextTop = selectedTop;
    } else if (selectedTop < currentTop) {
      nextTop = selectedTop;
    } else if (selectedBottom >= currentTop + visibleRows) {
      nextTop = selectedBottom - visibleRows + 1;
    }

    this.view.diffScroll.scrollTop = clamp(nextTop, 0, maxTop);
  }

  private async toggleFileViewMode(): Promise<void> {
    if (this.scratchpadMode) {
      this.setStatus("scratchpad mode");
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      return;
    }

    const selectedLineNumber = selectedCurrentLineNumber(this.selectedLine()) ?? this.firstVisibleCurrentLineNumber() ?? 1;
    let shouldCenterAfterRender = false;
    if (this.fileViewMode === "diff") {
      this.fileViewMode = "file";
      await this.refreshCurrentFileView(file);
      this.selectedLineIndex = clamp(selectedLineNumber - 1, 0, Math.max(0, this.selectedLines().length - 1));
      this.centerSelectedLineInViewport = true;
      shouldCenterAfterRender = true;
      this.setStatus(`showing current file ${file.filePath}`);
    } else {
      this.fileViewMode = "diff";
      this.selectedLineIndex = nearestLineIndexForLineNumber(file.lines, selectedLineNumber);
      this.centerSelectedLineInViewport = false;
      this.setStatus(`showing diff ${file.filePath}`);
    }

    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = !this.centerSelectedLineInViewport;
    this.renderAll();
    if (shouldCenterAfterRender) {
      this.deferCenterSelectedLineInViewport(file.filePath, selectedLineNumber);
    }
  }

  private deferCenterSelectedLineInViewport(filePath: string, lineNumber: number): void {
    setTimeout(() => {
      const file = this.selectedFile();
      if (this.fileViewMode !== "file" || file?.filePath !== filePath) {
        return;
      }
      if (selectedCurrentLineNumber(this.selectedLine()) !== lineNumber) {
        return;
      }
      this.revealSelectionInViewport(false, true);
      this.refreshVisibleSyntaxHighlights();
      this.view?.requestRender();
    }, 0);
  }

  private firstVisibleCurrentLineNumber(): number | null {
    if (!this.view) {
      return null;
    }
    const lines = this.selectedLines();
    const visibleRows = this.visibleDiffRows();
    const lineIndexes = visibleLineIndexes(lines, Math.round(this.view.diffScroll.scrollTop), visibleRows, this.diffContentWidth(), 0);
    for (const lineIndex of lineIndexes) {
      const lineNumber = selectedCurrentLineNumber(lines[lineIndex] ?? null);
      if (lineNumber !== null) {
        return lineNumber;
      }
    }
    return null;
  }

  private openComment(): void {
    this.openCommentAtLine(this.selectedLineIndex);
  }

  private openCommentAtLine(lineIndex: number): void {
    if (this.scratchpadMode) {
      this.openScratchpadCommentAtLine(lineIndex);
      return;
    }

    const file = this.selectedFile();
    const lines = this.selectedLines();
    const line = lines[lineIndex];
    if (!file || !line) {
      return;
    }
    if (this.mode === "comment" && !this.reviewMode) {
      return;
    }
    this.saveActiveAnnotationComment();
    this.selectedLineIndex = clamp(lineIndex, 0, Math.max(0, lines.length - 1));
    this.closeOverlays();
    this.mode = "comment";
    this.commentCursorVisible = true;
    if (this.reviewMode) {
      const key = reviewCommentKey(file.filePath, line);
      this.activeReviewTarget = {
        key,
        file,
        line,
        includeHunk: this.fileViewMode === "diff",
      };
      this.input = this.reviewComments.get(key)?.value ?? "";
    } else {
      this.input = "";
    }
    this.revealSelectedLine = true;
    this.renderAll();
  }

  private openScratchpadCommentAtLine(lineIndex: number): void {
    const document = this.scratchpadDocument;
    const line = this.selectedLines()[lineIndex];
    const lineNumber = line?.newLine ?? lineIndex + 1;
    if (!document || !line) {
      return;
    }
    this.saveActiveScratchpadComment();
    this.selectedLineIndex = clamp(lineIndex, 0, Math.max(0, document.lines.length - 1));
    this.closeOverlays();
    this.mode = "comment";
    this.commentCursorVisible = true;
    const key = scratchpadCommentKey(lineNumber);
    this.activeScratchpadTarget = {
      key,
      lineNumber,
    };
    this.input = this.scratchpadComments.get(key)?.value ?? "";
    this.revealSelectedLine = true;
    this.renderAll();
  }

  private openFileModal(): void {
    if (this.scratchpadMode) {
      this.setStatus("scratchpad mode");
      return;
    }
    this.saveActiveAnnotationComment();
    this.closeOverlays();
    this.fileModalOpen = true;
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = false;
    this.centerSelectedLineInViewport = false;
    this.revealSelectedFileInModal();
    this.renderAll();
  }

  private async toggleFileTree(): Promise<void> {
    if (this.fileTreeOpen) {
      this.closeFileTree();
      return;
    }
    await this.openFileTree();
  }

  private async openFileTree(): Promise<void> {
    if (this.scratchpadMode) {
      this.setStatus("scratchpad mode");
      return;
    }
    this.saveActiveAnnotationComment();
    this.closeOverlays();
    this.fileTreeOpen = true;
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = false;
    this.centerSelectedLineInViewport = false;
    this.revealSelectedFileInTree();
    if (!this.searchableFilesLoaded) {
      this.setStatus("loading file tree");
      this.renderAll();
      void this.refreshSearchableFileCache({ render: true, updateStatus: false }).then(() => {
        if (!this.fileTreeOpen) {
          return;
        }
        this.revealSelectedFileInTree();
        this.renderAll();
      });
      return;
    }
    this.renderAll();
  }

  private closeFileTree(): void {
    if (!this.fileTreeOpen) {
      return;
    }
    this.fileTreeOpen = false;
    this.renderAll();
  }

  private closeFileModal(): void {
    if (!this.fileModalOpen) {
      return;
    }
    this.fileModalOpen = false;
    this.renderAll();
  }

  private openFileSearchModal(): void {
    if (this.scratchpadMode) {
      this.setStatus("scratchpad mode");
      return;
    }
    this.saveActiveAnnotationComment();
    this.closeOverlays();
    this.mode = "file-search";
    this.input = "";
    this.fileSearchModalOpen = true;
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = false;
    this.centerSelectedLineInViewport = false;
    this.fileSearchSelectedIndex = 0;
    this.fileSearchScrollOffset = 0;
    this.updateFileSearchMatches();
    if (this.searchableFilesLoaded) {
      this.setStatus(`searching ${this.searchableFiles.length} files`);
    } else {
      this.setStatus("loading file search index");
    }
    this.renderAll();
    void this.refreshSearchableFileCache({ render: true, updateStatus: true });
  }

  private closeFileSearchModal(): void {
    if (!this.fileSearchModalOpen) {
      return;
    }
    this.mode = "none";
    this.input = "";
    this.fileSearchModalOpen = false;
    this.renderAll();
  }

  private async openDiffBaseModal(): Promise<void> {
    if (this.scratchpadMode) {
      this.setStatus("scratchpad mode");
      return;
    }
    this.saveActiveAnnotationComment();
    this.closeOverlays();
    this.diffBaseModalOpen = true;
    this.diffBaseModalScrollOffset = 0;
    this.diffBaseError = null;
    this.selectCurrentDiffBaseCandidate();
    this.renderAll();
    await this.refreshDiffBaseCandidates();
  }

  private closeDiffBaseModal(): void {
    if (!this.diffBaseModalOpen) {
      return;
    }
    this.diffBaseModalOpen = false;
    this.renderAll();
  }

  private openHelpModal(): void {
    this.saveActiveAnnotationComment();
    this.closeOverlays();
    this.helpModalOpen = true;
    this.renderAll();
  }

  private closeHelpModal(): void {
    if (!this.helpModalOpen) {
      return;
    }
    this.helpModalOpen = false;
    this.renderAll();
  }

  private openSessionModal(): void {
    this.saveActiveAnnotationComment();
    this.closeOverlays();
    this.sessionModalOpen = true;
    this.renderAll();
  }

  private closeSessionModal(): void {
    if (!this.sessionModalOpen) {
      return;
    }
    this.sessionModalOpen = false;
    this.renderAll();
  }

  private closeOverlays(): void {
    this.fileTreeOpen = false;
    this.fileModalOpen = false;
    this.fileSearchModalOpen = false;
    this.diffBaseModalOpen = false;
    this.helpModalOpen = false;
    this.sessionModalOpen = false;
  }

  private activeCommentSubmitLabel(): string {
    if (this.reviewMode || this.scratchpadMode) {
      return "Save";
    }
    return this.adapter.label === "clipboard" ? "Copy" : "Submit";
  }

  private renderFileSearchInputChange(): void {
    this.renderFileSearchModal();
    this.view?.requestRender();
  }

  private updateFileSearchMatches(): void {
    this.fileSearchMatches = matchFilePaths(this.searchableFileEntries, this.input, FILE_SEARCH_MAX_MATCHES);
    this.fileSearchSelectedIndex = clamp(this.fileSearchSelectedIndex, 0, Math.max(0, this.fileSearchMatches.length - 1));
    this.fileSearchScrollOffset = this.clampedFileSearchScrollOffset(this.fileSearchScrollOffset);
    this.revealSelectedFileSearchMatch();
  }

  private fileSearchPlaceholder(): string {
    if (this.searchableFilesRefreshing && !this.searchableFilesLoaded) {
      return "Loading files...";
    }
    return this.fileSearchMatches.length === 0 ? "No matches" : "";
  }

  private async refreshSearchableFileCache(options: { render: boolean; updateStatus: boolean }): Promise<void> {
    const generation = this.searchableFilesRefreshGeneration + 1;
    this.searchableFilesRefreshGeneration = generation;
    this.searchableFilesRefreshing = true;
    if (options.render) {
      this.renderAll();
    }

    try {
      const files = await listSearchableFiles(this.cwd);
      if (generation !== this.searchableFilesRefreshGeneration) {
        return;
      }
      this.searchableFiles = files;
      this.searchableFileEntries = buildSearchableFileEntries(files);
      this.searchableFilesLoaded = true;
      if (this.fileSearchModalOpen) {
        this.updateFileSearchMatches();
      }
      if (options.updateStatus && this.fileSearchModalOpen) {
        this.setStatus(`searching ${files.length} files`);
      }
    } catch (error) {
      if (generation !== this.searchableFilesRefreshGeneration) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (options.updateStatus || this.fileSearchModalOpen) {
        this.setStatus(`file search failed: ${message}`);
      }
    } finally {
      if (generation === this.searchableFilesRefreshGeneration) {
        this.searchableFilesRefreshing = false;
        if (options.render || this.fileSearchModalOpen) {
          this.renderAll();
        }
      }
    }
  }

  private async openSelectedFileSearchMatch(): Promise<void> {
    const match = this.fileSearchMatches[this.fileSearchSelectedIndex];
    if (!match) {
      return;
    }
    await this.openFilePath(match.filePath, `opened ${match.filePath}`);
  }

  private async openFilePath(filePath: string, status: string): Promise<void> {
    this.openedFilePaths.add(filePath);
    this.ensureOpenedFilesInState();
    const fileIndex = this.state.files.findIndex((file) => file.filePath === filePath);
    if (fileIndex < 0) {
      this.setStatus(`could not open ${filePath}`);
      return;
    }

    this.mode = "none";
    this.input = "";
    this.fileSearchModalOpen = false;
    this.selectedFileIndex = fileIndex;
    this.selectedLineIndex = 0;
    this.fileViewMode = "file";
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = true;
    this.centerSelectedLineInViewport = false;
    this.revealSelectedFileInNav();
    this.revealSelectedFileInModal();
    this.revealSelectedFileInTree();
    await this.refreshCurrentFileView(this.state.files[fileIndex]!);
    this.setStatus(status);
    this.renderAll();
  }

  private async openInitialFileTarget(): Promise<void> {
    if (!this.initialFile) {
      return;
    }

    const filePath = this.initialFile.filePath;
    this.openedFilePaths.add(filePath);
    this.ensureOpenedFilesInState();
    const fileIndex = this.state.files.findIndex((file) => file.filePath === filePath);
    if (fileIndex < 0) {
      this.setStatus(`could not open ${filePath}`);
      return;
    }

    this.mode = "none";
    this.input = "";
    this.closeOverlays();
    this.selectedFileIndex = fileIndex;
    this.fileViewMode = "file";
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = false;
    this.centerSelectedLineInViewport = true;
    this.revealSelectedFileInNav();
    this.revealSelectedFileInModal();
    await this.refreshCurrentFileView(this.state.files[fileIndex]!);
    const targetLine = this.initialFile.lineNumber ?? 1;
    this.selectedLineIndex = clamp(targetLine - 1, 0, Math.max(0, this.selectedLines().length - 1));
    this.setStatus(targetLine > 1 ? `opened ${filePath}:${targetLine}` : `opened ${filePath}`);
    this.renderAll();
    this.deferCenterSelectedLineInViewport(filePath, selectedCurrentLineNumber(this.selectedLine()) ?? targetLine);
  }

  private ensureOpenedFilesInState(): void {
    for (const filePath of this.openedFilePaths) {
      if (!this.state.files.some((file) => file.filePath === filePath)) {
        this.state.files.push(createOpenedFile(filePath));
      }
    }
  }

  private enterReviewMode(): void {
    if (this.reviewMode) {
      this.setStatus("review mode");
      this.renderStatus();
      return;
    }

    this.saveActiveAnnotationComment();
    this.reviewMode = true;
    this.scratchpadMode = false;
    this.scratchpadDocument = null;
    this.scratchpadComments.clear();
    this.activeScratchpadTarget = null;
    this.mode = "none";
    this.input = "";
    this.activeReviewTarget = null;
    this.closeOverlays();
    this.setStatus("review mode");
    this.renderAll();
  }

  private async enterScratchpadMode(): Promise<void> {
    if (this.scratchpadMode) {
      this.setStatus("scratchpad mode");
      this.renderStatus();
      return;
    }

    this.saveActiveAnnotationComment();
    this.reviewMode = false;
    this.reviewComments.clear();
    this.activeReviewTarget = null;
    this.scratchpadMode = true;
    this.scratchpadDocument = null;
    this.scratchpadComments.clear();
    this.activeScratchpadTarget = null;
    this.input = "";
    this.closeOverlays();
    this.setStatus("loading scratchpad");

    let text: string | null = null;
    try {
      text = await this.adapter.getScratchpadText?.() ?? null;
    } catch (error) {
      this.setStatus(`scratchpad autofill failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (text?.trim()) {
      this.startScratchpadDocument(text);
      return;
    }

    this.mode = "scratchpad-content";
    this.setStatus("scratchpad content");
    this.renderAll();
  }

  private cancelReview(): void {
    const count = this.reviewComments.size;
    this.reviewMode = false;
    this.reviewComments.clear();
    this.activeReviewTarget = null;
    this.mode = "none";
    this.input = "";
    this.setStatus(count > 0 ? `review canceled (${count} comments)` : "review canceled");
    this.renderAll();
  }

  private cancelScratchpad(): void {
    const count = this.scratchpadComments.size;
    this.scratchpadMode = false;
    this.scratchpadDocument = null;
    this.scratchpadComments.clear();
    this.activeScratchpadTarget = null;
    this.mode = "none";
    this.input = "";
    this.setStatus(count > 0 ? `scratchpad canceled (${count} comments)` : "scratchpad canceled");
    this.renderAll();
  }

  private saveActiveAnnotationComment(): void {
    if (this.scratchpadMode) {
      this.saveActiveScratchpadComment();
      return;
    }
    this.saveActiveReviewComment();
  }

  private saveActiveReviewComment(): void {
    if (!this.reviewMode || this.mode !== "comment" || !this.activeReviewTarget) {
      return;
    }

    const value = this.input.trim();
    if (value.length === 0) {
      this.reviewComments.delete(this.activeReviewTarget.key);
      this.setStatus("comment removed");
    } else {
      this.reviewComments.set(this.activeReviewTarget.key, {
        ...this.activeReviewTarget,
        value,
        savedAt: Date.now(),
      });
      this.setStatus(`saved ${this.reviewComments.size} review ${pluralize("comment", this.reviewComments.size)}`);
    }

    this.activeReviewTarget = null;
    this.mode = "none";
    this.input = "";
    this.renderAll();
  }

  private saveActiveScratchpadComment(): void {
    if (!this.scratchpadMode || this.mode !== "comment" || !this.activeScratchpadTarget) {
      return;
    }

    const value = this.input.trim();
    if (value.length === 0) {
      this.scratchpadComments.delete(this.activeScratchpadTarget.key);
      this.setStatus("comment removed");
    } else {
      this.scratchpadComments.set(this.activeScratchpadTarget.key, {
        ...this.activeScratchpadTarget,
        value,
        savedAt: Date.now(),
      });
      this.setStatus(`saved ${this.scratchpadComments.size} scratchpad ${pluralize("comment", this.scratchpadComments.size)}`);
    }

    this.activeScratchpadTarget = null;
    this.mode = "none";
    this.input = "";
    this.renderAll();
  }

  private cancelActiveReviewEdit(): void {
    this.activeReviewTarget = null;
    this.mode = "none";
    this.input = "";
    this.setStatus("comment edit canceled");
    this.renderAll();
  }

  private cancelActiveScratchpadEdit(): void {
    this.activeScratchpadTarget = null;
    this.mode = "none";
    this.input = "";
    this.setStatus("comment edit canceled");
    this.renderAll();
  }

  private deleteActiveReviewComment(): void {
    if (!this.reviewMode || this.mode !== "comment" || !this.activeReviewTarget) {
      return;
    }
    if (!this.reviewComments.has(this.activeReviewTarget.key)) {
      return;
    }

    this.reviewComments.delete(this.activeReviewTarget.key);
    this.activeReviewTarget = null;
    this.mode = "none";
    this.input = "";
    this.setStatus("comment deleted");
    this.renderAll();
  }

  private deleteActiveScratchpadComment(): void {
    if (!this.scratchpadMode || this.mode !== "comment" || !this.activeScratchpadTarget) {
      return;
    }
    if (!this.scratchpadComments.has(this.activeScratchpadTarget.key)) {
      return;
    }

    this.scratchpadComments.delete(this.activeScratchpadTarget.key);
    this.activeScratchpadTarget = null;
    this.mode = "none";
    this.input = "";
    this.setStatus("comment deleted");
    this.renderAll();
  }

  private deleteActiveAnnotationComment(): void {
    if (this.scratchpadMode) {
      this.deleteActiveScratchpadComment();
      return;
    }
    this.deleteActiveReviewComment();
  }

  private async completeReview(): Promise<void> {
    if (!this.reviewMode) {
      return;
    }
    if (this.isEditingReviewComment()) {
      this.setStatus("save or cancel the active comment first");
      return;
    }

    const drafts = [...this.reviewComments.values()].sort((left, right) => left.savedAt - right.savedAt);
    if (drafts.length === 0) {
      this.setStatus("review has no comments");
      this.renderAll();
      return;
    }

    const comments = drafts.map((draft) => createComment(this.cwd, draft.file, draft.line, draft.value, { includeHunk: draft.includeHunk }));
    this.setStatus(`${this.adapter.label === "clipboard" ? "copying" : "sending"} ${comments.length} review ${pluralize("comment", comments.length)}`);
    try {
      await this.sendReviewComments(comments);
      for (const comment of comments) {
        comment.status = this.adapter.label === "clipboard" ? "copied" : "sent";
        comment.delivery = this.adapter.label;
      }
      this.reviewMode = false;
      this.reviewComments.clear();
      this.activeReviewTarget = null;
      this.mode = "none";
      this.input = "";
      this.setStatus(`${this.adapter.label === "clipboard" ? "copied" : "sent"} ${comments.length} review ${pluralize("comment", comments.length)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const comment of comments) {
        comment.status = "failed";
        comment.error = message;
      }
      this.setStatus(`review send failed: ${message}`);
    }
    this.renderAll();
  }

  private async completeScratchpad(): Promise<void> {
    if (!this.scratchpadMode) {
      return;
    }
    if (this.mode === "scratchpad-content") {
      this.saveScratchpadContent(this.input);
      return;
    }
    if (this.isEditingScratchpadComment()) {
      this.setStatus("save or cancel the active comment first");
      return;
    }
    if (!this.scratchpadDocument) {
      this.mode = "scratchpad-content";
      this.input = "";
      this.setStatus("scratchpad content");
      this.renderAll();
      return;
    }

    const drafts = [...this.scratchpadComments.values()].sort((left, right) => left.savedAt - right.savedAt);
    if (drafts.length === 0) {
      this.setStatus("scratchpad has no comments");
      this.renderAll();
      return;
    }

    if (!this.adapter.sendPrompt) {
      this.setStatus("scratchpad submit failed: adapter cannot send prompts");
      this.renderAll();
      return;
    }

    const prompt = formatScratchpadPrompt(this.scratchpadDocument, drafts);
    this.setStatus(`${this.adapter.label === "clipboard" ? "copying" : "sending"} ${drafts.length} scratchpad ${pluralize("comment", drafts.length)}`);
    try {
      await this.adapter.sendPrompt(prompt);
      this.scratchpadMode = false;
      this.scratchpadDocument = null;
      this.scratchpadComments.clear();
      this.activeScratchpadTarget = null;
      this.mode = "none";
      this.input = "";
      this.setStatus(`${this.adapter.label === "clipboard" ? "copied" : "sent"} ${drafts.length} scratchpad ${pluralize("comment", drafts.length)}`);
    } catch (error) {
      this.setStatus(`scratchpad send failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.renderAll();
  }

  private saveScratchpadContent(value: string): void {
    if (value.trim().length === 0) {
      this.setStatus("scratchpad content is empty");
      this.renderAll();
      return;
    }

    this.startScratchpadDocument(value);
  }

  private startScratchpadDocument(value: string): void {
    this.scratchpadDocument = createScratchpadDocument(value);
    this.scratchpadComments.clear();
    this.activeScratchpadTarget = null;
    this.mode = "none";
    this.input = "";
    this.fileViewMode = "diff";
    this.selectedLineIndex = 0;
    this.revealSelectedLine = true;
    this.pinSelectedLineToTop = true;
    this.centerSelectedLineInViewport = false;
    this.setStatus(`scratchpad loaded ${this.scratchpadDocument.lines.length} ${pluralize("line", this.scratchpadDocument.lines.length)}`);
    this.renderAll();
  }

  private async sendReviewComments(comments: AgentComment[]): Promise<void> {
    if (this.adapter.sendPrompt) {
      await this.adapter.sendPrompt(formatReviewPrompt(comments));
      return;
    }

    for (const comment of comments) {
      await this.adapter.sendComment(comment);
    }
  }

  private async submitComment(value: string): Promise<void> {
    const file = this.selectedFile();
    const line = this.selectedLine();
    if (!file || !line) {
      return;
    }

    const comment = createComment(this.cwd, file, line, value, { includeHunk: this.fileViewMode === "diff" });
    this.setStatus(`${this.adapter.label === "clipboard" ? "copying" : "sending"} comment for ${file.filePath}`);
    try {
      await this.adapter.sendComment(comment);
      comment.status = this.adapter.label === "clipboard" ? "copied" : "sent";
      comment.delivery = this.adapter.label;
      this.setStatus(`${comment.status} comment ${comment.id}`);
    } catch (error) {
      comment.status = "failed";
      comment.error = error instanceof Error ? error.message : String(error);
      this.setStatus(`send failed: ${comment.error}`);
    }
    this.renderAll();
  }

  private selectedFile(): DiffFile | null {
    if (this.scratchpadMode && this.scratchpadDocument) {
      return scratchpadDocumentToDiffFile(this.scratchpadDocument);
    }
    return this.state.files[this.selectedFileIndex] ?? null;
  }

  private selectedLine(): DiffLineRef | null {
    return this.selectedLines()[this.selectedLineIndex] ?? null;
  }

  private selectedLines(): DiffLineRef[] {
    if (this.scratchpadMode && this.scratchpadDocument) {
      return scratchpadDocumentToDiffFile(this.scratchpadDocument).lines;
    }
    const file = this.selectedFile();
    if (!file) {
      return [];
    }
    if (this.fileViewMode === "file") {
      return this.fullFileLines.get(file.filePath) ?? [currentFileStatusLine(file.filePath, "Loading current file...")];
    }
    return file.lines;
  }

  private setStatus(status: string): void {
    this.status = status;
    this.renderStatus();
    this.view?.requestRender();
  }

  private shouldIgnoreQuitKey(): boolean {
    return Date.now() < this.ignoreQuitKeyUntil;
  }

  private shouldIgnoreDiffClick(): boolean {
    if (!this.terminalFocused) {
      return true;
    }
    return Date.now() < this.ignoreDiffClicksUntil;
  }

  private shutdownNow(): never {
    if (this.shuttingDown) {
      process.exit(0);
    }
    this.shuttingDown = true;

    if (this.rawInputHandler) {
      this.view?.removeInputHandler(this.rawInputHandler);
      this.rawInputHandler = null;
    }
    if (this.commentCursorTimer) {
      clearInterval(this.commentCursorTimer);
      this.commentCursorTimer = null;
    }

    try {
      this.syntaxStyle.destroy();
      this.view?.destroy();
    } catch {
      // Exit path must not get blocked by terminal teardown errors.
    }

    void this.watcher?.close().catch(() => undefined);
    void this.adapter.disconnect?.().catch(() => undefined);
    process.exit(0);
  }
}

function reviewCommentKey(filePath: string, line: DiffLineRef): string {
  return [
    filePath,
    line.kind,
    line.oldLine ?? "",
    line.newLine ?? "",
    line.hunkHeader ?? "",
    line.text,
  ].join("\0");
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
