// Heronite writes atomically (temp file + rename) and never leaves a half-written document, but
// a reader can still hit a file mid-replace, so every read gets one retry. A malformed file is
// absent, never an empty library: a valid `{}` or `[]` is what an empty document looks like.

import { readFileSync } from "node:fs";

/** Reads a file's text; injectable so the retry can be tested without racing the filesystem. */
type JsonReader = (file: string) => string;

const readUtf8: JsonReader = (file) => readFileSync(file, "utf8");

function parse<T>(text: string): { readonly value: T | undefined } | undefined {
  if (text.trim() === "") return { value: undefined };

  try {
    const value: unknown = JSON.parse(text);
    return { value: value === null ? undefined : (value as T) };
  } catch {
    return undefined;
  }
}

/**
 * Reads one JSON file tolerantly. A missing, unreadable, empty, `null` or malformed file yields
 * `undefined`; a parsed document is returned as-is, so `{}` and `[]` stay distinguishable from
 * absence.
 */
export function readJson<T>(file: string, reader: JsonReader = readUtf8): T | undefined {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let text: string;
    try {
      text = reader(file);
    } catch {
      continue;
    }

    const parsed = parse<T>(text);
    if (parsed !== undefined) return parsed.value;
  }
  return undefined;
}

/**
 * The electron-store-named helper for Heronite's tab-indented files. Indentation is just JSON
 * whitespace, so it delegates to {@link readJson}.
 */
export function readStore<T>(file: string, reader: JsonReader = readUtf8): T | undefined {
  return readJson<T>(file, reader);
}

export type { JsonReader };
