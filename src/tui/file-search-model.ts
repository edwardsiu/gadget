import { basename } from "node:path";
import type { FuzzyFileMatch } from "./file-search-modal";

export type SearchableFileEntry = {
  filePath: string;
  normalizedPath: string;
  normalizedBasename: string;
  chars: FuzzyPathChar[];
};

type FuzzyPathChar = {
  char: string;
  index: number;
  normalizedIndex: number;
  basename: boolean;
  boundary: boolean;
};

export function buildSearchableFileEntries(filePaths: string[]): SearchableFileEntry[] {
  return filePaths.map((filePath) => {
    const chars = fuzzyPathChars(filePath);
    return {
      filePath,
      normalizedPath: chars.map((pathChar) => pathChar.char).join(""),
      normalizedBasename: normalizeFuzzyText(basename(filePath)),
      chars,
    };
  });
}

export function matchFilePaths(entries: SearchableFileEntry[], query: string, limit: number): FuzzyFileMatch[] {
  const normalizedQuery = normalizeFuzzyText(query);
  if (normalizedQuery.length === 0) {
    return entries.slice(0, limit).map((entry) => ({ filePath: entry.filePath, score: 0 }));
  }

  const matches: FuzzyFileMatch[] = [];
  for (const entry of entries) {
    const score = fuzzyFileScore(entry, normalizedQuery);
    if (score === null) {
      continue;
    }
    pushTopFuzzyMatch(matches, { filePath: entry.filePath, score }, limit);
  }
  return matches.sort(compareFuzzyMatches);
}

function fuzzyFileScore(entry: SearchableFileEntry, normalizedQuery: string): number | null {
  if (entry.chars.length === 0) {
    return null;
  }

  let previousPathChar: FuzzyPathChar | null = null;
  let firstMatch: FuzzyPathChar | null = null;
  let lastMatch: FuzzyPathChar | null = null;
  let searchStart = 0;
  let score = 0;

  for (const char of normalizedQuery) {
    const pathCharIndex = findFuzzyPathCharIndex(entry.chars, char, searchStart);
    if (pathCharIndex < 0) {
      return null;
    }

    const pathChar = entry.chars[pathCharIndex]!;
    firstMatch ??= pathChar;
    lastMatch = pathChar;
    score += 20;
    if (previousPathChar && pathChar.normalizedIndex === previousPathChar.normalizedIndex + 1) {
      score += 12;
    }
    if (previousPathChar && pathChar.index === previousPathChar.index + 1) {
      score += 4;
    }
    if (pathChar.boundary) {
      score += 14;
    }
    if (pathChar.basename) {
      score += 6;
    }
    if (previousPathChar) {
      score -= Math.max(0, pathChar.normalizedIndex - previousPathChar.normalizedIndex - 1);
      score -= Math.max(0, pathChar.index - previousPathChar.index - 1) * 0.03;
    }
    previousPathChar = pathChar;
    searchStart = pathCharIndex + 1;
  }

  if (entry.normalizedPath.includes(normalizedQuery)) {
    score += 30;
  }
  if (entry.normalizedBasename.includes(normalizedQuery)) {
    score += 20;
  }
  if (entry.normalizedBasename.startsWith(normalizedQuery)) {
    score += 35;
  }
  if (firstMatch?.boundary) {
    score += 12;
  }
  if (firstMatch?.basename) {
    score += 10;
  }
  if (firstMatch && lastMatch) {
    score -= Math.max(0, lastMatch.index - firstMatch.index - normalizedQuery.length) * 0.02;
  }

  return score;
}

function findFuzzyPathCharIndex(chars: FuzzyPathChar[], char: string, start: number): number {
  for (let index = start; index < chars.length; index += 1) {
    if (chars[index]?.char === char) {
      return index;
    }
  }
  return -1;
}

function pushTopFuzzyMatch(matches: FuzzyFileMatch[], candidate: FuzzyFileMatch, limit: number): void {
  if (matches.length < limit) {
    matches.push(candidate);
    return;
  }

  let worstIndex = 0;
  for (let index = 1; index < matches.length; index += 1) {
    if (compareFuzzyMatches(matches[index]!, matches[worstIndex]!) > 0) {
      worstIndex = index;
    }
  }
  if (compareFuzzyMatches(candidate, matches[worstIndex]!) < 0) {
    matches[worstIndex] = candidate;
  }
}

function compareFuzzyMatches(a: FuzzyFileMatch, b: FuzzyFileMatch): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.filePath.length !== b.filePath.length) {
    return a.filePath.length - b.filePath.length;
  }
  return a.filePath.localeCompare(b.filePath);
}

function fuzzyPathChars(filePath: string): FuzzyPathChar[] {
  const basenameStart = filePath.length - basename(filePath).length;
  const chars: FuzzyPathChar[] = [];
  for (let index = 0; index < filePath.length; index += 1) {
    const rawChar = filePath[index]!;
    if (!isFuzzySearchChar(rawChar)) {
      continue;
    }
    chars.push({
      char: rawChar.toLowerCase(),
      index,
      normalizedIndex: chars.length,
      basename: index >= basenameStart,
      boundary: index === 0 || !isFuzzySearchChar(filePath[index - 1] ?? ""),
    });
  }
  return chars;
}

function normalizeFuzzyText(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (isFuzzySearchChar(char)) {
      normalized += char.toLowerCase();
    }
  }
  return normalized;
}

function isFuzzySearchChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}
