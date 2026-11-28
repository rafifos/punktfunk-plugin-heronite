// The plugin's settings: decoding defaults, the console's derived JSON Schema, the watch/scan
// wiring a saved change drives, the download queue's install asks and the read-only per-game tab.

import type { DownloadReporter, DownloadRow } from "@punktfunk/plugin-kit";

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  deriveConfigJsonSchema,
  InstallRefused,
  makeConfigService,
  pluginInfoLayer,
} from "@punktfunk/plugin-kit";
import { fromProviderEntry } from "@punktfunk/plugin-kit/library";
import { Effect, Fiber, Queue, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { watchDirs } from "../src/heronite/paths.js";
import runnerEntry from "../src/index.js";
import { compareParitySnapshot } from "../src/kit/library-with-ui.js";
import { HeroniteConfig, type HeroniteSettings, pluginDef, startRefusal } from "../src/plugin.js";

const fixture = join(import.meta.dir, "fixtures", "heronite-data");
const pausedFixture = join(import.meta.dir, "fixtures", "heronite-data-paused");

const decode = (raw: unknown) => Effect.runPromise(Schema.decodeUnknownEffect(HeroniteConfig)(raw));

/** A folder that exists and holds Heronite's binary, as an installed program folder would. */
let programDir: string;

/** The fixture's settings, with a configured program folder so launches use the headless form. */
const settings = (overrides: Partial<HeroniteSettings> = {}): HeroniteSettings => ({
  dataDir: fixture,
  programDir,
  useProtocolUrl: false,
  showLauncherTile: true,
  showConsoleTile: true,
  stopDesktopClients: true,
  captureDiagnostics: true,
  ...overrides,
});

let temp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "heronite-plugin-"));
  programDir = join(temp, "program");
  mkdirSync(programDir, { recursive: true });
  writeFileSync(join(programDir, "heronite-rs"), "");
  previousConfigDir = process.env.PUNKTFUNK_CONFIG_DIR;
  process.env.PUNKTFUNK_CONFIG_DIR = join(temp, "config");
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.PUNKTFUNK_CONFIG_DIR;
  else process.env.PUNKTFUNK_CONFIG_DIR = previousConfigDir;
  rmSync(temp, { recursive: true, force: true });
});

