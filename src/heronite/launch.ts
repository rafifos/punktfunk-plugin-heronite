// How the plugin starts Heronite. The transport is chosen once per install; every title then asks
// Heronite to launch the game and the plugin never targets a game executable itself (ADR-0001).

import type { ProviderEntry } from "@punktfunk/plugin-kit/wire";

import { existsSync } from "node:fs";
import path from "node:path";

const PROGRAM_NAME = "heronite-rs";

/** Portable and Windows copies ship the binary under one of these names. */
const PROGRAM_CANDIDATES = ["heronite-rs", "heronite-rs.exe", "heronite.exe"];

/** The host caps an exec-template parameter at 128 characters. */
const MAX_PROTOCOL_BYTES = 128;

const WINDOW_URL = "heronite://";

interface LaunchEnvironment {
  readonly platform?: NodeJS.Platform;
  readonly onPath?: (command: string) => boolean;
  readonly exists?: (file: string) => boolean;
}

interface LaunchSettings {
  /** The operator's "Heronite program folder" setting; empty means auto-detect. */
  readonly programFolder?: string | undefined;
  /** True when the chosen data root is inside the Flatpak sandbox. */
  readonly flatpak?: boolean | undefined;
  readonly showLauncherTile?: boolean | undefined;
  readonly showConsoleTile?: boolean | undefined;
}

type Transport =
  | { readonly kind: "run" }
  | { readonly kind: "run-program"; readonly program: string }
  | { readonly kind: "run-flatpak" }
  | { readonly kind: "open"; readonly template: "open" | "open-windows" };

function pathApi(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

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

function resolveProgram(
  folder: string,
  platform: NodeJS.Platform,
  exists: (file: string) => boolean,
): string {
  const api = pathApi(platform);
  const candidates = PROGRAM_CANDIDATES.map((name) => api.join(folder, name));
  return candidates.find((candidate) => exists(candidate)) ?? candidates[0] ?? folder;
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

function hasProgram(transport: Transport): boolean {
  return transport.kind !== "open";
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
 * Picks the launch transport: a `heronite-rs` on PATH, then the configured program folder, then a
 * Flatpak data root, then the protocol URL through the platform's opener.
 */
export function chooseTransport(
  settings: LaunchSettings = {},
  environment: LaunchEnvironment = {},
): Transport {
  const platform = environment.platform ?? process.platform;
  const exists = environment.exists ?? existsSync;
  const lookup = environment.onPath ?? ((command: string) => onPath(command, platform, exists));

  if (lookup(PROGRAM_NAME)) return { kind: "run" };

  const programFolder = nonEmpty(settings.programFolder);
  if (programFolder !== undefined) {
    return { kind: "run-program", program: resolveProgram(programFolder, platform, exists) };
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
 * The launcher tiles: Heronite's window, and the console mode when a program is known. No client
 * bundles a Heronite mark, so neither tile carries an `icon` and clients fall back to the name.
 */
export function launcherTiles(
  transport: Transport,
  settings: LaunchSettings = {},
): readonly ProviderEntry[] {
  const tiles: ProviderEntry[] = [];

  if (settings.showLauncherTile !== false) {
    tiles.push({
      external_id: "launcher",
      title: "Heronite",
      role: "launcher",
      launch: windowLaunch(transport),
    });
  }

  const console = consoleLaunch(transport);
  if (settings.showConsoleTile !== false && hasProgram(transport) && console !== undefined) {
    tiles.push({
      external_id: "console",
      title: "Heronite Console",
      role: "launcher",
      launch: console,
    });
  }

  return tiles;
}

export type { LaunchEnvironment, LaunchSettings, Transport };
