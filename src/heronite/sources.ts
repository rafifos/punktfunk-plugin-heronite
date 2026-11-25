// Every Heronite file this plugin reads, in one tolerant pass, plus the rules the Collection and
// the per-game tab must agree on: the store-cache merge, the GOG installed merge, the Steam
// id-only join and the install answer. Files are never inspected (ADR-0006).

import type {
  AmazonLibraryFile,
  ArtFile,
  CollectionArt,
  CollectionMetadata,
  CompletionStatus,
  CopiesFile,
  DownloadElement,
  DownloadManagerFile,
  EmulatorsFile,
  EpicLibraryFile,
  GameInfo,
  GameInstall,
  GogInstalledFile,
  GogInstalledGame,
  GogLibraryFile,
  LocalGameMeta,
  LocalGameSession,
  LocalLibraryFile,
  MetadataFile,
  SessionsFile,
  SideloadLibraryFile,
  StatusesFile,
  SteamLibraryFile,
  StoreConfigFile,
  TimestampFile,
  UserEmulator,
} from "./model.js";

import { entryId, STORE_RUNNERS } from "./identity.js";
import { readStore } from "./json.js";
import { dataPaths } from "./paths.js";
import { nonEmpty } from "./text.js";

/** One game as a store source lists it, after the GOG install record is folded in. */
interface CachedGame {
  readonly runner: string;
  readonly appName: string;
  readonly gameInfo: GameInfo;
}

/** One live queue element, under the external id of the entry it belongs to. */
interface QueuedDownload {
  readonly runner: string;
  readonly appName: string;
  readonly element: DownloadElement;
}

/** Everything the plugin knows about one data root before any filtering. */
interface HeroniteSources {
  readonly sideload: readonly GameInfo[];
  readonly epic: readonly GameInfo[];
  readonly gog: readonly GameInfo[];
  readonly amazon: readonly GameInfo[];
  readonly gogInstalled: ReadonlyMap<string, GogInstalledGame>;
  readonly steamInstalled: ReadonlySet<string>;
  readonly hidden: ReadonlySet<string>;
  readonly localLibrary: Readonly<Record<string, LocalGameMeta>>;
  readonly metadata: Readonly<Record<string, CollectionMetadata>>;
  readonly art: Readonly<Record<string, CollectionArt>>;
  readonly emulators: readonly UserEmulator[];
  readonly copies: CopiesFile | undefined;
  readonly sessions: Readonly<Record<string, readonly LocalGameSession[]>>;
  readonly statuses: readonly CompletionStatus[];
  readonly timestamps: TimestampFile;
  readonly downloads: DownloadManagerFile | undefined;
}

function gogInstalledIndex(
  records: readonly GogInstalledGame[],
): ReadonlyMap<string, GogInstalledGame> {
  const index = new Map<string, GogInstalledGame>();
  for (const record of records) {
    const appName = nonEmpty(record.appName);
    if (appName !== undefined) index.set(appName, record);
  }
  return index;
}

function hiddenIds(config: StoreConfigFile | undefined): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const reference of config?.games?.hidden ?? []) {
    const appName = nonEmpty(reference.appName);
    if (appName !== undefined) hidden.add(appName);
  }
  return hidden;
}

/** The Steam app ids the cached library marks installed, family-shared games included. */
export function installedIds(steam: SteamLibraryFile | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of [...(steam?.games ?? []), ...(steam?.family ?? [])]) {
    const appId = nonEmpty(row.appId);
    if (row.installed === true && appId !== undefined) ids.add(appId);
  }
  return ids;
}

/** Reads one data root. A missing or malformed file contributes nothing, never emptiness. */
export function readSources(root: string): HeroniteSources {
  const paths = dataPaths(root);
  const epic = readStore<EpicLibraryFile>(paths.epicLibrary);
  const gog = readStore<GogLibraryFile>(paths.gogLibrary);
  const amazon = readStore<AmazonLibraryFile>(paths.amazonLibrary);

  // A store cache only counts when its `__timestamp` wrapper is written too (Heronite's rule).
  return {
    sideload: readStore<SideloadLibraryFile>(paths.sideloadLibrary)?.games ?? [],
    epic: epic !== undefined && epic.__timestamp?.library !== undefined ? (epic.library ?? []) : [],
    gog: gog !== undefined && gog.__timestamp?.games !== undefined ? (gog.games ?? []) : [],
    amazon:
      amazon !== undefined && amazon.__timestamp?.library !== undefined
        ? (amazon.library ?? [])
        : [],
    gogInstalled: gogInstalledIndex(
      readStore<GogInstalledFile>(paths.gogInstalled)?.installed ?? [],
    ),
    steamInstalled: installedIds(readStore<SteamLibraryFile>(paths.steamLibrary)),
    hidden: hiddenIds(readStore<StoreConfigFile>(paths.storeConfig)),
    localLibrary: readStore<LocalLibraryFile>(paths.localLibrary)?.games ?? {},
    metadata: readStore<MetadataFile>(paths.metadata)?.games ?? {},
    art: readStore<ArtFile>(paths.art)?.games ?? {},
    emulators: readStore<EmulatorsFile>(paths.emulators)?.emulators ?? [],
    copies: readStore<CopiesFile>(paths.copies),
    sessions: readStore<SessionsFile>(paths.sessions)?.sessions ?? {},
    statuses: readStore<StatusesFile>(paths.statuses)?.statuses ?? [],
    timestamps: readStore<TimestampFile>(paths.timestamp) ?? {},
    downloads: readStore<DownloadManagerFile>(paths.downloadManager),
  };
}

