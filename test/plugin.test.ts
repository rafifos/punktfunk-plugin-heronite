// The plugin's settings: decoding defaults, the console's derived JSON Schema, the watch/scan
// wiring a saved change drives, and the read-only per-game tab.

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveConfigJsonSchema, makeConfigService, pluginInfoLayer } from "@punktfunk/plugin-kit";
import { fromProviderEntry } from "@punktfunk/plugin-kit/library";
import { Effect, Queue, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { watchDirs } from "../src/heronite/paths.js";
import runnerEntry from "../src/index.js";
import { compareParitySnapshot } from "../src/kit/library-with-ui.js";
import { HeroniteConfig, type HeroniteSettings, pluginDef } from "../src/plugin.js";

const fixture = join(import.meta.dir, "fixtures", "heronite-data");

const decode = (raw: unknown) => Effect.runPromise(Schema.decodeUnknownEffect(HeroniteConfig)(raw));

/** The fixture's settings, with the protocol transport pinned by a program folder no test box has. */
const settings = (overrides: Partial<HeroniteSettings> = {}): HeroniteSettings => ({
  dataDir: fixture,
  programDir: join(tmpdir(), "heronite-no-such-program"),
  showLauncherTile: true,
  showConsoleTile: true,
  ...overrides,
});

let temp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "heronite-plugin-"));
  previousConfigDir = process.env.PUNKTFUNK_CONFIG_DIR;
  process.env.PUNKTFUNK_CONFIG_DIR = join(temp, "config");
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.PUNKTFUNK_CONFIG_DIR;
  else process.env.PUNKTFUNK_CONFIG_DIR = previousConfigDir;
  rmSync(temp, { recursive: true, force: true });
});

describe("config schema", () => {
  test("an empty config decodes with both tiles on and no folders", async () => {
    const cfg = await decode({});

    expect(cfg.showLauncherTile).toBe(true);
    expect(cfg.showConsoleTile).toBe(true);
    expect(cfg.dataDir).toBeUndefined();
    expect(cfg.programDir).toBeUndefined();
  });

  test("the console form exposes two handed paths and two defaulted booleans", () => {
    const derived = deriveConfigJsonSchema(HeroniteConfig) as {
      readonly schema: {
        readonly properties: Record<
          string,
          { readonly type?: string; readonly format?: string; readonly default?: unknown }
        >;
        readonly required?: readonly string[];
      };
    };
    const form = derived.schema;

    expect(form.properties.dataDir?.format).toBe("pf:path");
    expect(form.properties.programDir?.format).toBe("pf:path");
    expect(form.properties.showLauncherTile?.type).toBe("boolean");
    expect(form.properties.showLauncherTile?.default).toBe(true);
    expect(form.properties.showConsoleTile?.type).toBe("boolean");
    expect(form.properties.showConsoleTile?.default).toBe(true);
    // Defaults stay out of the raw file, so they must stay out of `required`.
    expect(form.required ?? []).not.toContain("showLauncherTile");
    expect(form.required ?? []).not.toContain("showConsoleTile");
  });
});

describe("settings wiring", () => {
  test("the fixture root watches Heronite's folders and scans its six games", async () => {
    const cfg = settings();
    const entries = await Effect.runPromise(pluginDef.scan(cfg));

    expect(entries.map((entry) => entry.external_id)).toEqual([
      "gog:1207658999",
      "legendary:ExampleSteamCopyEpic",
      "nile:amzn1.adg.product.Example",
      "sideload:ExampleSideload",
      "sideload:emu_9f2c1a77b3d84e10",
      "sideload:steam_440",
    ]);
    expect(pluginDef.watchDirs(cfg)).toEqual(watchDirs(fixture));
  });

  test("a saved data folder reaches `changes`, so the engine's reconfigure sees the new root", async () => {
    const service = await Effect.runPromise(
      makeConfigService({ schema: HeroniteConfig }).pipe(
        Effect.provide(pluginInfoLayer({ name: "heronite" })),
      ),
    );

    const changed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* service.changes.pipe(Stream.toQueue({ capacity: "unbounded" }));
          yield* Effect.yieldNow;
          yield* service.saveRaw({ dataDir: fixture });
          return yield* Queue.take(queue);
        }),
      ),
    );

    expect(changed.dataDir).toBe(fixture);
    // The sync engine's settings map watchDirs(cfg); a scan after the change sees the same root.
    expect(pluginDef.watchDirs(changed)).toEqual(watchDirs(fixture));
    expect(await Effect.runPromise(pluginDef.scan(changed))).toHaveLength(6);
  });

  test("the tile switches are honoured", () => {
    expect(pluginDef.launchers(settings())).toHaveLength(2);
    expect(pluginDef.launchers(settings({ showConsoleTile: false }))).toHaveLength(1);
    expect(pluginDef.launchers(settings({ showLauncherTile: false }))).toHaveLength(1);
    expect(
      pluginDef.launchers(settings({ showLauncherTile: false, showConsoleTile: false })),
    ).toHaveLength(0);
  });
});

