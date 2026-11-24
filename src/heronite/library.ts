// The Collection view: Heronite's four game sources merged with its local overlay, then filtered
// down to what the launcher can start. A game's files are never inspected (ADR-0006); install
// state comes from Heronite's own flags, the GOG installed record and the cached Steam library.

import type {
  AmazonLibraryFile,
  ArtFile,
  CollectionArt,
  CollectionMetadata,
  CopiesFile,
  DownloadElement,
  DownloadManagerFile,
  EmulatorProfile,
  EmulatorsFile,
  EpicLibraryFile,
  GameInfo,
  GameInstall,
  GogInstalledFile,
  GogInstalledGame,
  GogLibraryFile,
  LaunchKind,
  LocalGameMeta,
  LocalLibraryFile,
  MetadataFile,
  SideloadLibraryFile,
  SteamLibraryFile,
  StoreConfigFile,
  UserEmulator,
} from "./model.js";

import { readStore } from "./json.js";
import { dataPaths } from "./paths.js";

/** Runners whose own store client starts the game; they need no launch overlay. */
const STORE_RUNNERS: ReadonlySet<string> = new Set(["legendary", "gog", "nile"]);

interface ResolvedEmulator {
  readonly emulator: UserEmulator;
  readonly profile: EmulatorProfile;
  readonly romPath: string | undefined;
}

/** One game that passed Heronite's filters, with everything an entry needs already joined. */
interface CollectionGame {
  /** `<runner>:<appName>` — the metadata key, the external id (ADR-0004). */
  readonly key: string;
  readonly runner: string;
  readonly appName: string;
  readonly title: string;
  readonly gameInfo: GameInfo;
  readonly local: LocalGameMeta | undefined;
  readonly metadata: CollectionMetadata | undefined;
  readonly art: CollectionArt | undefined;
  readonly emulator: ResolvedEmulator | undefined;
  /** The declared Steam app id, string as Heronite writes it. */
  readonly steamAppId: string | undefined;
  readonly installed: boolean;
  /** True when the installed state came from the cached Steam library, not the game's own store. */
  readonly steamInstalled: boolean;
  readonly downloading: DownloadElement | undefined;
  /** The download's display size parsed to bytes, when it was parseable. */
  readonly sizeBytes: number | undefined;
}

