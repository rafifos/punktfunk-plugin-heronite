// The on-disk documents this plugin reads, as schemas. Decoding replaces the unchecked
// `JSON.parse(...) as T` casts that used to stand here: a document whose shape changed is now
// refused by `readJson` instead of silently producing `undefined` fields deep in the readers.
//
// Every field is optional because Heronite omits defaults instead of writing `null`. Extra keys are
// kept out of the decoded value (Effect's default) and never read anyway. Where the model says a
// field is `unknown` or an open record, the schema says so too: validating data the plugin never
// consumes would only turn a harmless extra key into a lost library.

import { Effect, Option, Schema } from "effect";

/**
 * A field whose value may be anything. The readers of the plugin already ignore a value of the
 * wrong type, for example a size written as a number or a title written as an object, so a schema
 * must not be stricter than they are. One odd field must never cost the whole document. Structure
 * is still checked: containers (arrays, records and the document itself) must have the right
 * shape.
 */
const lax = <A>(self: Schema.Schema<A>): Schema.Schema<A | undefined> =>
  Schema.catchDecoding<Schema.Schema<A | undefined>>(() => Effect.succeed(Option.some(undefined)))(
    Schema.UndefinedOr(self),
  );

/** An optional, individually tolerant field. */
const opt = <A>(self: Schema.Schema<A>) => Schema.optionalKey(lax(self));

const text = opt(Schema.String);
const flag = opt(Schema.Boolean);
const count = opt(Schema.Number);
const texts = opt(Schema.Array(Schema.String));

/** An open object: Heronite preserves keys this plugin does not model. */
const openRecord = Schema.Record(Schema.String, Schema.Unknown);

const GameInstall = Schema.Struct({
  executable: text,
  platform: text,
  is_dlc: flag,
  install_path: text,
  install_size: text,
  version: text,
});

