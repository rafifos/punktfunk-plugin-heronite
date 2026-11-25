// The Collection view: Heronite's four game sources merged with its local overlay, then filtered
// down to what the launcher can start. A game's files are never inspected (ADR-0006); install
// state comes from Heronite's own flags, the GOG installed record and the cached Steam library.

import type {
  CollectionArt,
  CollectionMetadata,
  DownloadElement,
  EmulatorProfile,
  GameInfo,
  LaunchKind,
  LocalGameMeta,
  UserEmulator,
} from "./model.js";

import {
  collectionKey,
  entryId,
  metadataKey,
  parseCollectionKey,
  STORE_RUNNERS,
} from "./identity.js";
import {
  cachedGames,
  isInstalled,
  joinedSteam,
  queueDownloads,
  readSources,
  steamAppIdOf,
} from "./sources.js";
import { nonEmpty } from "./text.js";

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
  readonly games: readonly CollectionGame[];
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

/**
 * Collapses only the groups `copies.json` records: the first installed member (group order) that
 * reached the Collection is published; only when no member is installed, the first downloading
 * member is. Every other member is out, and a group with neither publishes none. Automatic twins
 * and `preferred` are deliberately ignored.
 */
function collapseCopies(
  games: readonly CollectionGame[],
  links: readonly (readonly string[])[] | undefined,
): readonly CollectionGame[] {
  if (links === undefined) return games;

  const byKey = new Map(games.map((game) => [collectionKey(game.runner, game.appName), game]));
  const excluded = new Set<string>();

  for (const group of links) {
    const members: string[] = [];
    for (const raw of group) {
      const parsed = parseCollectionKey(raw);
      if (parsed === undefined) continue;
      const key = collectionKey(parsed.runner, parsed.appName);
      if (byKey.has(key)) members.push(key);
    }

    const chosen =
      members.find((key) => byKey.get(key)?.installed === true) ??
      members.find((key) => byKey.get(key)?.downloading !== undefined);

    for (const key of members) {
      if (key !== chosen) excluded.add(key);
    }
  }

  return games.filter((game) => !excluded.has(collectionKey(game.runner, game.appName)));
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
  const sources = readSources(root);
  const queue = queueDownloads(sources.downloads);

  const merged = new Map<string, GameInfo>();
  for (const { runner, appName, gameInfo } of cachedGames(sources)) {
    const key = entryId(runner, appName);
    if (!merged.has(key)) merged.set(key, gameInfo);
  }

  // A download Heronite started before its store cache was written still belongs in the library.
  for (const [key, queued] of queue) {
    if (merged.has(key)) continue;
    merged.set(key, {
      ...queued.element.params?.gameInfo,
      runner: queued.runner,
      app_name: queued.appName,
    });
  }

  const games: CollectionGame[] = [];
  for (const [key, gameInfo] of merged) {
    const runner = gameInfo.runner ?? "";
    const appName = gameInfo.app_name ?? "";
    const local = sources.localLibrary[appName];
    const metadata = sources.metadata[metadataKey(runner, appName)];
    const steamAppId = steamAppIdOf(gameInfo, local, metadata);
    const queued = queue.get(key);

    const game: CollectionGame = {
      key,
      runner,
      appName,
      title:
        nonEmpty(local?.title) ?? nonEmpty(metadata?.title) ?? nonEmpty(gameInfo.title) ?? appName,
      gameInfo,
      local,
      metadata,
      art: sources.art[key],
      emulator: resolveEmulator(local, sources.emulators),
      steamAppId,
      installed: isInstalled(sources, runner, appName, gameInfo, local, metadata),
      steamInstalled: joinedSteam(sources, runner, appName, gameInfo, steamAppId),
      downloading: queued?.element,
      sizeBytes: parseDisplaySize(
        queued?.element.params?.size ?? queued?.element.params?.gameInfo?.install?.install_size,
      ),
    };

    if (passesFilters(game, sources.hidden) && (game.installed || game.downloading !== undefined)) {
      games.push(game);
    }
  }

  const collapsed = collapseCopies(games, sources.copies?.links);
  return { games: [...collapsed].sort((left, right) => compareKeys(left.key, right.key)) };
}

export type { Collection, CollectionGame, ResolvedEmulator };