interface Collection {
  readonly root: string;
  readonly games: readonly CollectionGame[];
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

const SIZE_FACTORS: Readonly<Record<string, number>> = {
  B: 1,
  KB: 1_000,
  MB: 1_000_000,
  GB: 1_000_000_000,
  KIB: 1_024,
  MIB: 1_024 ** 2,
  GIB: 1_024 ** 3,
};

function catalogueSteamAppId(
  gameInfo: GameInfo,
  local: LocalGameMeta | undefined,
  metadata: CollectionMetadata | undefined,
): string | undefined {
  const declared = nonEmpty(local?.steamAppId) ?? nonEmpty(metadata?.steamAppId);
  if (declared !== undefined) return declared;

  const appName = nonEmpty(gameInfo.app_name);
  if (appName === undefined || !appName.startsWith("steam_")) return undefined;
  const suffix = appName.slice("steam_".length);
  return /^\d+$/.test(suffix) ? suffix : undefined;
}

function metadataKey(runner: string, appName: string): string {
  // Heronite stores Zoom's fetched metadata under the sideload key; art.json keeps `zoom`.
  return `${runner === "zoom" ? "sideload" : runner}:${appName}`;
}

function resolveEmulator(
  local: LocalGameMeta | undefined,
  emulators: readonly UserEmulator[],
): ResolvedEmulator | undefined {
  const emulatorId = nonEmpty(local?.emulatorId);
  const profileId = nonEmpty(local?.emulatorProfileId);
  if (emulatorId === undefined || profileId === undefined) return undefined;

  const emulator = emulators.find((candidate) => candidate.id === emulatorId);
  const profile = emulator?.profiles?.find((candidate) => candidate.id === profileId);
  if (emulator === undefined || profile === undefined) return undefined;

  const selected = nonEmpty(local?.selectedRomPath);
  const firstRom = (local?.roms ?? [])
    .map((rom) => nonEmpty(rom.path))
    .find((path) => path !== undefined);

  return { emulator, profile, romPath: selected ?? firstRom };
}

function hasExecutable(gameInfo: GameInfo, local: LocalGameMeta | undefined): boolean {
  return (
    nonEmpty(gameInfo.install?.executable) !== undefined ||
    nonEmpty(local?.remappedExecutable) !== undefined ||
    nonEmpty(local?.windowsExecutable) !== undefined ||
    nonEmpty(local?.heroniteCommand) !== undefined ||
    nonEmpty(gameInfo.heroniteCommand) !== undefined
  );
}

function isRunnable(game: CollectionGame): boolean {
  if (STORE_RUNNERS.has(game.runner)) return true;
  if (game.runner !== "sideload") return false;

  const launchKind: LaunchKind | undefined = game.local?.launchKind;
  switch (launchKind) {
    case "steam-uri":
      return game.steamAppId !== undefined;
    case "executable":
      return hasExecutable(game.gameInfo, game.local);
    case "emulator":
      return game.emulator !== undefined && game.emulator.romPath !== undefined;
    case "launcher":
    case "client":
    case "xbox":
      return true;
    default:
      return false;
  }
}

/** Heronite's Collection filters: hidden, DLC, browser titles, dead overlays, no launch method. */
function passesFilters(game: CollectionGame, hidden: ReadonlySet<string>): boolean {
  if (game.runner === "zoom") return false;
  if (hidden.has(game.appName)) return false;
  if (game.gameInfo.install?.is_dlc === true) return false;
  if (
    game.gameInfo.install?.platform === "Browser" ||
    nonEmpty(game.gameInfo.browserUrl) !== undefined
  ) {
    return false;
  }

  const launchKind = game.local?.launchKind;
  if (launchKind === "unavailable" || launchKind === "") return false;

  return isRunnable(game);
}

/** `runner_appName` (Collection key) to `runner:appName`; split at the first underscore. */
function parseCopyKey(key: string): string | undefined {
  const separator = key.indexOf("_");
  if (separator <= 0 || separator === key.length - 1) return undefined;
  return `${key.slice(0, separator)}:${key.slice(separator + 1)}`;
}

/**
 * Collapses only the groups `copies.json` records: the first member (group order) that reached the
 * Collection is published, every other member is out. Groups with no surviving member publish
 * none. Automatic twins and `preferred` are deliberately ignored.
 */
function collapseCopies(
  games: readonly CollectionGame[],
  links: readonly (readonly string[])[] | undefined,
): readonly CollectionGame[] {
  if (links === undefined) return games;

  const present = new Map(games.map((game) => [game.key, game]));
  const excluded = new Set<string>();

  for (const group of links) {
    const members = group.map(parseCopyKey).filter((key): key is string => key !== undefined);
    const chosen = members.find((key) => present.has(key));

    for (const key of members) {
      if (key !== chosen) excluded.add(key);
    }
  }

  return games.filter((game) => !excluded.has(game.key));
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Parses Heronite's display sizes (`"25.87 GiB"`, `"12.5 GB"`, `"0"`) to bytes. The `iB` units are
 * 1024-based; the plain ones are decimal. An unrecognized unit is `undefined`, never zero.
 */
export function parseDisplaySize(text: string | undefined): number | undefined {
  const value = nonEmpty(text);
  if (value === undefined) return undefined;

  const match = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?\s*$/.exec(value);
  if (match === null) return undefined;

  const amount = Number(match[1]);
  const unit = match[2]?.toUpperCase();
  if (!Number.isFinite(amount)) return undefined;
  if (unit === undefined) return Math.round(amount);

  const factor = SIZE_FACTORS[unit];
  return factor === undefined ? undefined : Math.round(amount * factor);
}

/**
 * Assembles the Collection from one Heronite data root. Reads are tolerant: a missing or malformed
 * file contributes nothing but never turns the library into a different, empty one.
 */
export function assembleCollection(root: string): Collection {
  const paths = dataPaths(root);

  const sideload = readStore<SideloadLibraryFile>(paths.sideloadLibrary)?.games ?? [];
  const epic = readStore<EpicLibraryFile>(paths.epicLibrary);
  const gog = readStore<GogLibraryFile>(paths.gogLibrary);
  const amazon = readStore<AmazonLibraryFile>(paths.amazonLibrary);
  const gogInstalled = readStore<GogInstalledFile>(paths.gogInstalled)?.installed ?? [];
  const steam = readStore<SteamLibraryFile>(paths.steamLibrary);
  const config = readStore<StoreConfigFile>(paths.storeConfig);
  const localLibrary = readStore<LocalLibraryFile>(paths.localLibrary)?.games ?? {};
  const metadataFile = readStore<MetadataFile>(paths.metadata)?.games ?? {};
  const art = readStore<ArtFile>(paths.art)?.games ?? {};
  const emulators = readStore<EmulatorsFile>(paths.emulators)?.emulators ?? [];
  const copies = readStore<CopiesFile>(paths.copies);
  const downloadManager = readStore<DownloadManagerFile>(paths.downloadManager);

  const installedByGog = new Map<string, GogInstalledGame>();
  for (const record of gogInstalled) {
    const appName = nonEmpty(record.appName);
    if (appName !== undefined) installedByGog.set(appName, record);
  }

  const steamInstalled = new Set<string>();
  for (const row of [...(steam?.games ?? []), ...(steam?.family ?? [])]) {
    const appId = nonEmpty(row.appId);
    if (row.installed === true && appId !== undefined) steamInstalled.add(appId);
  }

  const hidden = new Set<string>();
  for (const reference of config?.games?.hidden ?? []) {
    const appName = nonEmpty(reference.appName);
    if (appName !== undefined) hidden.add(appName);
  }

  const merged = new Map<string, GameInfo>();
  const add = (gameInfo: GameInfo, runnerFallback: string): void => {
    const appName = nonEmpty(gameInfo.app_name);
    if (appName === undefined) return;
    const runner = nonEmpty(gameInfo.runner) ?? runnerFallback;
    const key = `${runner}:${appName}`;
    if (!merged.has(key)) merged.set(key, { ...gameInfo, runner, app_name: appName });
  };

  for (const gameInfo of sideload) add(gameInfo, "sideload");

  const epicGames =
    epic !== undefined && epic.__timestamp?.library !== undefined ? (epic.library ?? []) : [];
  for (const gameInfo of epicGames) add(gameInfo, "legendary");

  const gogGames =
    gog !== undefined && gog.__timestamp?.games !== undefined ? (gog.games ?? []) : [];
  for (const gameInfo of gogGames) {
    const appName = nonEmpty(gameInfo.app_name);
    const record = appName === undefined ? undefined : installedByGog.get(appName);
    if (record === undefined) {
      add(gameInfo, "gog");
      continue;
    }

    const install: GameInstall = {
      ...gameInfo.install,
      ...(record.install_path === undefined ? {} : { install_path: record.install_path }),
      ...(record.install_size === undefined ? {} : { install_size: record.install_size }),
      ...(record.version === undefined ? {} : { version: record.version }),
      ...(record.platform === undefined ? {} : { platform: record.platform }),
    };
    add({ ...gameInfo, is_installed: true, install }, "gog");
  }

  const amazonGames =
    amazon !== undefined && amazon.__timestamp?.library !== undefined ? (amazon.library ?? []) : [];
  for (const gameInfo of amazonGames) add(gameInfo, "nile");

  const downloads = new Map<string, DownloadElement>();
  for (const element of downloadManager?.queue ?? []) {
    const runner = nonEmpty(element.params?.runner) ?? nonEmpty(element.params?.gameInfo?.runner);
    const appName =
      nonEmpty(element.params?.appName) ?? nonEmpty(element.params?.gameInfo?.app_name);
    if (runner === undefined || appName === undefined) continue;

    const key = `${runner}:${appName}`;
    if (!downloads.has(key)) downloads.set(key, element);
  }

  // A download Heronite started before its store cache was written still belongs in the library.
  for (const [key, element] of downloads) {
    if (merged.has(key)) continue;

    const runner = nonEmpty(element.params?.runner) ?? nonEmpty(element.params?.gameInfo?.runner);
    const appName =
      nonEmpty(element.params?.appName) ?? nonEmpty(element.params?.gameInfo?.app_name);
    if (runner === undefined || appName === undefined) continue;

    add({ ...element.params?.gameInfo, runner, app_name: appName }, runner);
  }

  const games: CollectionGame[] = [];
  for (const [key, gameInfo] of merged) {
    const runner = gameInfo.runner ?? "";
    const appName = gameInfo.app_name ?? "";
    const local = localLibrary[appName];
    const metadata = metadataFile[metadataKey(runner, appName)];
    const steamAppId = catalogueSteamAppId(gameInfo, local, metadata);

    const byGog = runner === "gog" && installedByGog.has(appName);
    const steamJoin =
      !byGog &&
      gameInfo.is_installed !== true &&
      steamAppId !== undefined &&
      steamInstalled.has(steamAppId);

    const game: CollectionGame = {
      key,
      runner,
      appName,
      title:
        nonEmpty(local?.title) ?? nonEmpty(metadata?.title) ?? nonEmpty(gameInfo.title) ?? appName,
      gameInfo,
      local,
      metadata,
      art: art[key],
      emulator: resolveEmulator(local, emulators),
      steamAppId,
      installed: gameInfo.is_installed === true || byGog || steamJoin,
      steamInstalled: steamJoin,
      downloading: downloads.get(key),
      sizeBytes: parseDisplaySize(
        downloads.get(key)?.params?.size ??
          downloads.get(key)?.params?.gameInfo?.install?.install_size,
      ),
    };

    if (passesFilters(game, hidden) && (game.installed || game.downloading !== undefined)) {
      games.push(game);
    }
  }

  const collapsed = collapseCopies(games, copies?.links);
  return { root, games: [...collapsed].sort((left, right) => compareKeys(left.key, right.key)) };
}

export type { Collection, CollectionGame, ResolvedEmulator };
