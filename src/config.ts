import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type GadgetConfig = {
  diff: {
    rendering: DiffRenderingConfig;
  };
  integrations: {
    cmux: boolean;
  };
};

export type DiffRenderingConfig = "unified" | "auto";

const DEFAULT_CONFIG: GadgetConfig = {
  diff: {
    rendering: "auto",
  },
  integrations: {
    cmux: false,
  },
};

export async function readGadgetConfig(): Promise<GadgetConfig> {
  try {
    return parseGadgetConfig(await readFile(gadgetConfigPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

export function gadgetConfigPath(): string {
  return join(process.env.GADGET_CONFIG_DIR ?? join(homedir(), ".gadget"), "config.toml");
}

function parseGadgetConfig(value: string): GadgetConfig {
  const config: GadgetConfig = {
    diff: {
      rendering: DEFAULT_CONFIG.diff.rendering,
    },
    integrations: {
      cmux: DEFAULT_CONFIG.integrations.cmux,
    },
  };
  let section = "";

  for (const rawLine of value.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      continue;
    }

    if (section === "diff") {
      const renderingMatch = /^rendering\s*=\s*"(unified|auto)"\s*$/.exec(line);
      if (renderingMatch) {
        config.diff.rendering = renderingMatch[1] as DiffRenderingConfig;
      }
      continue;
    }

    if (section === "integrations") {
      const match = /^cmux\s*=\s*(true|false)\s*$/.exec(line);
      if (match) {
        config.integrations.cmux = match[1] === "true";
      }
    }
  }

  return config;
}

function stripTomlComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index - 1] !== "\\") {
      quoted = !quoted;
      continue;
    }
    if (char === "#" && !quoted) {
      return line.slice(0, index);
    }
  }
  return line;
}
