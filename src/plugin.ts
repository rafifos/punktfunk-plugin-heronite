// The plugin's definition: the four settings, the scan/launchers/watches, and the CLI's `paths`
// verb. Downloads, install asks and the per-game tab arrive in later milestones.

import type { CliCommand } from "@punktfunk/plugin-kit";
import type { ProviderEntry } from "@punktfunk/plugin-kit/wire";
import type { DataRoot } from "./heronite/paths.js";

import { statSync } from "node:fs";

import { handedPath, makeConfigService } from "@punktfunk/plugin-kit";
import { Effect, Schema } from "effect";

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

const config = makeConfigService({ schema: HeroniteConfig });

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

export { HeroniteConfig, type HeroniteSettings };

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
  commands: { paths: pathsCommand },
};

export const plugin = defineLibraryPluginWithUi(pluginDef);
