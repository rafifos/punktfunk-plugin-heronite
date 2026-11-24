// TypeScript shapes of the JSON files Heronite writes, in Heronite's own key casing. Fields are
// optional because Heronite omits defaults instead of writing `null`; readers ignore keys the
// model does not list, and Heronite preserves unknown keys on its side. There is no validation
// here: `readJson` has already refused a malformed file.

/** One game record. Snake_case: store caches, `sideload_apps/library.json`, download snapshots. */
export interface GameInfo {
  readonly runner?: string;
  readonly app_name?: string;
  readonly title?: string;
  readonly art_cover?: string;
  readonly art_square?: string;
  readonly art_background?: string;
  readonly art_logo?: string;
  readonly art_icon?: string;
  readonly developer?: string;
  readonly description?: string;
  readonly is_installed?: boolean;
  readonly install?: GameInstall;
  readonly folder_name?: string;
  readonly is_linux_native?: boolean;
  readonly is_mac_native?: boolean;
  readonly extra?: GameExtra;
  readonly canRunOffline?: boolean;
  readonly browserUrl?: string;
  readonly customUserAgent?: string;
  readonly launchFullScreen?: boolean;
  readonly cloud_save_enabled?: boolean;
  readonly thirdPartyManagedApp?: string;
  readonly heroniteCommand?: string;
  readonly heroniteWorkingDir?: string;
  readonly isEAManaged?: boolean;
  readonly isUbisoftManaged?: boolean;
  readonly save_folder?: string;
  readonly save_path?: string;
  readonly namespace?: string;
  readonly store_url?: string;
  readonly dlcList?: readonly unknown[];
}

/** The `install` block of a game record. */
export interface GameInstall {
  readonly executable?: string;
  readonly platform?: string;
  readonly is_dlc?: boolean;
  readonly install_path?: string;
  /** Display text such as `"25.87 GiB"`, not a byte count. */
  readonly install_size?: string;
  readonly version?: string;
}

