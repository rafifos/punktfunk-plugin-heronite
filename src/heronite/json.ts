// Heronite writes atomically (temp file + rename) and never leaves a half-written document, but
// a reader can still hit a file mid-replace, so every read gets one retry. A malformed or
// schema-rejecting file is absent, never an empty library: a valid `{}` or `[]` is what an empty
// document looks like.

import { readFileSync } from "node:fs";

import { Option, Schema } from "effect";

/** Reads a file's text; injectable so the retry can be tested without racing the filesystem. */
type JsonReader = (file: string) => string;

const readUtf8: JsonReader = (file) => readFileSync(file, "utf8");

/**
 * Reads one JSON file and decodes it with `schema`. A missing, unreadable, empty, `null`,
 * malformed or schema-rejecting file yields `undefined`, so a caller never sees a document it
 * would have to re-check by hand.
 */
export function readJson<A>(
  file: string,
  schema: Schema.Schema<A>,
  reader: JsonReader = readUtf8,
): A | undefined {
  // `decodeUnknownOption` asks for a decoder whose requirements are `never`; a bare `Schema<A>`
  // leaves them `unknown`. These schemas declare no services, so the bridge is sound.
  const decoder = schema as unknown as Schema.ConstraintDecoder<unknown>;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let text: string;
    try {
      text = reader(file);
    } catch {
      continue;
    }

    // An empty file is Heronite's absent document, not a reader that lost a race.
    if (text.trim() === "") return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (parsed === null) return undefined;

    return Option.getOrUndefined(Schema.decodeUnknownOption(decoder)(parsed)) as A | undefined;
  }
  return undefined;
}

export type { JsonReader };