describe("parity compare", () => {
  test("an unchanged baseline is OK, and a changed entry id fails the gate", async () => {
    const cfg = settings();
    const entries = [
      ...(await Effect.runPromise(pluginDef.scan(cfg))),
      ...pluginDef.launchers(cfg),
    ];
    const baseline = entries.map((entry) => fromProviderEntry("heronite", entry));
    const file = join(temp, "baseline.json");

    writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
    const unchanged = await Effect.runPromise(compareParitySnapshot(file, "heronite", entries));
    expect(unchanged.ok).toBe(true);

    const moved = baseline.map((entry) =>
      entry.id === "heronite:sideload:ExampleSideload"
        ? { ...entry, id: "heronite:sideload:DifferentGame" }
        : entry,
    );
    writeFileSync(file, `${JSON.stringify(moved, null, 2)}\n`);
    const report = await Effect.runPromise(compareParitySnapshot(file, "heronite", entries));

    expect(report.ok).toBe(false);
    expect(report.missing.map((entry) => entry.id)).toContain("heronite:sideload:DifferentGame");
    expect(report.extra.map((entry) => entry.id)).toContain("heronite:sideload:ExampleSideload");
  });
});

describe("per-game tab", () => {
  /** A config service already pointed at the fixture, the way the console's saved settings do. */
  const configured = async () => {
    const service = await Effect.runPromise(
      makeConfigService({ schema: HeroniteConfig }).pipe(
        Effect.provide(pluginInfoLayer({ name: "heronite" })),
      ),
    );
    await Effect.runPromise(service.saveRaw({ dataDir: fixture }));
    const game = pluginDef.game(service);
    return game;
  };

  /** Every fixture file's path, size, mtime and content digest, sorted for a stable comparison. */
  const snapshotTree = (dir: string): string => {
    const rows: string[] = [];
    const walk = (current: string): void => {
      for (const name of readdirSync(current).sort()) {
        const file = join(current, name);
        const stat = statSync(file);
        if (stat.isDirectory()) {
          walk(file);
          continue;
        }
        const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
        rows.push(`${file}:${stat.size}:${stat.mtimeMs}:${digest}`);
      }
    };
    walk(dir);
    return rows.join("\n");
  };

  test("load gives no tab for ids that are not this plugin's or not Heronite's games", async () => {
    const game = await configured();

    expect(await Effect.runPromise(game.load("steam:440"))).toBeUndefined();
    expect(await Effect.runPromise(game.load("hydra:ExampleSideload"))).toBeUndefined();
    expect(await Effect.runPromise(game.load("heronite:sideload:does-not-exist"))).toBeUndefined();
  });

  test("load answers the fixture's stats for a heronite entry", async () => {
    const game = await configured();

    const value = await Effect.runPromise(game.load("heronite:sideload:ExampleSideload"));

    expect(value).toMatchObject({
      entryId: "heronite:sideload:ExampleSideload",
      runner: "sideload",
      appName: "ExampleSideload",
      title: "Example Sideload Game",
      source: "Manual",
      install: "installed",
    });
  });

  test("status lines describe a loaded game and stay empty for other ids", async () => {
    const game = await configured();

    const lines = await Effect.runPromise(
      game.status?.("heronite:legendary:ExampleEpicApp") ?? Effect.succeed([]),
    );
    expect(lines.map((line) => line.text)).toContain("Playtime: 2 h 32 m");
    expect(lines.map((line) => line.text)).toContain("Status: Playing");

    expect(await Effect.runPromise(game.status?.("steam:440") ?? Effect.succeed([]))).toEqual([]);
  });

  test("save resolves without touching a single Heronite file", async () => {
    const game = await configured();
    const before = snapshotTree(fixture);

    await Effect.runPromise(game.save("heronite:sideload:ExampleSideload", {}));
    // Loading must be read-only too: the console calls both when a tab opens.
    await Effect.runPromise(game.load("heronite:sideload:ExampleSideload"));

    expect(snapshotTree(fixture)).toBe(before);
  });
});

describe("runner entry", () => {
  test("the default export is the plugin definition", () => {
    expect(runnerEntry.name).toBe("heronite");
    expect(typeof runnerEntry.main).toBe("function");
  });
});