const GameExtra = Schema.Struct({
  about: opt(
    Schema.Struct({
      description: text,
      shortDescription: text,
      reqs: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    }),
  ),
  genres: texts,
  releaseDate: text,
  screenshots: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

const GameInfo = Schema.Struct({
  runner: text,
  app_name: text,
  title: text,
  art_cover: text,
  art_square: text,
  art_background: text,
  art_logo: text,
  art_icon: text,
  developer: text,
  description: text,
  is_installed: flag,
  install: opt(GameInstall),
  folder_name: text,
  is_linux_native: flag,
  is_mac_native: flag,
  extra: opt(GameExtra),
  canRunOffline: flag,
  browserUrl: text,
  customUserAgent: text,
  launchFullScreen: flag,
  cloud_save_enabled: flag,
  thirdPartyManagedApp: text,
  heroniteCommand: text,
  heroniteWorkingDir: text,
  isEAManaged: flag,
  isUbisoftManaged: flag,
  save_folder: text,
  save_path: text,
  namespace: text,
  store_url: text,
  dlcList: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

const SteamShare = Schema.Struct({
  ownerId: text,
  ownerName: text,
  inUse: flag,
});

const SteamGame = Schema.Struct({
  appId: text,
  name: text,
  installed: flag,
  playtimeMinutes: count,
  lastPlayed: count,
  share: opt(SteamShare),
  hidden: flag,
});

const GameRef = Schema.Struct({ appName: text, title: text });

const GogInstalledGame = Schema.Struct({
  appName: text,
  platform: text,
  install_path: text,
  install_size: text,
  version: text,
  language: text,
  installedDLCs: texts,
  versionEtag: text,
  buildId: text,
  pinnedVersion: flag,
  executable: text,
  is_dlc: flag,
  galaxy: flag,
});

const LocalRom = Schema.Struct({ name: text, path: text });

const LaunchKind = opt(
  Schema.Literals([
    "steam-uri",
    "executable",
    "emulator",
    "launcher",
    "client",
    "xbox",
    "unavailable",
    "",
  ]),
);

const LocalGameMeta = Schema.Struct({
  appName: text,
  runner: text,
  playniteId: text,
  pluginId: text,
  source: text,
  launchKind: LaunchKind,
  steamAppId: text,
  storeGameId: text,
  title: text,
  windowsInstallDirectory: text,
  windowsExecutable: text,
  remappedExecutable: text,
  heroniteCommand: text,
  launcherArgs: text,
  roms: Schema.optionalKey(Schema.Array(LocalRom)),
  emulatorName: text,
  emulatorId: text,
  emulatorProfileId: text,
  platformId: text,
  selectedRomPath: text,
  saveStateKeys: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  runAs: text,
  notes: text,
  completionStatusId: text,
  playniteCompletionStatusId: text,
  heroniteSteamAuto: flag,
  heroniteSteamFamily: flag,
  heroniteLauncherPrefix: text,
  heroniteLauncherRunsFrom: text,
  xboxTitleId: text,
  xboxStoreId: text,
  xboxMinutes: count,
  xboxLastPlayed: text,
  xboxAchievements: Schema.optionalKey(Schema.Unknown),
  xboxPlaytimeEdit: Schema.optionalKey(Schema.Unknown),
  heroniteXboxPackage: text,
});

const AgeRating = Schema.Struct({ system: text, rating: text, descriptors: texts });

const CollectionMetadata = Schema.Struct({
  appName: text,
  runner: text,
  igdbId: count,
  igdbSlug: text,
  lutrisSlug: text,
  steamAppId: text,
  title: text,
  sortName: text,
  description: text,
  releaseDate: text,
  developers: texts,
  publishers: texts,
  genres: texts,
  themes: texts,
  gameModes: texts,
  platforms: texts,
  features: texts,
  websites: texts,
  series: text,
  criticScore: count,
  ageRatings: Schema.optionalKey(Schema.Array(AgeRating)),
  notes: text,
  coverUrl: text,
  heroUrl: text,
  coverSquareUrl: text,
  coverWideUrl: text,
  logoUrl: text,
  headerUrl: text,
  fieldSources: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  fetchedAt: text,
  fetchError: text,
});

const CollectionArt = Schema.Struct({
  coverUrl: text,
  heroUrl: text,
  coverSquareUrl: text,
  coverWideUrl: text,
  logoUrl: text,
});

const EmulatorProfile = Schema.Struct({
  id: text,
  definitionProfileId: text,
  name: text,
  platformId: text,
  platformName: text,
  arguments: text,
  extensions: texts,
  corePath: text,
  folderIndicator: text,
  playlistExtensions: texts,
  workingDir: text,
});

const UserEmulator = Schema.Struct({
  id: text,
  definitionId: text,
  name: text,
  executable: text,
  installDir: text,
  launchKind: opt(Schema.Literals(["native", "flatpak", "wine"])),
  flatpakId: text,
  playniteId: text,
  ludusaviEntry: text,
  profiles: Schema.optionalKey(Schema.Array(EmulatorProfile)),
});

const LocalGameSession = Schema.Struct({
  startedAt: text,
  endedAt: text,
  elapsedSeconds: count,
  source: text,
  gameActionName: text,
});

const CompletionStatus = Schema.Struct({
  id: text,
  name: text,
  slug: text,
  sortOrder: count,
  playniteId: text,
  playniteIds: texts,
});

const GameTimestamp = Schema.Struct({
  firstPlayed: text,
  lastPlayed: text,
  totalPlayed: count,
});

const DownloadParams = Schema.Struct({
  appName: text,
  path: text,
  installDlcs: texts,
  sdlList: texts,
  installLanguage: text,
  runner: text,
  platformToInstall: text,
  gameInfo: opt(GameInfo),
  size: text,
  ignoreFreeSpace: flag,
});

const DownloadElement = Schema.Struct({
  params: opt(DownloadParams),
  type: opt(Schema.Literals(["install", "update"])),
  addToQueueTime: count,
  startTime: count,
  endTime: count,
  status: opt(Schema.Literals(["done", "error", "abort", "paused"])),
  error: text,
});

/** The `__timestamp` wrapper each store cache carries once Heronite has written it. */
const cacheStamp = (key: string) =>
  Schema.Struct({ [key]: text } as { readonly [K in typeof key]: typeof text });

/** `sideload_apps/library.json`. */
export const SideloadLibrary = Schema.Struct({
  games: Schema.optionalKey(Schema.Array(GameInfo)),
});

/** `store_cache/legendary_library.json`. */
export const EpicLibrary = Schema.Struct({
  library: Schema.optionalKey(Schema.Array(GameInfo)),
  __timestamp: opt(cacheStamp("library")),
});

/** `store_cache/gog_library.json`. */
export const GogLibrary = Schema.Struct({
  games: Schema.optionalKey(Schema.Array(GameInfo)),
  __timestamp: opt(cacheStamp("games")),
});

/** `store_cache/nile_library.json`. */
export const AmazonLibrary = Schema.Struct({
  library: Schema.optionalKey(Schema.Array(GameInfo)),
  __timestamp: opt(cacheStamp("library")),
});

/** `gog_store/installed.json`. */
export const GogInstalled = Schema.Struct({
  installed: Schema.optionalKey(Schema.Array(GogInstalledGame)),
});

/** `store_cache/steam_library.json`, the id-only join. */
export const SteamLibrary = Schema.Struct({
  games: Schema.optionalKey(Schema.Array(SteamGame)),
  family: Schema.optionalKey(Schema.Array(SteamGame)),
  updatedAt: text,
  source: text,
});

/** `store/config.json`. */
export const StoreConfig = Schema.Struct({
  language: text,
  theme: text,
  allTilesInColor: flag,
  games: opt(
    Schema.Struct({
      recent: Schema.optionalKey(Schema.Array(GameRef)),
      hidden: Schema.optionalKey(Schema.Array(GameRef)),
      favourites: Schema.optionalKey(Schema.Array(GameRef)),
    }),
  ),
  settings: opt(
    Schema.Struct({
      winePrefix: text,
      experimentalFeatures: opt(Schema.Struct({ zoomPlatform: flag })),
    }),
  ),
});

/** `local_library/library.json`. */
export const LocalLibrary = Schema.Struct({
  games: Schema.optionalKey(Schema.Record(Schema.String, LocalGameMeta)),
});

/** `local_library/metadata.json`. */
export const Metadata = Schema.Struct({
  games: Schema.optionalKey(Schema.Record(Schema.String, CollectionMetadata)),
});

/** `local_library/art.json`. */
export const Art = Schema.Struct({
  games: Schema.optionalKey(Schema.Record(Schema.String, CollectionArt)),
});

/** `local_library/emulators.json`. */
export const Emulators = Schema.Struct({
  emulators: Schema.optionalKey(Schema.Array(UserEmulator)),
});

/** `local_library/copies.json`. */
export const Copies = Schema.Struct({
  links: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
  apart: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
  preferred: texts,
});

/** `local_library/sessions.json`. */
export const Sessions = Schema.Struct({
  sessions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(LocalGameSession))),
});

/** `local_library/statuses.json`. */
export const Statuses = Schema.Struct({
  statuses: Schema.optionalKey(Schema.Array(CompletionStatus)),
  lastPlayniteLibraryPath: text,
  lastPlayniteDriveMap: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/** `store/timestamp.json`: playtime per app name. */
export const Timestamp = Schema.Record(Schema.String, GameTimestamp);

/** `store/download-manager.json`. */
export const DownloadManager = Schema.Struct({
  queue: Schema.optionalKey(Schema.Array(DownloadElement)),
  finished: Schema.optionalKey(Schema.Array(DownloadElement)),
  userPaused: flag,
});

export { openRecord };
