// How the plugin starts Heronite. The transport is chosen once per install; every title then asks
// Heronite to launch the game and the plugin never targets a game executable itself (ADR-0001).

import type { Artwork, ProviderEntry } from "@punktfunk/plugin-kit/wire";

import { existsSync, readdirSync } from "node:fs";

import { pathApi } from "./paths.js";
import { nonEmpty } from "./text.js";

const PROGRAM_NAME = "heronite-rs";

/** Portable and Windows copies ship the binary under one of these names. */
const PROGRAM_CANDIDATES = ["heronite-rs", "heronite-rs.exe", "heronite.exe"];

/** Heronite's Linux AppImage is a program too: it answers the same CLI and needs no unpacking. */
const APPIMAGE = /\.appimage$/i;

/** The host caps an exec-template parameter at 128 characters. */
const MAX_PROTOCOL_BYTES = 128;

const WINDOW_URL = "heronite://";

/** Heronite's author and first release year, as heronite.app states them. */
const DEVELOPER = "Rafael Goulart";
const FIRST_RELEASE_YEAR = 2026;

/** The tile art's home. The host's art proxy fetches each file once and serves it from its store. */
const ART_URL =
  "https://raw.githubusercontent.com/rafifos/punktfunk-plugin-heronite/main/assets/brand/";

/** One tile's four art slots, each naming the PNG in `assets/brand/` that holds it. */
const tileArt = (file: string): Artwork => ({
  portrait: `${ART_URL}portrait-${file}.png`,
  hero: `${ART_URL}hero-${file}.png`,
  logo: `${ART_URL}logo-${file}.png`,
  header: `${ART_URL}header-${file}.png`,
});

interface LaunchEnvironment {
  readonly platform?: NodeJS.Platform;
  readonly onPath?: (command: string) => boolean;
  readonly exists?: (file: string) => boolean;
  readonly list?: (dir: string) => readonly string[];
}

/** A folder that cannot be read lists as empty, exactly like one with no program in it. */
const listDir = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** The tile switches; the tiles read nothing else. */
interface LauncherTileSettings {
  readonly showLauncherTile?: boolean | undefined;
  readonly showConsoleTile?: boolean | undefined;
}

interface LaunchSettings {
  /** The operator's "Heronite program folder" setting; empty means auto-detect. */
  readonly programFolder?: string | undefined;
  /** True when the chosen data root is inside the Flatpak sandbox. */
  readonly flatpak?: boolean | undefined;
  /** Force the `heronite://` handler, even when a program is available. */
  readonly useProtocolUrl?: boolean | undefined;
}

type Transport =
  | { readonly kind: "run" }
  | { readonly kind: "run-program"; readonly program: string }
  | { readonly kind: "run-flatpak" }
  | { readonly kind: "open"; readonly template: "open" | "open-windows" };

function onPath(
  command: string,
  platform: NodeJS.Platform,
  exists: (file: string) => boolean,
): boolean {
  const raw = process.env.PATH ?? process.env.Path ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const api = pathApi(platform);
  const names = platform === "win32" ? [command, `${command}.exe`] : [command];

  return raw
    .split(delimiter)
    .filter((dir) => dir !== "")
    .some((dir) => names.some((name) => exists(api.join(dir, name))));
}

/**
 * The program a configured folder names. The binary first, then Heronite's AppImage: an AppImage
 * install ships no `heronite-rs` beside it, and it is a long-lived program that answers the same
 * CLI, which is what a dedicated display needs. `undefined` when the folder holds neither, so the
 * caller can fall through rather than hand the host a path that does not exist.
 */
function resolveProgram(
  folder: string,
  platform: NodeJS.Platform,
  exists: (file: string) => boolean,
  list: (dir: string) => readonly string[],
): string | undefined {
  const api = pathApi(platform);
  const binary = PROGRAM_CANDIDATES.map((name) => api.join(folder, name)).find((candidate) =>
    exists(candidate),
  );
  if (binary !== undefined) return binary;

  const appimages = list(folder)
    .filter((name) => APPIMAGE.test(name) && /heronite/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => api.join(folder, name));
  return appimages.find((candidate) => exists(candidate));
}

function exec(value: string, args?: readonly { readonly name: string; readonly value: string }[]) {
  return args === undefined
    ? ({ kind: "exec", value } as const)
    : ({ kind: "exec", value, args } as const);
}

function runnerArgs(runner: string, appName: string) {
  return [
    { name: "runner", value: runner },
    { name: "appName", value: appName },
  ];
}

function programArgs(program: string) {
  return [{ name: "program", value: program }];
}

function windowLaunch(transport: Transport) {
  switch (transport.kind) {
    case "run":
      return exec("window");
    case "run-program":
      return exec("window-program", programArgs(transport.program));
    case "run-flatpak":
      return exec("window-flatpak");
    case "open":
      return exec(transport.template, [{ name: "url", value: WINDOW_URL }]);
  }
}

