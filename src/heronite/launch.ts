// How the plugin starts Heronite. The transport is chosen once per install; every title then asks
// Heronite to launch the game and the plugin never targets a game executable itself (ADR-0001).

import type { ProviderEntry } from "@punktfunk/plugin-kit/wire";

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
 * Picks the launch transport: a `heronite-rs` on PATH, then the configured program folder (its
 * binary or Heronite's AppImage), then a Flatpak data root, then the protocol URL through the
 * platform's opener.
 */
export function chooseTransport(
  settings: LaunchSettings = {},
  environment: LaunchEnvironment = {},
): Transport {
  const platform = environment.platform ?? process.platform;
  const exists = environment.exists ?? existsSync;
  const list = environment.list ?? listDir;
  const lookup = environment.onPath ?? ((command: string) => onPath(command, platform, exists));

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
 * Each names a **brand-mark token** rather than carrying artwork, because that is the only thing
 * `icon` accepts: the host takes a token matching `[a-z][a-z0-9-]{0,31}` and every client resolves
 * it against the marks it bundles. Image bytes and URLs are rejected, and the host's art proxy
 * refuses SVG outright — it serves raster containers only, because the web console renders library
 * art in a browser and SVG is script-capable XML. So the Heronite mark in
 * `assets/heronite-marks/` cannot reach a tile from here; it belongs in `assets/launcher-icons`,
 * and this plugin needs no change once it lands there.
 *
 * Both tiles name the same mark because Heronite has one: the `H` its tray icons draw, in both
 * themes. A second token would ask clients for art that does not exist.
 *
 * No shipped client bundles `heronite` yet, so both tiles fall back to their name on an accent
 * face — exactly what they rendered before — and light up unchanged when the mark ships.
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
      role: "launcher",
      icon: "heronite",
      launch: console,
    });
  }

  return tiles;
}

export type { LaunchEnvironment, LauncherTileSettings, LaunchSettings, Transport };
