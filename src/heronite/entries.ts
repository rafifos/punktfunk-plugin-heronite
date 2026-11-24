// One Collection game to one provider entry. The external id is Heronite's metadata key
// (ADR-0004); art is remote URLs only, because the host fetches what it lists.

import type { ArtKind } from "@punktfunk/plugin-kit/library";
import type {
  Artwork,
  DetectHint,
  EntryIds,
  Install,
  ProviderEntry,
} from "@punktfunk/plugin-kit/wire";
import type { Collection, CollectionGame } from "./library.js";

import { steamCdnUrl } from "@punktfunk/plugin-kit/library";

import { gameLaunch, type Transport } from "./launch.js";

const STORE_RUNNERS: ReadonlySet<string> = new Set(["legendary", "gog", "nile"]);

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** The first candidate that is an absolute http(s) URL; Heronite's `localart:`/`file:` are skipped. */
function httpUrl(...candidates: readonly (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const value = nonEmpty(candidate);
    if (value === undefined) continue;

    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") return value;
    } catch {
      // A relative value has no base to resolve against and is not art the host can fetch.
    }
  }
  return undefined;
}

function firstList(
  ...lists: readonly (readonly string[] | undefined)[]
): readonly string[] | undefined {
  for (const list of lists) {
    const values = (list ?? [])
      .map((value) => nonEmpty(value))
      .filter((value): value is string => value !== undefined);
    if (values.length > 0) return values;
  }
  return undefined;
}

function titleFor(game: CollectionGame): string {
  return (
    nonEmpty(game.local?.title) ??
    nonEmpty(game.metadata?.title) ??
    nonEmpty(game.gameInfo.title) ??
    nonEmpty(game.title) ??
    game.appName
  );
}

function platformFor(game: CollectionGame): string {
  if (game.local?.launchKind !== "emulator") return "PC";
  return nonEmpty(game.emulator?.profile.platformName) ?? "PC";
}

function releaseYear(value: string | undefined): number | undefined {
  const match = /^(\d{4})/.exec(value ?? "");
  if (match === null) return undefined;
  const year = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(year) ? year : undefined;
}

function steamAppIdNumber(game: CollectionGame): number | undefined {
  const raw = game.steamAppId;
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const appId = Number.parseInt(raw, 10);
  return Number.isSafeInteger(appId) ? appId : undefined;
}

function steamCdnArt(game: CollectionGame, kind: ArtKind): string | undefined {
  const appId = steamAppIdNumber(game);
  return appId === undefined ? undefined : steamCdnUrl(appId, kind);
}

function artwork(game: CollectionGame): Artwork | undefined {
  const { art: custom, metadata, gameInfo } = game;

  const portrait = httpUrl(
    custom?.coverUrl,
    metadata?.coverUrl,
    metadata?.coverSquareUrl,
    gameInfo.art_square,
    gameInfo.art_cover,
    gameInfo.art_background,
    steamCdnArt(game, "portrait"),
  );
  const hero = httpUrl(
    custom?.heroUrl,
    metadata?.heroUrl,
    metadata?.coverWideUrl,
    gameInfo.art_cover,
    gameInfo.art_background,
    steamCdnArt(game, "hero"),
  );
  const logo = httpUrl(
    custom?.logoUrl,
    metadata?.logoUrl,
    gameInfo.art_logo,
    steamCdnArt(game, "logo"),
  );
  const header = httpUrl(
    custom?.coverWideUrl,
    metadata?.coverWideUrl,
    gameInfo.art_cover,
    gameInfo.art_background,
    steamCdnArt(game, "header"),
  );

  const art: Artwork = {
    ...(portrait === undefined ? {} : { portrait }),
    ...(hero === undefined ? {} : { hero }),
    ...(logo === undefined ? {} : { logo }),
    ...(header === undefined ? {} : { header }),
  };

  return Object.keys(art).length === 0 ? undefined : art;
}

function catalogIds(game: CollectionGame): EntryIds | undefined {
  const ids: Record<string, string> = {};
  if (game.steamAppId !== undefined) ids.steam = game.steamAppId;
  if (game.runner === "gog") ids.gog = game.appName;
  if (game.runner === "legendary") ids.epic = game.appName;

  return Object.keys(ids).length === 0 ? undefined : ids;
}

function separatorIndex(value: string): number {
  return Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
}

function basenameOf(executable: string): string | undefined {
  const separator = separatorIndex(executable);
  return nonEmpty(separator === -1 ? executable : executable.slice(separator + 1));
}