describe("config schema", () => {
  test("an empty config decodes with both tiles on, protocol URLs off and no folders", async () => {
    const cfg = await decode({});

    expect(cfg.showLauncherTile).toBe(true);
    expect(cfg.showConsoleTile).toBe(true);
    expect(cfg.useProtocolUrl).toBe(false);
    expect(cfg.dataDir).toBeUndefined();
    expect(cfg.programDir).toBeUndefined();
  });

  test("the console form exposes two handed paths and three defaulted booleans", () => {
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
    expect(form.properties.useProtocolUrl?.type).toBe("boolean");
    expect(form.properties.useProtocolUrl?.default).toBe(false);
    // Defaults stay out of the raw file, so they must stay out of `required`.
    expect(form.required ?? []).not.toContain("showLauncherTile");
    expect(form.required ?? []).not.toContain("showConsoleTile");
    expect(form.required ?? []).not.toContain("useProtocolUrl");
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

  test("the protocol-URL switch reaches every game and drops the console tile", async () => {
    const cfg = settings({ useProtocolUrl: true });
    const entries = await Effect.runPromise(pluginDef.scan(cfg));

    expect(entries[0]?.launch).toEqual({
      kind: "exec",
      value: "open",
      args: [{ name: "url", value: "heronite://launch?appName=1207658999&runner=gog" }],
    });

    const tiles = pluginDef.launchers(cfg);
    expect(tiles.map((tile) => tile.external_id)).toEqual(["launcher"]);
    expect(tiles[0]?.launch).toEqual({
      kind: "exec",
      value: "open",
      args: [{ name: "url", value: "heronite://" }],
    });
  });

  test("the fixture tree's tiles follow the transport", () => {
    // A configured program folder holding heronite-rs: the window and the console tile.
    expect(pluginDef.launchers(settings()).map((tile) => tile.external_id)).toEqual([
      "launcher",
      "console",
    ]);

    // A folder with no program in it is a misconfiguration: fall through to the fallback, which
    // has no console tile. Publishing heronite-rs from a folder that does not hold it would give
    // the host a command that cannot run.
    const emptyFolder = join(temp, "no-program-here");
    mkdirSync(emptyFolder, { recursive: true });
    expect(
      pluginDef.launchers(settings({ programDir: emptyFolder })).map((tile) => tile.external_id),
    ).toEqual(["launcher"]);

    // No program folder and no heronite-rs on PATH: the protocol fallback has no console tile.
    const path = process.env.PATH;
    process.env.PATH = join(temp, "empty-path");
    try {
      expect(
        pluginDef.launchers(settings({ programDir: undefined })).map((tile) => tile.external_id),
      ).toEqual(["launcher"]);
    } finally {
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
    }
  });

  test("an AppImage in the program folder is a program the tiles can run", () => {
    const appimageDir = join(temp, "applications");
    mkdirSync(appimageDir, { recursive: true });
    writeFileSync(join(appimageDir, "Heronite-x86_64.appimage"), "");
    const appimage = join(appimageDir, "Heronite-x86_64.appimage");

    const tiles = pluginDef.launchers(settings({ programDir: appimageDir }));

    expect(tiles.map((tile) => tile.launch?.value)).toEqual(["window-program", "console-program"]);
    expect(tiles[0]?.launch?.args).toEqual([{ name: "program", value: appimage }]);
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

  test("a baseline that cannot be read fails with the file it concerned", async () => {
    const missing = join(temp, "no-such-baseline.json");
    const error = await Effect.runPromise(
      Effect.flip(compareParitySnapshot(missing, "heronite", [])),
    );

    expect(error._tag).toBe("ParitySnapshotError");
    expect(error.operation).toBe("read");
    expect(error.path).toBe(missing);
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
    expect(await Effect.runPromise(game.load("other:1"))).toBeUndefined();
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

/** A data root holding only the files a case needs; the folder itself must exist to be found. */
function dataRoot(files: Readonly<Record<string, string | object>>): string {
  const dir = join(temp, "data-root");
  mkdirSync(dir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const file = join(dir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

const downloadLoop = pluginDef.downloads;
const install = pluginDef.install;
if (downloadLoop === undefined || install === undefined) {
  throw new Error("the plugin must publish the downloads loop and its install asks");
}

function fakeReporter(): { readonly reporter: DownloadReporter; readonly rows: DownloadRow[] } {
  const rows: DownloadRow[] = [];
  return {
    rows,
    reporter: {
      set: (row) => rows.push(row),
      supported: () => undefined,
      flush: () => Promise.resolve(),
      close: () => {},
    },
  };
}

/** The first loop tick runs immediately, so that fiber is interrupted while it sleeps. */
async function firstTick(cfg: HeroniteSettings): Promise<readonly DownloadRow[]> {
  const { reporter, rows } = fakeReporter();
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* downloadLoop(reporter, Effect.succeed(cfg)).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Fiber.interrupt(fiber);
    }),
  );
  return rows;
}

/** `accepted`, or the sentence the host would show. */
function answer(effect: Effect.Effect<void, unknown>): Promise<string> {
  return Effect.runPromise(
    effect.pipe(
      Effect.as("accepted"),
      Effect.catch((error) =>
        Effect.succeed(error instanceof InstallRefused ? error.message : String(error)),
      ),
    ),
  );
}

/** The refusal itself, so a test can see it is an `InstallRefused` and read its sentence. */
async function refusalOf(effect: Effect.Effect<void, unknown>): Promise<InstallRefused> {
  const error = await Effect.runPromise(Effect.flip(effect));
  if (!(error instanceof InstallRefused)) {
    throw new Error(`expected InstallRefused, got ${String(error)}`);
  }
  return error;
}

const ask = (externalId: string) => ({ app: `heronite:${externalId}`, externalId });

describe("downloads loop", () => {
  test("sends the live queue rows once and skips the finished history already on disk", async () => {
    const rows = await firstTick(settings());

    expect(rows.map((row) => [row.externalId, row.state])).toEqual([
      ["nile:amzn1.adg.product.Example", "downloading"],
      ["legendary:ExampleEpicAppDlc", "queued"],
    ]);
  });

  test("a user-paused queue is reported paused", async () => {
    const rows = await firstTick(settings({ dataDir: pausedFixture }));

    expect(rows).toEqual([
      {
        externalId: "nile:amzn1.adg.product.Example",
        state: "paused",
        doneBytes: 0,
        totalBytes: 13_421_772_800,
        phase: "Paused in Heronite",
      },
    ]);
  });

  test("a malformed file skips the tick without sending anything", async () => {
    const dir = dataRoot({ "store/download-manager.json": "{not json" });

    expect(await firstTick(settings({ dataDir: dir }))).toEqual([]);
  });
});

describe("install asks", () => {
  test("start accepts a title Heronite is downloading or has queued", async () => {
    expect(await answer(install.start(ask("nile:amzn1.adg.product.Example"), settings()))).toBe(
      "accepted",
    );
    expect(await answer(install.start(ask("legendary:ExampleEpicAppDlc"), settings()))).toBe(
      "accepted",
    );
  });

  test("start accepts a title the host already reports as installing", () => {
    expect(startRefusal({ externalId: "nile:Example", state: "installing", doneBytes: 0 })).toBe(
      undefined,
    );
  });

  test("start refuses a paused download and says Heronite holds it", async () => {
    const refusal = await refusalOf(
      install.start(ask("nile:amzn1.adg.product.Example"), settings({ dataDir: pausedFixture })),
    );

    expect(refusal.message).toContain("Heronite");
    expect(refusal.message).toContain("paused");
  });

  test("start refuses a failed download and says Heronite stopped it", async () => {
    const refusal = await refusalOf(
      install.start(ask("legendary:ExampleFailedEpicApp"), settings()),
    );

    expect(refusal.message).toContain("Heronite");
    expect(refusal.message).toContain("stopped");
  });

  test("start refuses a finished download", async () => {
    const dir = dataRoot({
      "store/download-manager.json": {
        queue: [],
        finished: [
          {
            params: { runner: "legendary", appName: "ExampleDone" },
            type: "install",
            status: "done",
          },
        ],
      },
    });

    const refusal = await refusalOf(
      install.start(ask("legendary:ExampleDone"), settings({ dataDir: dir })),
    );

    expect(refusal.message).toContain("Heronite");
    expect(refusal.message).toContain("finished");
  });

  test("start refuses a title Heronite is not fetching at all", async () => {
    const refusal = await refusalOf(install.start(ask("legendary:ExampleNotQueued"), settings()));

    expect(refusal.message).toContain("Heronite");
  });

  test("start refuses when no data root or no queue file exists", async () => {
    const dir = dataRoot({});

    const refusal = await refusalOf(install.start(ask("nile:Example"), settings({ dataDir: dir })));

    expect(refusal.message).toContain("Heronite");
  });

  test("pause, cancel and uninstall always refuse because Heronite owns the files", async () => {
    const cases = [
      install.pause(ask("nile:amzn1.adg.product.Example"), settings()),
      install.cancel(ask("nile:amzn1.adg.product.Example"), settings()),
      install.uninstall(ask("nile:amzn1.adg.product.Example"), settings()),
    ];

    for (const refusal of await Promise.all(cases.map(refusalOf))) {
      expect(refusal.message).toContain("Heronite");
    }
  });
});
