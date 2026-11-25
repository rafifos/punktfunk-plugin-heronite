// Tolerant reads: a missing, empty, `null` or malformed file is absent, while a valid `{}` or
// `[]` is data the caller can act on. Reads are retried once because Heronite replaces files by
// rename while it runs.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Schema } from "effect";
import { afterEach, describe, expect, test } from "bun:test";

import { readJson } from "../../src/heronite/json.js";

/** Whatever a document holds, so the tolerance cases do not depend on a field schema. */
const Loose = Schema.Record(Schema.String, Schema.Unknown);
const LooseObject = Schema.Struct({ games: Schema.optionalKey(Schema.Array(Schema.Unknown)) });

const tempDirs: string[] = [];

function tempFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "heronite-json-"));
  tempDirs.push(dir);
  const file = join(dir, "data.json");
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readJson", () => {
  test("a missing file is absent", () => {
    expect(readJson(tempFile(), Loose)).toBeUndefined();
  });

  test("an empty or whitespace-only file is absent", () => {
    expect(readJson(tempFile(""), Loose)).toBeUndefined();
    expect(readJson(tempFile("\n\t \t\r\n"), Loose)).toBeUndefined();
  });

  test("a JSON null is absent", () => {
    expect(readJson(tempFile("null"), Loose)).toBeUndefined();
    expect(readJson(tempFile("  null  "), Loose)).toBeUndefined();
  });

  test("a malformed file is absent, not an empty value", () => {
    const file = tempFile('{ "games": [ }');
    expect(readJson(file, Loose)).toBeUndefined();
  });

  test("a valid empty object or array is returned", () => {
    expect(readJson(tempFile("{}"), Loose)).toEqual({});
    expect(readJson(tempFile("[]"), Schema.Array(Schema.Unknown))).toEqual([]);
  });

  test("valid content is returned", () => {
    const file = tempFile('{"games":[{"app_name":"Example"}]}');
    expect(readJson(file, LooseObject)).toEqual({
      games: [{ app_name: "Example" }],
    });
  });

  test("a malformed read is retried once", () => {
    let calls = 0;
    const value = readJson("ignored.json", LooseObject, () => {
      calls += 1;
      return calls === 1 ? '{"games":[' : '{"games":[]}';
    });
    expect(value).toEqual({ games: [] });
    expect(calls).toBe(2);
  });

  test("a failed read is retried once", () => {
    let calls = 0;
    const ok = Schema.Struct({ ok: Schema.optionalKey(Schema.Boolean) });
    const value = readJson("ignored.json", ok, () => {
      calls += 1;
      if (calls === 1) throw new Error("busy");
      return '{"ok":true}';
    });
    expect(value).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test("two malformed attempts give up after the retry", () => {
    let calls = 0;
    const value = readJson("ignored.json", Loose, () => {
      calls += 1;
      return "{ not json";
    });
    expect(value).toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe("schema rejection", () => {
  const Games = Schema.Struct({
    games: Schema.optionalKey(
      Schema.Array(Schema.Struct({ app_name: Schema.optionalKey(Schema.String) })),
    ),
  });

  test("a document whose shape changed is absent, not partially decoded", () => {
    // What a Heronite change looks like from here: `games` is no longer an array.
    expect(readJson(tempFile('{"games":{"app_name":"x"}}'), Games)).toBeUndefined();
  });

  test("a renamed field inside a record is refused rather than silently dropped", () => {
    const renamed = tempFile('{"games":[{"appName":"Example"}]}');
    expect(
      readJson(
        renamed,
        Schema.Struct({ games: Schema.Array(Schema.Struct({ app_name: Schema.String })) }),
      ),
    ).toBeUndefined();
  });

  test("an absent optional wrapper still decodes", () => {
    expect(readJson(tempFile("{}"), Games)).toEqual({});
    expect(readJson(tempFile('{"games":[]}'), Games)).toEqual({ games: [] });
  });

  test("unknown extra keys are ignored, not fatal", () => {
    const file = tempFile('{"games":[{"app_name":"Example"}],"extra":42}');
    expect(readJson(file, Games)).toEqual({ games: [{ app_name: "Example" }] });
  });

  test("electron-store tab indentation decodes the same way", () => {
    const file = tempFile('{\n\t"games": [\n\t\t{ "app_name": "steam_440" }\n\t]\n}');
    expect(readJson(file, Games)).toEqual({ games: [{ app_name: "steam_440" }] });
  });
});
