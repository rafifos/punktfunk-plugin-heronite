// The plugin's definition: the four settings, the scan/launchers/watches, the read-only per-game
// tab, the CLI's `paths` verb, Heronite's download queue and the install asks it refuses.

import type {
  CliCommand,
  ConfigService,
  DownloadReporter,
  DownloadRow,
  ServeUiGame,
  StatusLine,
} from "@punktfunk/plugin-kit";
import type { LibraryInstall } from "@punktfunk/plugin-kit/library";
import type { ProviderEntry } from "@punktfunk/plugin-kit/wire";
import type { DataRoot } from "./heronite/paths.js";
import type { GameStats } from "./heronite/stats.js";

import { statSync } from "node:fs";

import { handedPath, InstallRefused, makeConfigService } from "@punktfunk/plugin-kit";
import { Effect, Schema } from "effect";

import {
  downloadChanges,
  downloadRows,
  makeDownloadMemory,
  readDownloads,
} from "./heronite/downloads.js";
import { buildEntries } from "./heronite/entries.js";
import { chooseTransport, launcherTiles } from "./heronite/launch.js";
import { assembleCollection } from "./heronite/library.js";
import {
  dataPaths,
  dataRootPresent,
  dataRoots,
  defaultRoots,
  dirAccess,
  findDataRoot,
  watchDirs,
} from "./heronite/paths.js";
import { readStats, statusLines } from "./heronite/stats.js";
import { defineLibraryPluginWithUi } from "./kit/library-with-ui.js";

const defaultedBoolean = (title: string, description: string) =>
  Schema.Boolean.annotate({ title, description }).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true), { encodingStrategy: "omit" }),
  );

const HeroniteConfig = Schema.Struct({
  dataDir: Schema.optionalKey(
    handedPath().annotate({
      title: "Heronite data folder",
      description: "The folder holding Heronite's data. Leave empty to find it automatically.",
    }),
  ),
  programDir: Schema.optionalKey(
    handedPath().annotate({
      title: "Heronite program folder",
      description:
        "The folder holding heronite-rs. Leave empty to find it automatically or use the protocol fallback.",
    }),
  ),
  showLauncherTile: defaultedBoolean(
    "Show a Heronite tile",
    "Add a tile that opens Heronite's window.",
  ),
  showConsoleTile: defaultedBoolean(
    "Show a Heronite Console tile",
    "Add a tile that opens Heronite in console mode.",
  ),
});

type HeroniteSettings = typeof HeroniteConfig.Type;

const resolveRoot = (cfg: HeroniteSettings): DataRoot | undefined =>
  findDataRoot({ dataFolder: cfg.dataDir });

const transportFor = (cfg: HeroniteSettings, root: DataRoot | undefined) =>
  chooseTransport({ programFolder: cfg.programDir, flatpak: root?.flatpak }, {});

const scanNow = (cfg: HeroniteSettings): readonly ProviderEntry[] => {
  const root = resolveRoot(cfg);
  if (root === undefined) return [];
  return buildEntries(assembleCollection(root.root), transportFor(cfg, root));
};

const tilesNow = (cfg: HeroniteSettings): readonly ProviderEntry[] => {
  const root = resolveRoot(cfg);
  if (root === undefined) return [];
  return launcherTiles(transportFor(cfg, root), {
    programFolder: cfg.programDir,
    flatpak: root.flatpak,
    showLauncherTile: cfg.showLauncherTile,
    showConsoleTile: cfg.showConsoleTile,
  });
};

/** A configured folder as one want; empty strings are "unset", not a folder to ask for. */
const configuredDir = (value: string | undefined): readonly string[] => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? [] : [trimmed];
};

const fileFound = (file: string): boolean => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** One sentence the host shows when Heronite, not this plugin, owns the download. */
const REFUSED = {
  paused: "Heronite has this download paused. Resume it in Heronite.",
  failed: "Heronite stopped this download. Retry it in Heronite.",
  done: "Heronite just finished it. Start it again in a moment.",
  notFetching: "Heronite installs its games itself. Start the download in Heronite.",
  pause: "Heronite runs this download. Pause it in Heronite.",
  cancel: "Heronite runs this download. Cancel it in Heronite.",
  uninstall: "Remove the game's files in Heronite.",
} as const;

/**
 * Why `start` cannot wait for a title, or `undefined` when Heronite is already fetching it. The
 * host waits only for a live row; everything else is refused before any waiting starts.
 */
function startRefusal(row: DownloadRow | undefined): string | undefined {
  switch (row?.state) {
    case "downloading":
    case "queued":
    case "installing":
      return undefined;
    case "paused":
      return REFUSED.paused;
    case "failed":
      return REFUSED.failed;
    case "done":
      return REFUSED.done;
    default:
      return REFUSED.notFetching;
  }
}