/** Folds GOG's install record into its cache row, exactly as Heronite's Collection does. */
export function applyGogInstalled(
  gameInfo: GameInfo,
  record: GogInstalledGame | undefined,
): GameInfo {
  if (record === undefined) return gameInfo;

  const install: GameInstall = {
    ...gameInfo.install,
    ...(record.install_path === undefined ? {} : { install_path: record.install_path }),
    ...(record.install_size === undefined ? {} : { install_size: record.install_size }),
    ...(record.version === undefined ? {} : { version: record.version }),
    ...(record.platform === undefined ? {} : { platform: record.platform }),
  };
  return { ...gameInfo, is_installed: true, install };
}

/**
 * The four game sources in Heronite's merge order (sideload, Epic, GOG, Amazon), with the GOG
 * install record applied. The Collection dedupes these by key; the tab takes the first match.
 */
export function cachedGames(sources: HeroniteSources): readonly CachedGame[] {
  const games: CachedGame[] = [];
  const add = (gameInfo: GameInfo, runnerFallback: string): void => {
    const appName = nonEmpty(gameInfo.app_name);
    if (appName === undefined) return;
    const runner = nonEmpty(gameInfo.runner) ?? runnerFallback;
    const merged =
      runner === "gog" ? applyGogInstalled(gameInfo, sources.gogInstalled.get(appName)) : gameInfo;
    games.push({ runner, appName, gameInfo: { ...merged, runner, app_name: appName } });
  };

  for (const gameInfo of sources.sideload) add(gameInfo, "sideload");
  for (const gameInfo of sources.epic) add(gameInfo, "legendary");
  for (const gameInfo of sources.gog) add(gameInfo, "gog");
  for (const gameInfo of sources.amazon) add(gameInfo, "nile");
  return games;
}

/** The Steam app id the overlay, metadata or a `steam_<id>` app name declares. */
export function steamAppIdOf(
  gameInfo: GameInfo | undefined,
  local: LocalGameMeta | undefined,
  metadata: CollectionMetadata | undefined,
): string | undefined {
  const declared = nonEmpty(local?.steamAppId) ?? nonEmpty(metadata?.steamAppId);
  if (declared !== undefined) return declared;

  const appName = nonEmpty(gameInfo?.app_name);
  if (appName === undefined || !appName.startsWith("steam_")) return undefined;
  const suffix = appName.slice("steam_".length);
  return /^\d+$/.test(suffix) ? suffix : undefined;
}

/**
 * True when the cached Steam library is the reason a store game's files exist. Only a store game
 * joins (the plan's "for a store game"): a sideload Steam URI entry is installed solely when its
 * own `is_installed` says so.
 */
export function joinedSteam(
  sources: HeroniteSources,
  runner: string,
  appName: string,
  gameInfo: GameInfo | undefined,
  steamAppId: string | undefined,
): boolean {
  return (
    gameInfo?.is_installed !== true &&
    !(runner === "gog" && sources.gogInstalled.has(appName)) &&
    STORE_RUNNERS.has(runner) &&
    steamAppId !== undefined &&
    sources.steamInstalled.has(steamAppId)
  );
}

/** The shared install answer: Heronite's flag, the GOG record, or the Steam id-only join. */
export function isInstalled(
  sources: HeroniteSources,
  runner: string,
  appName: string,
  gameInfo: GameInfo | undefined,
  local: LocalGameMeta | undefined,
  metadata: CollectionMetadata | undefined,
): boolean {
  if (gameInfo?.is_installed === true) return true;
  if (runner === "gog" && sources.gogInstalled.has(appName)) return true;
  return joinedSteam(sources, runner, appName, gameInfo, steamAppIdOf(gameInfo, local, metadata));
}

/** The live queue, keyed by external id. History rows never count as a download. */
export function queueDownloads(
  downloads: DownloadManagerFile | undefined,
): ReadonlyMap<string, QueuedDownload> {
  const queue = new Map<string, QueuedDownload>();
  for (const element of downloads?.queue ?? []) {
    const runner = nonEmpty(element.params?.runner) ?? nonEmpty(element.params?.gameInfo?.runner);
    const appName =
      nonEmpty(element.params?.appName) ?? nonEmpty(element.params?.gameInfo?.app_name);
    if (runner === undefined || appName === undefined) continue;

    const id = entryId(runner, appName);
    if (!queue.has(id)) queue.set(id, { runner, appName, element });
  }
  return queue;
}

export type { CachedGame, HeroniteSources, QueuedDownload };
