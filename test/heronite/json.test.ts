// Tolerant reads: a missing, empty, `null` or malformed file is absent, while a valid `{}` or
// `[]` is data the caller can act on. Reads are retried once because Heronite replaces files by
// rename while it runs.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { readJson, readStore } from "../../src/heronite/json.js";

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
    expect(readJson(tempFile())).toBeUndefined();
  });

  test("an empty or whitespace-only file is absent", () => {
    expect(readJson(tempFile(""))).toBeUndefined();
    expect(readJson(tempFile("\n\t \t\r\n"))).toBeUndefined();
  });

  test("a JSON null is absent", () => {
    expect(readJson(tempFile("null"))).toBeUndefined();
    expect(readJson(tempFile("  null  "))).toBeUndefined();
  });

  test("a malformed file is absent, not an empty value", () => {
    const file = tempFile('{ "games": [ }');
    expect(readJson(file)).toBeUndefined();
  });

  test("a valid empty object or array is returned", () => {
    expect(readJson<Record<string, never>>(tempFile("{}"))).toEqual({});
    expect(readJson<unknown[]>(tempFile("[]"))).toEqual([]);
  });

  test("valid content is returned", () => {
    const file = tempFile('{"games":[{"app_name":"Example"}]}');
    expect(readJson<{ games: { app_name: string }[] }>(file)).toEqual({
      games: [{ app_name: "Example" }],
    });
  });

  test("a malformed read is retried once", () => {
    let calls = 0;
    const value = readJson<{ games: unknown[] }>("ignored.json", () => {
      calls += 1;
      return calls === 1 ? '{"games":[' : '{"games":[]}';
    });
    expect(value).toEqual({ games: [] });
    expect(calls).toBe(2);
  });

  test("a failed read is retried once", () => {
    let calls = 0;
    const value = readJson<{ ok: boolean }>("ignored.json", () => {
      calls += 1;
      if (calls === 1) throw new Error("busy");
      return '{"ok":true}';
    });
    expect(value).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test("two malformed attempts give up after the retry", () => {
    let calls = 0;
    const value = readJson("ignored.json", () => {
      calls += 1;
      return "{ not json";
    });
    expect(value).toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe("readStore", () => {
  test("reads electron-store tab-indented files", () => {
    const file = tempFile('{\n\t"games": {\n\t\t"appName": "steam_440"\n\t}\n}');
    expect(readStore<{ games: { appName: string } }>(file)).toEqual({
      games: { appName: "steam_440" },
    });
  });

  test("keeps the same tolerant behaviour", () => {
    expect(readStore(tempFile())).toBeUndefined();
    expect(readStore(tempFile("null"))).toBeUndefined();
    expect(readStore<Record<string, never>>(tempFile("{}"))).toEqual({});
  });
});
