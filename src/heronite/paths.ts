// Where Heronite keeps its data. The reader only ever looks inside the chosen root; install
// folders of individual games are Heronite's business (ADR-0006).

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** The four install shapes the plan names. */
type InstallShape = "configured" | "linux" | "flatpak" | "windows";

interface DataRoot {
  readonly root: string;
  readonly shape: InstallShape;
  /** True when the folder belongs to the Flatpak sandbox, whatever shape found it. */
  readonly flatpak: boolean;
}

interface DataRootConfig {
  /** The operator's "Heronite data folder" setting; empty means auto-discover. */
  readonly dataFolder?: string | undefined;
}

interface SystemContext {
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** What a candidate root looks like on disk. A closed folder still counts as present. */
type DirAccess = "ok" | "missing" | "denied";

interface DataPaths {
  readonly sideloadLibrary: string;
  readonly epicLibrary: string;
  readonly gogLibrary: string;
  readonly amazonLibrary: string;
  readonly gogInstalled: string;
  readonly steamLibrary: string;
  readonly storeConfig: string;
  readonly localLibrary: string;
  readonly metadata: string;
  readonly art: string;
  readonly emulators: string;
  readonly copies: string;
  readonly sessions: string;
  readonly statuses: string;
  readonly timestamp: string;
  readonly downloadManager: string;
}

type PathApi = typeof path.posix;

const FLATPAK_APP_ID = "app.heronite.Heronite";

interface ResolvedContext {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

function resolveContext(system: SystemContext): ResolvedContext {
  return {
    platform: system.platform ?? process.platform,
    home: system.home ?? homedir(),
    env: system.env ?? process.env,
  };
}

function flatpakRoot(home: string, platform: NodeJS.Platform): string {
  return pathApi(platform).join(home, ".var", "app", FLATPAK_APP_ID, "data", "heronite");
}

function isInside(candidate: string, parent: string, api: PathApi): boolean {
  const relative = api.relative(api.normalize(parent), api.normalize(candidate));
  return relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative));
}

function windowsDataRoot(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  api: PathApi,
): string {
  const appData =
    env.APPDATA !== undefined && env.APPDATA.trim() !== ""
      ? env.APPDATA
      : api.join(home, "AppData", "Roaming");
  return api.join(appData, "heronite", "data");
}

function linuxDataRoot(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  api: PathApi,
): string {
  const dataHome =
    env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME.trim() !== ""
      ? env.XDG_DATA_HOME
      : api.join(home, ".local", "share");
  return api.join(dataHome, "heronite");
}

/** The path flavour a platform's strings use; `launch` and `paths` share this one copy. */
export function pathApi(platform: NodeJS.Platform): PathApi {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Candidate data roots, best first: the configured folder, then the platform defaults
 * (Linux native and Flatpak; the Windows installer). Duplicates keep their first shape.
 */
export function dataRoots(
  config: DataRootConfig = {},
  system: SystemContext = {},
): readonly DataRoot[] {
  const { platform, home, env } = resolveContext(system);
  const api = pathApi(platform);
  const flatpak = flatpakRoot(home, platform);
  const roots: DataRoot[] = [];
  const seen = new Set<string>();

  const add = (root: string, shape: InstallShape): void => {
    const key = platform === "win32" ? root.toLowerCase() : root;
    if (seen.has(key)) return;
    seen.add(key);
    roots.push({ root, shape, flatpak: isInside(root, flatpak, api) });
  };

  const configured = config.dataFolder?.trim();
  if (configured !== undefined && configured !== "") {
    add(api.normalize(configured), "configured");
  }

  if (platform === "win32") {
    add(windowsDataRoot(home, env, api), "windows");
  } else if (platform === "linux") {
    const native = linuxDataRoot(home, env, api);
    add(native, isInside(native, flatpak, api) ? "flatpak" : "linux");
    add(flatpak, "flatpak");
  }

  return roots;
}

/** Reads a candidate's access state without probing any game file. */
export function dirAccess(target: string): DirAccess {
  try {
    if (!statSync(target).isDirectory()) return "missing";
  } catch {
    return "missing";
  }

  try {
    readdirSync(target);
    return "ok";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EACCES" || code === "EPERM" ? "denied" : "missing";
  }
}

/** The first candidate root this user can list, or `undefined` when none is usable. */
export function findDataRoot(
  config: DataRootConfig = {},
  system: SystemContext = {},
): DataRoot | undefined {
  for (const candidate of dataRoots(config, system)) {
    if (dirAccess(candidate.root) === "ok") return candidate;
  }
  return undefined;
}

/**
 * True when a candidate exists at all, even as a closed folder: the plugin wants the path so the
 * operator can grant it, but must not claim to read it.
 */
export function dataRootPresent(config: DataRootConfig = {}, system: SystemContext = {}): boolean {
  return dataRoots(config, system).some((candidate) => dirAccess(candidate.root) !== "missing");
}

/** Every file this plugin reads, all below one data root. */
export function dataPaths(root: string): DataPaths {
  return {
    sideloadLibrary: path.join(root, "sideload_apps", "library.json"),
    epicLibrary: path.join(root, "store_cache", "legendary_library.json"),
    gogLibrary: path.join(root, "store_cache", "gog_library.json"),
    amazonLibrary: path.join(root, "store_cache", "nile_library.json"),
    gogInstalled: path.join(root, "gog_store", "installed.json"),
    steamLibrary: path.join(root, "store_cache", "steam_library.json"),
    storeConfig: path.join(root, "store", "config.json"),
    localLibrary: path.join(root, "local_library", "library.json"),
    metadata: path.join(root, "local_library", "metadata.json"),
    art: path.join(root, "local_library", "art.json"),
    emulators: path.join(root, "local_library", "emulators.json"),
    copies: path.join(root, "local_library", "copies.json"),
    sessions: path.join(root, "local_library", "sessions.json"),
    statuses: path.join(root, "local_library", "statuses.json"),
    timestamp: path.join(root, "store", "timestamp.json"),
    downloadManager: path.join(root, "store", "download-manager.json"),
  };
}

/** The Linux roots the manifest asks for in `reads`, used by the host's access prompt. */
export function defaultRoots(system: SystemContext = {}): readonly string[] {
  const { home, env } = resolveContext(system);
  return [linuxDataRoot(home, env, path.posix), flatpakRoot(home, "linux")];
}

/** Folders that change while Heronite runs; the plugin watches these, not single files. */
export function watchDirs(root: string): readonly string[] {
  return [
    path.join(root, "sideload_apps"),
    path.join(root, "store_cache"),
    path.join(root, "gog_store"),
    path.join(root, "store"),
    path.join(root, "local_library"),
  ];
}

export type { DataPaths, DataRoot, DataRootConfig, DirAccess, InstallShape, SystemContext };
