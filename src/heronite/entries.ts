// One Collection game to one provider entry. The external id is Heronite's metadata key
// (ADR-0004); art is whatever the host's proxy can serve — an http(s) URL it fetches, or a local
// path inside one of its art roots, which is where Heronite's own `localart://` store lives.

import type { ArtKind } from "@punktfunk/plugin-kit/library";
import type {
  Artwork,
  DetectHint,
  EntryIds,
  Install,
  ProviderEntry,
} from "@punktfunk/plugin-kit/wire";
import type { Collection, CollectionGame } from "./library.js";

import path from "node:path";

import { STORE_RUNNERS } from "./identity.js";
import { gameLaunch, type Transport } from "./launch.js";
import { nonEmpty } from "./text.js";

/**
 * The kit's Steam CDN URLs, rebuilt here because `heronite/*` is pure (docs/port-plan.md): only
 * `import type` from the kit is allowed, so the layer pulls in no package runtime.
 */
function steamCdnUrl(appId: number, kind: ArtKind): string | undefined {
  // A non-Steam shortcut's app id has the high bit set and never resolves on the CDN.
  if ((appId & 0x8000_0000) !== 0) return undefined;

  const file =
    kind === "portrait"
      ? "library_600x900.jpg"
      : kind === "hero"
        ? "library_hero.jpg"
        : kind === "logo"
          ? "logo.png"
          : "header.jpg";
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${file}`;
}

/**
 * The first candidate the host can actually serve, or `undefined` when none can.
 *
 * The host's art proxy reads a **local path inside an allowed art root** as readily as it fetches a
 * URL (`art.rs`: "reads a local path from an allowed root"), which is what Heronite's own store is:
 * `localart://<relative>` points at `<data root>/local_library/<relative>`, under the user's home and
 * therefore inside the root the proxy allows. Only rasters are served, and Heronite writes `jpg`,
 * `png` and `webp`, so those pass.
 *
 * Earlier revisions skipped this and fell through to a guessed Steam CDN filename — which is why
 * tiles whose art Heronite holds locally showed nothing: measured against the CDN,
 * `library_600x900.jpg` and `logo.png` answer 404 for a typical app id while `library_hero.jpg`
 * answers 200.
 */
function artValue(
  artRoot: string | undefined,
  ...candidates: readonly (string | undefined)[]
): string | undefined {
  for (const candidate of candidates) {
    const value = nonEmpty(candidate);
    if (value === undefined) continue;

    if (value.startsWith("http://") || value.startsWith("https://")) return value;
    if (artRoot === undefined) continue;

    // `file://` is already an absolute path the proxy accepts, once decoded.
    if (value.startsWith("file://")) {
      try {
        return decodeURIComponent(value.slice("file://".length));
      } catch {
        continue;
      }
    }

    if (!value.startsWith("localart://")) continue;
    const relative = value.slice("localart://".length);
    // A URI Heronite wrote is relative to `local_library`; anything reaching outside it is refused
    // by the proxy anyway, and travelling up is never a path this layer should build.
    if (relative === "" || relative.split(/[/\\]/).includes("..")) continue;

    return path.join(artRoot, "local_library", relative);
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

function artwork(game: CollectionGame, artRoot: string | undefined): Artwork | undefined {
  const { art: custom, metadata, gameInfo } = game;
  const portrait = artValue(
    artRoot,
    custom?.coverUrl,
    metadata?.coverUrl,
    metadata?.coverSquareUrl,
    gameInfo.art_square,
    gameInfo.art_cover,
    gameInfo.art_background,
    steamCdnArt(game, "portrait"),
  );
  const hero = artValue(
    artRoot,
    custom?.heroUrl,
    metadata?.heroUrl,
    metadata?.coverWideUrl,
    gameInfo.art_cover,
    gameInfo.art_background,
    steamCdnArt(game, "hero"),
  );
  const logo = artValue(
    artRoot,
    custom?.logoUrl,
    metadata?.logoUrl,
    gameInfo.art_logo,
    steamCdnArt(game, "logo"),
  );
  const header = artValue(
    artRoot,
    custom?.coverWideUrl,
    metadata?.coverWideUrl,
    metadata?.headerUrl,
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

/**
 * The Steam identity a runner records: a sideload Steam entry, or a store game whose launch kind
 * resolves to Steam. A store game's metadata `steamAppId` is recognition and art, not identity.
 */
function steamIdentity(game: CollectionGame): string | undefined {
  const steamLaunch = game.local?.launchKind === "steam-uri";
  const steamEntry = game.runner === "sideload" && game.appName.startsWith("steam_");
  return steamLaunch || steamEntry ? game.steamAppId : undefined;
}

function catalogIds(game: CollectionGame): EntryIds | undefined {
  const ids: Record<string, string> = {};
  const steam = steamIdentity(game);
  if (steam !== undefined) ids.steam = steam;
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
export function toEntry(
  game: CollectionGame,
  transport: Transport,
  artRoot?: string,
): ProviderEntry | undefined {
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
  const art = artwork(game, artRoot);
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
  artRoot?: string,
): readonly ProviderEntry[] {
  const entries: ProviderEntry[] = [];
  for (const game of collection.games) {
    const entry = toEntry(game, transport, artRoot);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}
