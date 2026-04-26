import {
  BoxRenderable,
  CliRenderEvents,
  createCliRenderer,
  MouseButton,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import type { DiffBaseCandidate } from "../git";
import type { AgentSessionInfo, DiffFile } from "../types";
import { DiffBaseModal } from "./diff-base-modal";
import { type FuzzyFileMatch, FileSearchModal } from "./file-search-modal";
import { FileSelectorModal } from "./file-selector-modal";
import { FileTreeSidebar, type FileTreeRow } from "./file-tree-sidebar";
import { HelpModal } from "./help-modal";
import { formatDiffBottomBar, formatDiffTopBar, formatFileCardNav, formatNavBox, navWidthFor, type NavMode } from "./nav-format";
import { SessionModal } from "./session-modal";
import { COLORS, DIFF_BOTTOM_BAR_LINES, DIFF_TOP_BAR_LINES, NAV_HINT_OPEN } from "./theme";

export type GadgetRendererCallbacks = {
  navWidth: () => number;
  fileTreeWidth: () => number;
  onFileTreeRowMouseDown: (row: FileTreeRow) => void;
  onFileTreeScroll: (delta: number) => void;
  onNavFileMouseDown: (row: number) => void;
  onNavScroll: (direction: "up" | "down" | "left" | "right" | undefined, shift: boolean) => void;
  onDiffBottomBarMouseDown: () => void;
  onDiffScroll: (direction: "up" | "down" | "left" | "right" | undefined, shift: boolean) => void;
  onSelectFile: (index: number) => void;
  onFileModalScroll: (delta: number) => void;
  onSelectFileSearchMatch: (index: number) => void;
  onFileSearchScroll: (delta: number) => void;
  onSelectDiffBaseCandidate: (index: number) => void;
  onDiffBaseScroll: (delta: number) => void;
};

export class GadgetRenderer {
  readonly renderer: CliRenderer;
  readonly fileTreeSidebar: FileTreeSidebar;
  readonly navText: TextRenderable;
  readonly diffScroll: ScrollBoxRenderable;
  readonly diffTopBarText: TextRenderable;
  readonly diffBottomBarText: TextRenderable;
  readonly diffDockSpacer: TextRenderable;
  readonly fileSelectorModal: FileSelectorModal;
  readonly fileSearchModal: FileSearchModal;
  readonly diffBaseModal: DiffBaseModal;
  readonly helpModal: HelpModal;
  readonly sessionModal: SessionModal;

  static async create(callbacks: GadgetRendererCallbacks): Promise<GadgetRenderer> {
    const renderer = await createCliRenderer({
      useMouse: true,
      exitOnCtrlC: true,
      clearOnShutdown: true,
      backgroundColor: COLORS.bg,
      useKittyKeyboard: {
        disambiguate: true,
        alternateKeys: true,
        reportText: true,
      },
    });
    return new GadgetRenderer(renderer, callbacks);
  }

  private constructor(
    renderer: CliRenderer,
    private readonly callbacks: GadgetRendererCallbacks,
  ) {
    this.renderer = renderer;

    const root = new BoxRenderable(renderer, {
      id: "gadget-root",
      width: "100%",
      height: "100%",
      flexDirection: "row",
      backgroundColor: COLORS.bg,
    });

    this.fileTreeSidebar = new FileTreeSidebar(renderer, {
      onSelectRow: callbacks.onFileTreeRowMouseDown,
      onScroll: callbacks.onFileTreeScroll,
    });

    this.navText = new TextRenderable(renderer, {
      id: "gadget-nav",
      width: callbacks.navWidth(),
      height: "100%",
      fg: COLORS.text,
      bg: COLORS.panel,
      content: "",
      truncate: true,
      selectable: false,
      onMouseDown: (event) => {
        if (event.button !== MouseButton.LEFT) {
          return;
        }
        callbacks.onNavFileMouseDown(event.y - this.navText.screenY);
      },
      onMouseScroll: (event) => {
        callbacks.onNavScroll(event.scroll?.direction, event.modifiers.shift);
      },
    });

    const diffColumn = new BoxRenderable(renderer, {
      id: "gadget-diff-column",
      flexGrow: 1,
      height: "100%",
      flexDirection: "column",
      backgroundColor: COLORS.bg,
    });

    this.diffTopBarText = new TextRenderable(renderer, {
      id: "gadget-diff-top-bar",
      height: DIFF_TOP_BAR_LINES,
      width: "100%",
      fg: COLORS.text,
      bg: COLORS.bg,
      content: "",
      selectable: false,
    });

    this.diffScroll = new ScrollBoxRenderable(renderer, {
      id: "gadget-diff-scroll",
      flexGrow: 1,
      height: "100%",
      scrollY: true,
      scrollX: false,
      backgroundColor: COLORS.bg,
      border: false,
      viewportCulling: true,
      onMouseScroll: (event) => {
        callbacks.onDiffScroll(event.scroll?.direction, event.modifiers.shift);
      },
    });

    this.diffBottomBarText = new TextRenderable(renderer, {
      id: "gadget-diff-bottom-bar",
      height: DIFF_BOTTOM_BAR_LINES,
      width: "100%",
      fg: COLORS.text,
      bg: COLORS.panel,
      content: "",
      selectable: false,
      onMouseDown: (event) => {
        if (event.button === MouseButton.LEFT) {
          callbacks.onDiffBottomBarMouseDown();
        }
      },
    });

    this.diffDockSpacer = new TextRenderable(renderer, {
      id: "gadget-diff-dock-spacer",
      height: 0,
      width: "100%",
      fg: COLORS.text,
      bg: COLORS.bg,
      content: "",
      selectable: false,
    });

    diffColumn.add(this.diffTopBarText);
    diffColumn.add(this.diffScroll);
    diffColumn.add(this.diffBottomBarText);
    diffColumn.add(this.diffDockSpacer);

    this.fileSelectorModal = new FileSelectorModal(renderer, {
      onSelectFile: callbacks.onSelectFile,
      onScroll: callbacks.onFileModalScroll,
    });
    this.fileSearchModal = new FileSearchModal(renderer, {
      onSelectMatch: callbacks.onSelectFileSearchMatch,
      onScroll: callbacks.onFileSearchScroll,
    });
    this.diffBaseModal = new DiffBaseModal(renderer, {
      onSelectCandidate: callbacks.onSelectDiffBaseCandidate,
      onScroll: callbacks.onDiffBaseScroll,
    });
    this.helpModal = new HelpModal(renderer);
    this.sessionModal = new SessionModal(renderer);

    root.add(this.fileTreeSidebar.renderable);
    root.add(this.navText);
    root.add(diffColumn);
    root.add(this.fileSelectorModal.renderable);
    root.add(this.fileSearchModal.renderable);
    root.add(this.diffBaseModal.renderable);
    root.add(this.helpModal.renderable);
    root.add(this.sessionModal.renderable);
    renderer.root.add(root);
  }

  get width(): number {
    return this.renderer.width;
  }

  get height(): number {
    return this.renderer.height;
  }

  createTextRenderable(options: ConstructorParameters<typeof TextRenderable>[1]): TextRenderable {
    return new TextRenderable(this.renderer, options);
  }

  prependInputHandler(handler: (sequence: string) => boolean): void {
    this.renderer.prependInputHandler(handler);
  }

  removeInputHandler(handler: (sequence: string) => boolean): void {
    this.renderer.removeInputHandler(handler);
  }

  onBlur(callback: () => void): void {
    this.renderer.on(CliRenderEvents.BLUR, callback);
  }

  onFocus(callback: () => void): void {
    this.renderer.on(CliRenderEvents.FOCUS, callback);
  }

  onKeypress(callback: (key: KeyEvent) => void): void {
    this.renderer.keyInput.on("keypress", callback);
  }

  requestRender(): void {
    this.renderer.requestRender();
  }

  renderNav(options: {
    navMode: NavMode;
    navHeight: number;
    files: DiffFile[];
    scrollOffset: number;
    visibleFileCount: number;
    selectedFileIndex: number;
  }): void {
    this.navText.width = navWidthFor(options.navMode);
    if (options.navMode === "compact") {
      this.navText.content = "";
      return;
    }

    if (options.files.length === 0) {
      this.navText.content = formatNavBox(["No diff", "", "Waiting for changes..."], navWidthFor(options.navMode), options.navHeight, NAV_HINT_OPEN);
      return;
    }

    const rows = options.files
      .slice(options.scrollOffset, options.scrollOffset + options.visibleFileCount)
      .map((file, index) => {
        const fileIndex = index + options.scrollOffset;
        return { file, selected: fileIndex === options.selectedFileIndex };
      });
    this.navText.content = formatFileCardNav(rows, navWidthFor(options.navMode), options.navHeight, NAV_HINT_OPEN);
  }

  renderFileTreeSidebar(options: {
    open: boolean;
    rows: FileTreeRow[];
    scrollOffset: number;
    loading: boolean;
    currentFilePath: string;
  }): void {
    this.fileTreeSidebar.render({
      ...options,
      width: options.open ? this.callbacks.fileTreeWidth() : 0,
      height: this.height,
    });
  }

  renderStatus(options: {
    cwdName: string;
    worktreeName: string;
    branchName: string;
    width: number;
    hasLeftBorder: boolean;
    borderFg: string;
    annotationModeLabel: string;
    bottomDockOpen: boolean;
    fileLabel: string;
    actionHint: string | null;
  }): void {
    this.diffTopBarText.content = formatDiffTopBar(
      options.cwdName,
      options.worktreeName,
      options.branchName,
      options.width,
      options.hasLeftBorder,
      options.borderFg,
      options.annotationModeLabel,
    );
    if (options.bottomDockOpen) {
      this.diffBottomBarText.content = "";
      return;
    }
    this.diffBottomBarText.content = formatDiffBottomBar(
      options.fileLabel,
      options.width,
      options.hasLeftBorder,
      options.borderFg,
      options.actionHint,
    );
  }

  renderDockSpacer(options: { bottomBarHeight: number; bottomDockHeight: number; width: number }): void {
    this.diffBottomBarText.height = options.bottomBarHeight;
    this.diffDockSpacer.height = options.bottomDockHeight;
    this.diffDockSpacer.width = options.width;
    this.diffDockSpacer.content = "";
  }

  renderFileModal(options: {
    open: boolean;
    files: DiffFile[];
    selectedFileIndex: number;
    scrollOffset: number;
    currentFilePath: string;
  }): void {
    this.fileSelectorModal.render({
      ...options,
      rendererWidth: this.width,
      rendererHeight: this.height,
    });
  }

  renderFileSearchModal(options: {
    open: boolean;
    query: string;
    matches: FuzzyFileMatch[];
    placeholder: string;
    selectedMatchIndex: number;
    scrollOffset: number;
    currentFilePath: string;
  }): void {
    this.fileSearchModal.render({
      ...options,
      rendererWidth: this.width,
      rendererHeight: this.height,
    });
  }

  renderDiffBaseModal(options: {
    open: boolean;
    candidates: DiffBaseCandidate[];
    selectedCandidateIndex: number;
    scrollOffset: number;
    currentBaseLabel: string;
    loading: boolean;
    error: string | null;
  }): void {
    this.diffBaseModal.render({
      ...options,
      rendererWidth: this.width,
      rendererHeight: this.height,
    });
  }

  renderHelpModal(open: boolean): void {
    this.helpModal.render({
      open,
      rendererWidth: this.width,
      rendererHeight: this.height,
    });
  }

  renderSessionModal(open: boolean, info: AgentSessionInfo): void {
    this.sessionModal.render({
      open,
      info,
      rendererWidth: this.width,
      rendererHeight: this.height,
    });
  }

  destroy(): void {
    this.renderer.destroy();
  }
}
