export type TextStyle = { fg: string; bg: string };

export const COLORS = {
  bg: "#101214",
  panel: "#15191d",
  border: "#3a4148",
  selected: "#283848",
  text: "#d9dee5",
  muted: "#89919b",
  commentBg: "#2b3036",
  statAdd: "#66d187",
  statRemove: "#ff7b8a",
  statMixed: "#d8b84c",
  statSelected: "#d9822b",
  statInfo: "#38d5e8",
  fileName: "#ffd75f",
  diffHeaderBg: "#1f3040",
  addBg: "#173c2a",
  addFg: "#dbf6e5",
  modifiedBg: "#3d3317",
  removeBg: "#4a1d24",
  removeFg: "#ffe0e4",
  hunkBg: "#24314f",
  hunkFg: "#d9e5ff",
};

export const MIN_COMMENT_BODY_LINES = 3;
export const DIFF_TOP_BAR_LINES = 1;
export const DIFF_BOTTOM_BAR_LINES = 1;
export const INPUT_LINES = 0;
export const NAV_CARD_HEIGHT = 2;
export const FILE_TREE_SIDEBAR_WIDTH = 36;
export const DIFF_LINE_NUMBER_WIDTH = 4;
export const NAV_HINT_OPEN = "Close [F]";
export const DIFF_BORDER_FG = "#ffffff";
export const REVIEW_BORDER_FG = "#00ff87";
export const FILE_MODAL_MARGIN_X = 4;
export const FILE_MODAL_MARGIN_Y = 3;
export const FILE_SEARCH_MAX_MATCHES = 100;
export const SYNTAX_HIGHLIGHT_OVERSCAN_ROWS = 3;
export const HELP_MODAL_WIDTH = 56;
export const HELP_MODAL_ROWS = [
  "J            Down",
  "K            Up",
  "G            First line",
  "Shift+G      Last line",
  "Shift+J      Page down",
  "Shift+K      Page up",
  "H            Previous file",
  "L            Next file",
  "P            Open file selector",
  "F            Toggle file tree",
  "Shift+P      Search project files",
  "B            Choose diff base",
  "O            Toggle full file",
  "Enter        Comment",
  "R            Start review",
  "Shift+R      Reply agent turn",
  "S            Session info",
  "?            Keybindings",
  "Shift+Q      Quit",
] as const;

export const COMMENT_BORDER = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
} as const;

export const NAV_BORDER = COMMENT_BORDER;