/** The title's row in the file as it is right now; a missing root or file means no row. */
function currentRow(cfg: HeroniteSettings, externalId: string): DownloadRow | undefined {
  const root = resolveRoot(cfg);
  if (root === undefined) return undefined;
  const snapshot = readDownloads(root.root);
  return snapshot === undefined ? undefined : downloadRows(snapshot).get(externalId);
}

const install: LibraryInstall<HeroniteSettings> = {
  start: (request, cfg) =>
    Effect.gen(function* () {
      const refusal = startRefusal(currentRow(cfg, request.externalId));
      if (refusal === undefined) return;
      return yield* Effect.fail(new InstallRefused({ message: refusal }));
    }),
  // Heronite owns the bytes, so these three never do anything on its behalf.
  pause: () => Effect.fail(new InstallRefused({ message: REFUSED.pause })),
  cancel: () => Effect.fail(new InstallRefused({ message: REFUSED.cancel })),
  uninstall: () => Effect.fail(new InstallRefused({ message: REFUSED.uninstall })),
};

/**
 * Reports the queue for the plugin's life. Each tick re-reads the settings, so a changed data
 * folder is followed without a restart; a missing root or malformed file skips the tick silently.
 */
const downloadsLoop = Effect.fnUntraced(function* (
  reporter: DownloadReporter,
  config: Effect.Effect<HeroniteSettings, unknown>,
): Effect.fn.Return<void> {
  const memory = makeDownloadMemory();

  yield* Effect.forever(
    Effect.gen(function* () {
      const cfg = yield* config.pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (cfg !== undefined) {
        const root = resolveRoot(cfg);
        const snapshot = root === undefined ? undefined : readDownloads(root.root);
        if (snapshot !== undefined) {
          for (const row of downloadChanges(downloadRows(snapshot), memory)) reporter.set(row);
        }
      }
      yield* Effect.sleep("2 seconds");
    }),
  );
});

const config = makeConfigService({ schema: HeroniteConfig });

/**
 * The read-only tab on one library entry. `load` answers `undefined` for entries that are not
 * this plugin's, which is what the kit turns into "no tab"; `save` never writes to Heronite.
 */
const gameSection = (
  configService: ConfigService<typeof HeroniteConfig>,
): ServeUiGame<Schema.Top> => {
  const loadStats = Effect.fnUntraced(function* (entryId: string) {
    const cfg = yield* configService.load;
    const root = resolveRoot(cfg);
    return root === undefined ? undefined : readStats(root.root, entryId);
  });

  return {
    schema: Schema.Struct({}),
    load: (entryId) => loadStats(entryId).pipe(Effect.catch(() => Effect.succeed(undefined))),
    save: () => Effect.void,
    status: (entryId) =>
      loadStats(entryId).pipe(
        Effect.map((stats: GameStats | undefined) =>
          stats === undefined ? [] : statusLines(stats),
        ),
        Effect.catch(() => Effect.succeed([] as readonly StatusLine[])),
      ),
  };
};

const pathsCommand: CliCommand<never> = {
  summary: "print the data root this plugin reads, which files exist and how much it scans",
  offline: true,
  run: () =>
    Effect.gen(function* () {
      const cfg = yield* (yield* config).load;

      for (const candidate of dataRoots({ dataFolder: cfg.dataDir })) {
        console.log(`candidate: ${dirAccess(candidate.root)} ${candidate.shape} ${candidate.root}`);
      }

      const root = resolveRoot(cfg);
      if (root === undefined) {
        console.log("no Heronite data root found");
      } else {
        console.log(`data root: ${root.root} (${root.shape})`);
        console.log("files:");
        for (const file of Object.values(dataPaths(root.root))) {
          console.log(`  ${fileFound(file) ? "found" : "missing"} ${file}`);
        }
      }

      console.log(`entries: ${scanNow(cfg).length}`);
      console.log(`launchers: ${tilesNow(cfg).length}`);
    }),
};

export { HeroniteConfig, type HeroniteSettings, startRefusal };

export const pluginDef = {
  name: "heronite",
  title: "Heronite",
  version: "0.1.0",
  configSchema: HeroniteConfig,
  detect: (cfg: HeroniteSettings) =>
    Effect.sync(() => dataRootPresent({ dataFolder: cfg.dataDir })),
  scan: (cfg: HeroniteSettings) => Effect.sync(() => scanNow(cfg)),
  launchers: (cfg: HeroniteSettings) => tilesNow(cfg),
  watchDirs: (cfg: HeroniteSettings) => {
    const root = resolveRoot(cfg);
    return root === undefined ? [] : watchDirs(root.root);
  },
  wants: (cfg: HeroniteSettings) => [
    ...defaultRoots(),
    ...configuredDir(cfg.dataDir),
    ...configuredDir(cfg.programDir),
  ],
  downloads: downloadsLoop,
  install,
  game: gameSection,
  commands: { paths: pathsCommand },
};

export const plugin = defineLibraryPluginWithUi(pluginDef);
