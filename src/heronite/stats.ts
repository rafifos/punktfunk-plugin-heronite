// The per-game tab's data: playtime, sessions, status, source and install state for one entry.
// Reads only — this module never writes to Heronite's files, and it never probes a game's files
// (ADR-0006); install state is Heronite's own.

import type { StatusLine } from "@punktfunk/plugin-kit";
import type {
  AmazonLibraryFile,
  CollectionMetadata,
  CompletionStatus,
  DownloadElement,
  DownloadManagerFile,
  EpicLibraryFile,
  GameInfo,
  GogInstalledFile,
  GogLibraryFile,
  LocalGameMeta,
  LocalGameSession,
  LocalLibraryFile,
  MetadataFile,
  SessionsFile,
  SideloadLibraryFile,
  StatusesFile,
  SteamLibraryFile,
  TimestampFile,
} from "./model.js";

import { Predicate } from "effect";

import { readStore } from "./json.js";
import { dataPaths } from "./paths.js";

/** The plugin id the host prefixes onto every library id this plugin publishes. */
const PLUGIN_ID = "heronite";

/** Heronite's nine statuses of a fresh install, in its own order (ids are the slugs). */
const DEFAULT_STATUSES: readonly CompletionStatus[] = [
  { id: "beaten", name: "Beaten", slug: "beaten", sortOrder: 10 },
  { id: "playing", name: "Playing", slug: "playing", sortOrder: 20 },
  { id: "endless", name: "On Going", slug: "endless", sortOrder: 30 },
  { id: "plan-to-play", name: "Plan to Play", slug: "plan-to-play", sortOrder: 40 },
  { id: "played", name: "Played", slug: "played", sortOrder: 50 },
  { id: "on-hold", name: "On Hold", slug: "on-hold", sortOrder: 60 },
  { id: "not-played", name: "Not Played", slug: "not-played", sortOrder: 70 },
  { id: "completed", name: "Completed", slug: "completed", sortOrder: 80 },
  { id: "abandoned", name: "Abandoned", slug: "abandoned", sortOrder: 90 },
];

/** Heronite's `source` values as the tab labels them; an unknown value stays as it is. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  epic: "Epic",
  gog: "GOG",
  amazon: "Amazon",
  steam: "Steam",
  emulator: "Emulator",
  xbox: "Xbox",
  heroic: "Heroic",
  lutris: "Lutris",
  bottles: "Bottles",
  faugus: "Faugus",
  playnite: "Playnite",
  manual: "Manual",
  other: "Other",
  battlenet: "Battle.net",
  ea: "EA",
  ubisoft: "Ubisoft",
  rockstar: "Rockstar",
};

const MAX_STATUS_LINES = 8;
const MAX_STATUS_LINE_LENGTH = 120;

/** The tab's session summary. `totalSeconds` is summed from `elapsedSeconds`. */
interface GameSessions {
  readonly count: number;
  readonly totalSeconds: number;
  /** The newest non-empty `startedAt`, compared as text (Heronite writes RFC 3339). */
  readonly lastStartedAt?: string;
}

/** The game's completion status, already resolved to a display name. */
interface GameStatus {
  readonly id: string;
  readonly name: string;
}

/** One game's row in the per-game tab. */
interface GameStats {
  readonly entryId: string;
  readonly runner: string;
  readonly appName: string;
  readonly title?: string;
  /** Minutes from `store/timestamp.json`; absent when the game has no recorded playtime. */
  readonly playtimeMinutes?: number;
  readonly firstPlayed?: string;
  readonly lastPlayed?: string;
  readonly sessions?: GameSessions;
  readonly status?: GameStatus;
  /** The display label for the overlay's `source`, never the raw slug. */
  readonly source?: string;
  readonly install: "installed" | "missing" | "downloading";
}

function nonEmpty(value: string | undefined): string | undefined {
  return Predicate.isString(value) && value.trim() !== "" ? value : undefined;
}

/** A store cache only counts when its `__timestamp` wrapper is written too (Heronite's rule). */
interface CachedGame {
  readonly runner: string;
  readonly appName: string;
  readonly gameInfo: GameInfo;
}

function cachedGames(root: string): readonly CachedGame[] {
  const paths = dataPaths(root);
  const sideload = readStore<SideloadLibraryFile>(paths.sideloadLibrary)?.games ?? [];
  const epic = readStore<EpicLibraryFile>(paths.epicLibrary);
  const gog = readStore<GogLibraryFile>(paths.gogLibrary);
  const amazon = readStore<AmazonLibraryFile>(paths.amazonLibrary);

  const games: CachedGame[] = [];
  const add = (gameInfo: GameInfo, runnerFallback: string): void => {
    const appName = nonEmpty(gameInfo.app_name);
    if (appName === undefined) return;
    games.push({ runner: nonEmpty(gameInfo.runner) ?? runnerFallback, appName, gameInfo });
  };

  for (const gameInfo of sideload) add(gameInfo, "sideload");
  if (epic?.__timestamp?.library !== undefined) {
    for (const gameInfo of epic.library ?? []) add(gameInfo, "legendary");
  }
  if (gog?.__timestamp?.games !== undefined) {
    for (const gameInfo of gog.games ?? []) add(gameInfo, "gog");
  }
  if (amazon?.__timestamp?.library !== undefined) {
    for (const gameInfo of amazon.library ?? []) add(gameInfo, "nile");
  }
  return games;
}

