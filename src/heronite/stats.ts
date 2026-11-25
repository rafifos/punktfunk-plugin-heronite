// The per-game tab's data: playtime, sessions, status, source and install state for one entry.
// Reads only — this module never writes to Heronite's files, and it never probes a game's files
// (ADR-0006); install state is Heronite's own.

import type { StatusLine } from "@punktfunk/plugin-kit";
import type { CompletionStatus, LocalGameSession } from "./model.js";

import { entryId, metadataKey, PLUGIN_ID, parseEntryId } from "./identity.js";
import { cachedGames, isInstalled, queueDownloads, readSources } from "./sources.js";
import { isNumber, nonEmpty } from "./text.js";

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
  /** Whether Heronite's files are on the host; a live download never changes that answer. */
  readonly install: "installed" | "missing";
  /** True while Heronite's queue holds a live download for the title. */
  readonly downloading: boolean;
}

/** A store cache only counts when its `__timestamp` wrapper is written too (Heronite's rule). */
function sessionsOf(sessions: readonly LocalGameSession[] | undefined): GameSessions | undefined {
  if (sessions === undefined) return undefined;

  let totalSeconds = 0;
  let lastStartedAt: string | undefined;
  for (const session of sessions) {
    const elapsed = session.elapsedSeconds;
    if (isNumber(elapsed) && Number.isFinite(elapsed) && elapsed > 0) {
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
export function readStats(root: string, id: string): GameStats | undefined {
  if (!id.startsWith(`${PLUGIN_ID}:`)) return undefined;
  const parsed = parseEntryId(id.slice(PLUGIN_ID.length + 1));
  if (parsed === undefined) return undefined;

  const { runner, appName } = parsed;
  const sources = readSources(root);

  const cached = cachedGames(sources).find(
    (game) => game.runner === runner && game.appName === appName,
  );
  const gameInfo = cached?.gameInfo;
  const local = sources.localLibrary[appName];
  const metadata = sources.metadata[metadataKey(runner, appName)];
  const sessionList = sources.sessions[appName];
  const sessions = sessionsOf(sessionList);
  const timestamp = sources.timestamps[appName];
  const download = queueDownloads(sources.downloads).get(entryId(runner, appName))?.element;

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

  const statuses = sources.statuses.filter((status) => nonEmpty(status.id) !== undefined);
  const playtime = timestamp?.totalPlayed;
  const playtimeMinutes =
    isNumber(playtime) && Number.isFinite(playtime) && playtime > 0 ? playtime : undefined;
  const title = nonEmpty(local?.title) ?? nonEmpty(metadata?.title) ?? nonEmpty(gameInfo?.title);
  const firstPlayed = nonEmpty(timestamp?.firstPlayed);
  const lastPlayed = nonEmpty(timestamp?.lastPlayed);
  const status = resolveStatus(local?.completionStatusId, statuses);
  const source = sourceLabel(local?.source);
  const install = isInstalled(sources, runner, appName, gameInfo, local, metadata)
    ? "installed"
    : "missing";

  return {
    entryId: id,
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
    downloading: download !== undefined,
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
  if (stats.downloading) texts.push("Downloading in Heronite");
  else texts.push(stats.install === "installed" ? "Installed" : "Not installed");

  return texts
    .slice(0, MAX_STATUS_LINES)
    .map((text) => ({ level: "info" as const, text: text.slice(0, MAX_STATUS_LINE_LENGTH) }));
}

export type { GameSessions, GameStats, GameStatus };