function consoleLaunch(transport: Transport) {
  switch (transport.kind) {
    case "run":
      return exec("console");
    case "run-program":
      return exec("console-program", programArgs(transport.program));
    case "run-flatpak":
      return exec("console-flatpak");
    case "open":
      return undefined;
  }
}

/**
 * Picks the launch transport: the operator's forced protocol URL, a `heronite-rs` on PATH, the
 * configured program folder (its binary or Heronite's AppImage), a Flatpak data root, then the
 * protocol URL through the platform's opener.
 */
export function chooseTransport(
  settings: LaunchSettings = {},
  environment: LaunchEnvironment = {},
): Transport {
  const platform = environment.platform ?? process.platform;
  const exists = environment.exists ?? existsSync;
  const list = environment.list ?? listDir;
  const lookup = environment.onPath ?? ((command: string) => onPath(command, platform, exists));

  if (settings.useProtocolUrl === true) {
    return { kind: "open", template: platform === "win32" ? "open-windows" : "open" };
  }

  if (lookup(PROGRAM_NAME)) return { kind: "run" };

  const programFolder = nonEmpty(settings.programFolder);
  if (programFolder !== undefined) {
    const program = resolveProgram(programFolder, platform, exists, list);
    // A folder with no program in it is a misconfiguration, not an install: fall through rather
    // than publish commands that cannot run.
    if (program !== undefined) return { kind: "run-program", program };
  }

  if (settings.flatpak === true) return { kind: "run-flatpak" };

  return { kind: "open", template: platform === "win32" ? "open-windows" : "open" };
}

export function protocolUrl(runner: string, appName: string): string {
  return `heronite://launch?appName=${encodeURIComponent(appName)}&runner=${encodeURIComponent(runner)}`;
}

/**
 * One game's launch spec, or `undefined` when the protocol fallback cannot fit the host's
 * 128-character parameter cap. An entry with no spec is dropped at publish time.
 */
export function gameLaunch(transport: Transport, runner: string, appName: string) {
  switch (transport.kind) {
    case "run":
      return exec("run", runnerArgs(runner, appName));
    case "run-program":
      return exec("run-program", [
        ...programArgs(transport.program),
        ...runnerArgs(runner, appName),
      ]);
    case "run-flatpak":
      return exec("run-flatpak", runnerArgs(runner, appName));
    case "open": {
      const url = protocolUrl(runner, appName);
      if (new TextEncoder().encode(url).length > MAX_PROTOCOL_BYTES) return undefined;
      return exec(transport.template, [{ name: "url", value: url }]);
    }
  }
}

/**
 * The launcher tiles: Heronite's window, and the console mode when a program is known.
 *
 * `icon` takes a **brand-mark token** only, never image bytes and never a URL, and every client
 * resolves the token against the marks that it bundles. The mark's master is the `H` in
 * `assets/heronite-marks/`; it belongs in punktfunk's `assets/launcher-icons`, and this plugin
 * needs no change when a client ships it. Until one does, a tile falls back to its name on an
 * accent face. Both tiles name the same token because Heronite has one mark: the `H` its tray
 * icons draw.
 *
 * The `art` slots are what the mark cannot cover. The host's proxy serves raster containers only,
 * because the web console renders library art in a browser and SVG is script-capable XML, so each
 * slot names a PNG in `assets/brand/`, which the proxy fetches once and serves from its own store.
 * The titles and descriptions are the same strings those banners show.
 *
 * Each tile also carries the facts a details pane shows for any entry: a platform, a title, a
 * description, Heronite's author and its first release year.
 */
export function launcherTiles(
  transport: Transport,
  settings: LauncherTileSettings = {},
): readonly ProviderEntry[] {
  const tiles: ProviderEntry[] = [];

  if (settings.showLauncherTile !== false) {
    tiles.push({
      external_id: "launcher",
      title: "Heronite",
      platform: "PC",
      description: "The game launcher's desktop window.",
      developer: DEVELOPER,
      release_year: FIRST_RELEASE_YEAR,
      art: tileArt("heronite"),
      role: "launcher",
      icon: "heronite",
      launch: windowLaunch(transport),
    });
  }

  // The console template only exists for a program; the protocol fallback has none.
  const console = consoleLaunch(transport);
  if (settings.showConsoleTile !== false && console !== undefined) {
    tiles.push({
      external_id: "console",
      title: "Heronite Console",
      platform: "PC",
      description: "A controller-first layout for a TV or Steam Deck.",
      developer: DEVELOPER,
      release_year: FIRST_RELEASE_YEAR,
      art: tileArt("heronite-console"),
      role: "launcher",
      icon: "heronite",
      launch: console,
    });
  }

  return tiles;
}

export type { LaunchEnvironment, LauncherTileSettings, LaunchSettings, Transport };