/** `metadata.json` keys games by `<runner>:<appName>`, with Zoom stored under `sideload`. */
function metadataKey(runner: string, appName: string): string {
  return `${runner === "zoom" ? "sideload" : runner}:${appName}`;
}

/** The Steam app id the overlay, metadata or a `steam_<id>` app name declares. */
function steamAppIdOf(
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
 * Installed by Heronite's own flags, the GOG installed record or the cached Steam library's
 * id-only join — the same rule `assembleCollection` applies, without the Collection's filters.
 */
function isInstalled(
  root: string,
  runner: string,
  appName: string,
  gameInfo: GameInfo | undefined,
  local: LocalGameMeta | undefined,
  metadata: CollectionMetadata | undefined,
): boolean {
  if (gameInfo?.is_installed === true) return true;

  const paths = dataPaths(root);
  if (runner === "gog") {
    const records = readStore<GogInstalledFile>(paths.gogInstalled)?.installed ?? [];
    if (records.some((record) => nonEmpty(record.appName) === appName)) return true;
  }

  const steamAppId = steamAppIdOf(gameInfo, local, metadata);
  if (steamAppId === undefined) return false;

  const steam = readStore<SteamLibraryFile>(paths.steamLibrary);
  return [...(steam?.games ?? []), ...(steam?.family ?? [])].some(
    (row) => row.installed === true && nonEmpty(row.appId) === steamAppId,
  );
}

/** The live queue element for one `<runner>:<appName>`; `finished` history never counts. */
function queuedDownload(
  root: string,
  runner: string,
  appName: string,
): DownloadElement | undefined {
  const manager = readStore<DownloadManagerFile>(dataPaths(root).downloadManager);
  return (manager?.queue ?? []).find((element) => {
    const elementRunner =
      nonEmpty(element.params?.runner) ?? nonEmpty(element.params?.gameInfo?.runner);
    const elementApp =
      nonEmpty(element.params?.appName) ?? nonEmpty(element.params?.gameInfo?.app_name);
    return elementRunner === runner && elementApp === appName;
  });
}

function sessionsOf(sessions: readonly LocalGameSession[] | undefined): GameSessions | undefined {
  if (sessions === undefined) return undefined;

  let totalSeconds = 0;
  let lastStartedAt: string | undefined;
  for (const session of sessions) {
    const elapsed = session.elapsedSeconds;
    if (Predicate.isNumber(elapsed) && Number.isFinite(elapsed) && elapsed > 0) {
      totalSeconds += elapsed;
    }
    const startedAt = nonEmpty(session.startedAt);
    if (startedAt !== undefined && (lastStartedAt === undefined || startedAt > lastStartedAt)) {
      lastStartedAt = startedAt;
    }
  }

  return {
    count: sessions.length,
    totalSeconds,
    ...(lastStartedAt === undefined ? {} : { lastStartedAt }),
  };
}

/**
 * Resolves the overlay's `completionStatusId` through the user's statuses. An explicit id also
 * finds the nine built-in labels when the user's list omits them; a game with no status only
 * takes the list's `not-played` entry (or the defaults when the list is empty), never an invented
 * one.
 */
function resolveStatus(
  storedId: string | undefined,
  statuses: readonly CompletionStatus[],
): GameStatus | undefined {
  const wanted = nonEmpty(storedId);
  const list = statuses.length > 0 ? statuses : DEFAULT_STATUSES;

  const match =
    wanted === undefined
      ? list.find((status) => status.slug === "not-played" || status.id === "not-played")
      : (list.find((status) => status.id === wanted) ??
        DEFAULT_STATUSES.find((status) => status.id === wanted || status.slug === wanted));

  if (match === undefined) return undefined;
  const id = nonEmpty(match.id) ?? wanted;
  const name = nonEmpty(match.name) ?? id;
  return id === undefined || name === undefined ? undefined : { id, name };
}

function sourceLabel(source: string | undefined): string | undefined {
  const raw = nonEmpty(source);
  return raw === undefined ? undefined : (SOURCE_LABELS[raw] ?? raw);
}

/** Whole minutes as Heronite shows them: `2 h 32 m`, `2 h`, `32 m`. */
function durationLabel(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  if (hours === 0) return `${minutes} m`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} m`;
}

/** Dates are RFC 3339 in Heronite's files; the tab shows the day only. */
function datePart(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

/**
 * Everything the tab shows for one host library id, or `undefined` when the id is not this
 * plugin's or no Heronite file mentions the game.
 */
export function readStats(root: string, entryId: string): GameStats | undefined {
  if (!entryId.startsWith(`${PLUGIN_ID}:`)) return undefined;
  const parsed = parseEntryId(entryId.slice(PLUGIN_ID.length + 1));
  if (parsed === undefined) return undefined;

  const { runner, appName } = parsed;
  const paths = dataPaths(root);

  const cached = cachedGames(root).find(
    (game) => game.runner === runner && game.appName === appName,
  );
  const gameInfo = cached?.gameInfo;
  const local = readStore<LocalLibraryFile>(paths.localLibrary)?.games?.[appName];
  const metadata = readStore<MetadataFile>(paths.metadata)?.games?.[metadataKey(runner, appName)];
  const sessionList = readStore<SessionsFile>(paths.sessions)?.sessions?.[appName];
  const sessions = sessionsOf(sessionList);
  const timestamp = readStore<TimestampFile>(paths.timestamp)?.[appName];
  const download = queuedDownload(root, runner, appName);

  if (
    gameInfo === undefined &&
    local === undefined &&
    metadata === undefined &&
    sessions === undefined &&
    timestamp === undefined &&
    download === undefined
  ) {
    return undefined;
  }

  const statuses =
    readStore<StatusesFile>(paths.statuses)?.statuses?.filter(
      (status) => nonEmpty(status.id) !== undefined,
    ) ?? [];
  const playtime = timestamp?.totalPlayed;
  const playtimeMinutes =
    Predicate.isNumber(playtime) && Number.isFinite(playtime) && playtime > 0
      ? playtime
      : undefined;
  const title = nonEmpty(local?.title) ?? nonEmpty(metadata?.title) ?? nonEmpty(gameInfo?.title);
  const firstPlayed = nonEmpty(timestamp?.firstPlayed);
  const lastPlayed = nonEmpty(timestamp?.lastPlayed);
  const status = resolveStatus(local?.completionStatusId, statuses);
  const source = sourceLabel(local?.source);
  const install =
    download !== undefined
      ? "downloading"
      : isInstalled(root, runner, appName, gameInfo, local, metadata)
        ? "installed"
        : "missing";

  return {
    entryId,
    runner,
    appName,
    ...(title === undefined ? {} : { title }),
    ...(playtimeMinutes === undefined ? {} : { playtimeMinutes }),
    ...(firstPlayed === undefined ? {} : { firstPlayed }),
    ...(lastPlayed === undefined ? {} : { lastPlayed }),
    ...(sessions === undefined ? {} : { sessions }),
    ...(status === undefined ? {} : { status }),
    ...(source === undefined ? {} : { source }),
    install,
  };
}

/**
 * The tab's short lines: what Heronite knows about the game, in a fixed order. The console caps
 * these again, but the module keeps its own promise: at most 8 lines of at most 120 characters.
 */
export function statusLines(stats: GameStats): readonly StatusLine[] {
  const texts: string[] = [];
  if (stats.playtimeMinutes !== undefined) {
    texts.push(`Playtime: ${durationLabel(stats.playtimeMinutes)}`);
  }
  if (stats.sessions !== undefined) {
    const minutes = Math.floor(stats.sessions.totalSeconds / 60);
    texts.push(`Sessions: ${stats.sessions.count} (${durationLabel(minutes)})`);
  }
  if (stats.lastPlayed !== undefined) texts.push(`Last played: ${datePart(stats.lastPlayed)}`);
  if (stats.firstPlayed !== undefined) texts.push(`First played: ${datePart(stats.firstPlayed)}`);
  if (stats.status !== undefined) texts.push(`Status: ${stats.status.name}`);
  if (stats.source !== undefined) texts.push(`Source: ${stats.source}`);
  if (stats.install === "installed") texts.push("Installed");
  else if (stats.install === "downloading") texts.push("Downloading in Heronite");
  else texts.push("Not installed");

  return texts
    .slice(0, MAX_STATUS_LINES)
    .map((text) => ({ level: "info" as const, text: text.slice(0, MAX_STATUS_LINE_LENGTH) }));
}

/**
 * Splits a provider entry's external id, `<runner>:<appName>`, at its first colon (ADR-0004).
 * Both halves must be non-empty; an app name may contain further colons.
 */
export function parseEntryId(entryId: string): { runner: string; appName: string } | undefined {
  const separator = entryId.indexOf(":");
  if (separator <= 0 || separator === entryId.length - 1) return undefined;
  return { runner: entryId.slice(0, separator), appName: entryId.slice(separator + 1) };
}

export type { GameSessions, GameStats, GameStatus };
