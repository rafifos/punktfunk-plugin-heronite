// The reader against a database classic-level wrote (test/fixtures/make-db.mjs).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, test } from "bun:test";

import { readLevelDb, unsnappy } from "../src/leveldb.js";

const FIXTURE = path.join(import.meta.dir, "fixtures", "hydra-db");

const games = (dir: string) =>
  new Map([...readLevelDb(dir, ["!games!"])].map(([k, row]) => [k, JSON.parse(row.value)]));

describe("LevelDB reader", () => {
  test("merges the table and the live log, newest write first", () => {
    const read = games(FIXTURE);
    expect([...read.keys()].sort()).toEqual([
      "!games!custom:6f1c3d52-8a1e-4f7b-9d2e-1a2b3c4d5e6f",
      "!games!launchbox:okami-ps2",
      "!games!steam:105600",
      "!games!steam:1086940",
      "!games!steam:1091500",
      "!games!steam:1145360",
      "!games!steam:1245620",
      "!games!steam:292030",
      "!games!steam:367520",
      "!games!steam:620",
    ]);
    // Rewritten in the log after the table held the old path; Stardew's delete wins too.
    expect(read.get("!games!steam:620").executablePath).toBe(
      "/home/deck/Games/Portal 2/portal2.sh",
    );
  });

  test("reads only the asked prefixes, including a record split across log blocks", () => {
    const all = readLevelDb(FIXTURE, ["!gameShopCache!", "userPreferences"]);
    expect(all.size).toBe(42);
    expect(all.get("!gameShopCache!steam:9999:en")?.value.length).toBe(40_012);
    expect(JSON.parse(all.get("userPreferences")?.value ?? "{}")).toEqual({
      downloadsPath: "/home/deck/Games/Hydra",
    });
  });

  test("a log torn mid-write keeps everything before the tear", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-db-"));
    for (const name of fs.readdirSync(FIXTURE)) {
      fs.copyFileSync(path.join(FIXTURE, name), path.join(dir, name));
    }
    const log = fs.readdirSync(dir).find((n) => n.endsWith(".log")) as string;
    const bytes = fs.readFileSync(path.join(dir, log));
    fs.writeFileSync(path.join(dir, log), bytes.subarray(0, bytes.length - 20));
    // The last write is Baldur's Gate 3's download; its game record came just before.
    const read = readLevelDb(dir, ["!games!", "!downloads!"]);
    expect(read.has("!games!steam:1086940")).toBe(true);
    expect(read.has("!downloads!steam:1086940")).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("snappy", () => {
  test("expands a literal and an overlapping copy", () => {
    const packed = Buffer.from([0x09, 0x08, 0x61, 0x62, 0x63, 0x09, 0x03]);
    expect(unsnappy(packed).toString()).toBe("abcabcabc");
  });

  test("refuses a copy reaching before the start", () => {
    expect(() => unsnappy(Buffer.from([0x04, 0x09, 0x03]))).toThrow();
  });
});
