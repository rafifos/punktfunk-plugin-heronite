// The plugin's settings: decoding defaults, the console's derived JSON Schema, and the watch/scan
// wiring a saved change drives.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("runner entry", () => {
  test("the default export is the plugin definition", () => {
    expect(runnerEntry.name).toBe("heronite");
    expect(typeof runnerEntry.main).toBe("function");
  });
});