/** Store-specific data Heronite keeps under `extra`. */
export interface GameExtra {
  readonly about?: GameAbout;
  readonly genres?: readonly string[];
  readonly releaseDate?: string;
  readonly screenshots?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface GameAbout {
  readonly description?: string;
  readonly shortDescription?: string;
  readonly reqs?: readonly unknown[];
}

/** `sideload_apps/library.json`: every entry Heronite added itself, `runner` always `sideload`. */
export interface SideloadLibraryFile {
  readonly games?: readonly GameInfo[];
}

/** `store_cache/legendary_library.json`: Epic's cache, wrapper key `library`. */
export interface EpicLibraryFile {
  readonly library?: readonly GameInfo[];
  readonly __timestamp?: {
    readonly library?: string;
  };
}

/** `store_cache/gog_library.json`: GOG's cache, wrapper key `games`. */
export interface GogLibraryFile {
  readonly games?: readonly GameInfo[];
  readonly __timestamp?: {
    readonly games?: string;
  };
}

/** `store_cache/nile_library.json`: Amazon's cache, wrapper key `library`. */
export interface AmazonLibraryFile {
  readonly library?: readonly GameInfo[];
  readonly __timestamp?: {
    readonly library?: string;
  };
}

/** `gog_store/installed.json`: GOG's install paths, merged into the store cache at load. */
export interface GogInstalledFile {
  readonly installed?: readonly GogInstalledGame[];
}

export interface GogInstalledGame {
  readonly appName?: string;
  readonly platform?: string;
  readonly install_path?: string;
  readonly install_size?: string;
  readonly version?: string;
  readonly language?: string;
  readonly installedDLCs?: readonly string[];
  readonly versionEtag?: string;
  readonly buildId?: string;
  readonly pinnedVersion?: boolean;
  readonly executable?: string;
  readonly is_dlc?: boolean;
  readonly galaxy?: boolean;
}

/** `store_cache/steam_library.json`: the partial Steam library used for the id-only join. */
export interface SteamLibraryFile {
  readonly games?: readonly SteamGame[];
  /** Family-shared games, kept apart from owned ones. */
  readonly family?: readonly SteamGame[];
  readonly updatedAt?: string;
  readonly source?: string;
}

export interface SteamGame {
  /** A string, not a number. */
  readonly appId?: string;
  readonly name?: string;
  readonly installed?: boolean;
  /** Steam's total for the account, in minutes. */
  readonly playtimeMinutes?: number;
  /** Unix seconds. */
  readonly lastPlayed?: number;
  readonly share?: SteamShare;
  readonly hidden?: boolean;
}

export interface SteamShare {
  readonly ownerId?: string;
  readonly ownerName?: string;
  readonly inUse?: boolean;
}

/** `store/config.json`: Heroic's electron-store config; hidden and favourites use app names. */
export interface StoreConfigFile {
  readonly language?: string;
  readonly theme?: string;
  readonly allTilesInColor?: boolean;
  readonly games?: StoreConfigGames;
  readonly settings?: StoreSettings;
}

export interface StoreConfigGames {
  /** Most recent first. */
  readonly recent?: readonly GameRef[];
  readonly hidden?: readonly GameRef[];
  readonly favourites?: readonly GameRef[];
}

export interface GameRef {
  readonly appName?: string;
  readonly title?: string;
}

export interface StoreSettings {
  readonly winePrefix?: string;
  readonly experimentalFeatures?: StoreExperimentalFeatures;
  readonly [key: string]: unknown;
}

export interface StoreExperimentalFeatures {
  readonly zoomPlatform?: boolean;
  readonly [key: string]: unknown;
}

/** `local_library/library.json`: the launch overlay, a map keyed by app name only. */
export interface LocalLibraryFile {
  readonly games?: Record<string, LocalGameMeta>;
}

export type LaunchKind =
  | "steam-uri"
  | "executable"
  | "emulator"
  | "launcher"
  | "client"
  | "xbox"
  | "unavailable"
  | "";

export interface LocalGameMeta {
  readonly appName?: string;
  readonly runner?: string;
  readonly playniteId?: string;
  readonly pluginId?: string;
  readonly source?: string;
  readonly launchKind?: LaunchKind;
  /** A string, not a number. */
  readonly steamAppId?: string;
  readonly storeGameId?: string;
  readonly title?: string;
  readonly windowsInstallDirectory?: string;
  readonly windowsExecutable?: string;
  readonly remappedExecutable?: string;
  readonly launcherArgs?: string;
  readonly roms?: readonly LocalRom[];
  readonly emulatorName?: string;
  readonly emulatorId?: string;
  readonly emulatorProfileId?: string;
  readonly platformId?: string;
  readonly selectedRomPath?: string;
  readonly saveStateKeys?: Record<string, string>;
  readonly runAs?: string;
  readonly notes?: string;
  readonly completionStatusId?: string;
  readonly playniteCompletionStatusId?: string;
  readonly heroniteSteamAuto?: boolean;
  readonly heroniteSteamFamily?: boolean;
  readonly heroniteLauncherPrefix?: string;
  readonly heroniteLauncherRunsFrom?: string;
  readonly xboxTitleId?: string;
  readonly xboxStoreId?: string;
  readonly xboxMinutes?: number;
  readonly xboxLastPlayed?: string;
  readonly xboxAchievements?: unknown;
  readonly xboxPlaytimeEdit?: unknown;
  readonly heroniteXboxPackage?: string;
}

export interface LocalRom {
  readonly name?: string;
  readonly path?: string;
}

/** `local_library/metadata.json`: fetched catalogue details, keyed by `<runner>:<appName>`. */
export interface MetadataFile {
  readonly games?: Record<string, CollectionMetadata>;
}

export interface CollectionMetadata {
  readonly appName?: string;
  readonly runner?: string;
  readonly igdbId?: number;
  readonly igdbSlug?: string;
  readonly lutrisSlug?: string;
  /** A string, not a number. */
  readonly steamAppId?: string;
  readonly title?: string;
  readonly sortName?: string;
  readonly description?: string;
  readonly releaseDate?: string;
  readonly developers?: readonly string[];
  readonly publishers?: readonly string[];
  readonly genres?: readonly string[];
  readonly themes?: readonly string[];
  readonly gameModes?: readonly string[];
  readonly platforms?: readonly string[];
  readonly features?: readonly string[];
  readonly websites?: readonly string[];
  readonly series?: string;
  readonly criticScore?: number;
  readonly ageRatings?: readonly AgeRating[];
  readonly notes?: string;
  readonly coverUrl?: string;
  readonly heroUrl?: string;
  readonly coverSquareUrl?: string;
  readonly coverWideUrl?: string;
  readonly logoUrl?: string;
  readonly fieldSources?: Record<string, string>;
  readonly fetchedAt?: string;
  readonly fetchError?: string;
}

export interface AgeRating {
  readonly system?: string;
  readonly rating?: string;
  readonly descriptors?: readonly string[];
}

/** `local_library/art.json`: art set by hand, keyed by `<runner>:<appName>` without the zoom remap. */
export interface ArtFile {
  readonly games?: Record<string, CollectionArt>;
}

export interface CollectionArt {
  readonly coverUrl?: string;
  readonly heroUrl?: string;
  readonly coverSquareUrl?: string;
  readonly coverWideUrl?: string;
  readonly logoUrl?: string;
}

/** `local_library/emulators.json`: emulator setups and their platform profiles. */
export interface EmulatorsFile {
  readonly emulators?: readonly UserEmulator[];
}

export interface UserEmulator {
  readonly id?: string;
  readonly definitionId?: string;
  readonly name?: string;
  readonly executable?: string;
  readonly installDir?: string;
  readonly launchKind?: EmulatorLaunchKind;
  readonly flatpakId?: string;
  readonly playniteId?: string;
  readonly ludusaviEntry?: string;
  readonly profiles?: readonly EmulatorProfile[];
}

/** Different namespace from {@link LaunchKind}: how the emulator program itself runs. */
export type EmulatorLaunchKind = "native" | "flatpak" | "wine";

export interface EmulatorProfile {
  readonly id?: string;
  readonly definitionProfileId?: string;
  readonly name?: string;
  readonly platformId?: string;
  /** Display name, e.g. `"PlayStation 2"`. */
  readonly platformName?: string;
  /** Template with `{rom}`, `{file}` and friends. */
  readonly arguments?: string;
  /** Extensions without the dot. */
  readonly extensions?: readonly string[];
  readonly corePath?: string;
  readonly folderIndicator?: string;
  readonly playlistExtensions?: readonly string[];
  readonly workingDir?: string;
}

/** `local_library/copies.json`: copy groups, keyed by Collection keys (`runner_appName`). */
export interface CopiesFile {
  readonly links?: readonly (readonly string[])[];
  readonly apart?: readonly (readonly string[])[];
  readonly preferred?: readonly string[];
}

/** `local_library/sessions.json`: sessions per app name, newest first. */
export interface SessionsFile {
  readonly sessions?: Record<string, readonly LocalGameSession[]>;
}

export interface LocalGameSession {
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** Seconds. */
  readonly elapsedSeconds?: number;
  readonly source?: string;
  readonly gameActionName?: string;
}

/** `local_library/statuses.json`: completion statuses; an empty list means Heronite's defaults. */
export interface StatusesFile {
  readonly statuses?: readonly CompletionStatus[];
  readonly lastPlayniteLibraryPath?: string;
  readonly lastPlayniteDriveMap?: Record<string, string>;
}

export interface CompletionStatus {
  readonly id?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly sortOrder?: number;
  readonly playniteId?: string;
  readonly playniteIds?: readonly string[];
}

/** `store/timestamp.json`: playtime per app name, in minutes, with ISO dates. */
export type TimestampFile = Record<string, GameTimestamp>;

export interface GameTimestamp {
  readonly firstPlayed?: string;
  readonly lastPlayed?: string;
  /** Minutes, floored by Heronite. */
  readonly totalPlayed?: number;
}

/** `store/download-manager.json`: the queue and its history, not live progress. */
export interface DownloadManagerFile {
  /** FIFO; the first element is the one that runs. */
  readonly queue?: readonly DownloadElement[];
  readonly finished?: readonly DownloadElement[];
  /** Present only while the user holds the queue paused. */
  readonly userPaused?: boolean;
}

export interface DownloadElement {
  readonly params?: DownloadParams;
  readonly type?: DownloadType;
  /** Unix milliseconds. */
  readonly addToQueueTime?: number;
  /** Unix milliseconds; `0` until the worker starts it. */
  readonly startTime?: number;
  /** Unix milliseconds; `0` until it ends. */
  readonly endTime?: number;
  /** Absent while queued, running or paused. */
  readonly status?: DownloadStatus;
  readonly error?: string;
}

export type DownloadType = "install" | "update";

export type DownloadStatus = "done" | "error" | "abort" | "paused";

export interface DownloadParams {
  readonly appName?: string;
  readonly path?: string;
  readonly installDlcs?: readonly string[];
  readonly sdlList?: readonly string[];
  readonly installLanguage?: string;
  readonly runner?: string;
  readonly platformToInstall?: string;
  /** A full {@link GameInfo} snapshot taken when the element entered the queue. */
  readonly gameInfo?: GameInfo;
  /** Display text such as `"25.87 GiB"`, not a byte count. */
  readonly size?: string;
  readonly ignoreFreeSpace?: boolean;
}