function directoryOf(executable: string | undefined): string | undefined {
  if (executable === undefined) return undefined;
  const separator = separatorIndex(executable);
  if (separator <= 0) return undefined;
  return nonEmpty(executable.slice(0, separator));
}

/** Heronite stamps HEROIC_APP_NAME on every launch except emulator and Steam URI launches. */
function stampsAppName(game: CollectionGame): boolean {
  const launchKind = game.local?.launchKind;
  if (launchKind === "emulator" || launchKind === "steam-uri") return false;
  if (
    launchKind === "executable" ||
    launchKind === "launcher" ||
    launchKind === "client" ||
    launchKind === "xbox"
  ) {
    return true;
  }
  return STORE_RUNNERS.has(game.runner);
}

function sharesSteamProcess(game: CollectionGame): boolean {
  return (
    game.local?.launchKind === "steam-uri" ||
    game.appName.startsWith("steam_") ||
    game.steamInstalled
  );
}

interface MutableDetect {
  install_dir?: string;
  exe?: string;
  process_name?: string;
  steam_appid?: number;
  env_marker?: { key: string; value: string };
}

function detectHints(game: CollectionGame): DetectHint | undefined {
  const exe =
    nonEmpty(game.gameInfo.install?.executable) ??
    nonEmpty(game.local?.remappedExecutable) ??
    nonEmpty(game.local?.windowsExecutable);

  const installDir =
    nonEmpty(game.gameInfo.install?.install_path) ??
    nonEmpty(game.local?.windowsInstallDirectory) ??
    directoryOf(exe);

  const detect: MutableDetect = {};
  if (installDir !== undefined) detect.install_dir = installDir;
  if (exe !== undefined) {
    detect.exe = exe;
    const processName = basenameOf(exe);
    if (processName !== undefined) detect.process_name = processName;
  }
  if (sharesSteamProcess(game)) {
    const appId = steamAppIdNumber(game);
    if (appId !== undefined) detect.steam_appid = appId;
  }
  if (stampsAppName(game)) detect.env_marker = { key: "HEROIC_APP_NAME", value: game.appName };

  return Object.keys(detect).length === 0 ? undefined : detect;
}

function installState(game: CollectionGame): Install | undefined {
  if (game.installed || game.downloading === undefined) return undefined;
  return game.sizeBytes === undefined
    ? { state: "missing" }
    : { state: "missing", size_bytes: game.sizeBytes };
}

/**
 * Maps one Collection game. `undefined` when even the chosen launch transport cannot build a spec:
 * a protocol fallback URL over the host's 128-character parameter cap.
 */
export function toEntry(game: CollectionGame, transport: Transport): ProviderEntry | undefined {
  const launch = gameLaunch(transport, game.runner, game.appName);
  if (launch === undefined) return undefined;

  const description =
    nonEmpty(game.metadata?.description) ??
    nonEmpty(game.gameInfo.description) ??
    nonEmpty(game.gameInfo.extra?.about?.description);
  const developer = nonEmpty(game.metadata?.developers?.[0]) ?? nonEmpty(game.gameInfo.developer);
  const publisher = nonEmpty(game.metadata?.publishers?.[0]);
  const year =
    releaseYear(game.metadata?.releaseDate) ?? releaseYear(game.gameInfo.extra?.releaseDate);
  const genres = firstList(game.metadata?.genres, game.gameInfo.extra?.genres);
  const art = artwork(game);
  const ids = catalogIds(game);
  const detect = detectHints(game);
  const install = installState(game);

  return {
    external_id: game.key,
    title: titleFor(game),
    platform: platformFor(game),
    ...(description === undefined ? {} : { description }),
    ...(developer === undefined ? {} : { developer }),
    ...(publisher === undefined ? {} : { publisher }),
    ...(year === undefined ? {} : { release_year: year }),
    ...(genres === undefined ? {} : { genres }),
    ...(art === undefined ? {} : { art }),
    ...(ids === undefined ? {} : { ids }),
    launch,
    ...(detect === undefined ? {} : { detect }),
    ...(install === undefined ? {} : { install }),
  };
}

/** Every Collection game that maps to a publishable entry, preserving the Collection's order. */
export function buildEntries(
  collection: Collection,
  transport: Transport,
): readonly ProviderEntry[] {
  const entries: ProviderEntry[] = [];
  for (const game of collection.games) {
    const entry = toEntry(game, transport);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}
