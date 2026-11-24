// The hand-authored data root, read through the model. These tests are the drift alarm: every
// file the plan names must exist, parse and expose Heronite's real key casing and wrappers.

import type {
  ArtFile,
  CopiesFile,
  DownloadManagerFile,
  EmulatorsFile,
  EpicLibraryFile,
  GogInstalledFile,
  GogLibraryFile,
  LocalLibraryFile,
  MetadataFile,
  SessionsFile,
  SideloadLibraryFile,
  StatusesFile,
  SteamLibraryFile,
  StoreConfigFile,
  TimestampFile,
} from "../../src/heronite/model.js";

import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { readStore } from "../../src/heronite/json.js";
import { dataPaths } from "../../src/heronite/paths.js";

const fixtures = join(import.meta.dir, "..", "fixtures");
const root = join(fixtures, "heronite-data");
const paths = dataPaths(root);

describe("heronite-data fixture root", () => {
  test("provides every file the plugin reads and nothing outside the root", () => {
    for (const [name, file] of Object.entries(paths)) {
      expect(existsSync(file), `${name}: ${file}`).toBe(true);
      expect(file.startsWith(root)).toBe(true);
    }
  });

  test("the sideload library holds an executable, a Steam entry, an emulator game and a hidden one", () => {
    const file = readStore<SideloadLibraryFile>(paths.sideloadLibrary);
    const games = file?.games ?? [];

    expect(games.map((game) => game.app_name)).toEqual([
      "ExampleSideload",
      "steam_440",
      "emu_9f2c1a77b3d84e10",
      "ExampleHiddenGame",
    ]);

    const sideload = games.find((game) => game.app_name === "ExampleSideload");
    expect(sideload?.is_installed).toBe(true);
    expect(sideload?.install?.executable).toBe("/games/example-sideload/example-game");
    expect(sideload?.install?.install_path).toBe("/games/example-sideload");

    const emulator = games.find((game) => game.app_name === "emu_9f2c1a77b3d84e10");
    expect(emulator?.app_name).toMatch(/^emu_[0-9a-f]{16}$/);
    expect(emulator?.is_installed).toBe(true);

    const hidden = games.find((game) => game.app_name === "ExampleHiddenGame");
    expect(hidden?.is_installed).toBe(true);
    expect(hidden?.install?.executable).toBe("/games/example-hidden/example-game");
    expect(hidden?.install?.install_path).toBe("/games/example-hidden");
  });

  test("the Epic cache keeps its library wrapper, timestamp and a DLC entry", () => {
    const file = readStore<EpicLibraryFile>(paths.epicLibrary);

    expect(file?.__timestamp?.library).toBe("Tue Oct 06 2026 21:00:00 GMT-0300 (Local Time)");
    expect(file?.library?.map((game) => game.app_name)).toEqual([
      "ExampleEpicApp",
      "ExampleEpicAppDlc",
    ]);
    expect(file?.library?.[0]?.runner).toBe("legendary");
    expect(file?.library?.[0]?.install?.install_path).toBe("/games/example-epic");
    expect(file?.library?.[1]?.install?.is_dlc).toBe(true);
  });

  test("the GOG cache and installed store mix their casing as Heronite does", () => {
    const library = readStore<GogLibraryFile>(paths.gogLibrary);
    expect(library?.games?.[0]?.app_name).toBe("1207658999");
    expect(library?.games?.[0]?.is_installed).toBe(false);
    expect(library?.__timestamp?.games).toBeDefined();

    const installed = readStore<GogInstalledFile>(paths.gogInstalled);
    const entry = installed?.installed?.[0];
    expect(entry?.appName).toBe("1207658999");
    expect(entry?.install_path).toBe("/games/Example GOG Game");
  });

  test("the Steam library is partial and uses string app ids", () => {
    const file = readStore<SteamLibraryFile>(paths.steamLibrary);
    expect(file?.games?.map((game) => game.appId)).toEqual(["440", "620"]);
    expect(file?.games?.[0]?.installed).toBe(true);
    expect(file?.games?.[1]?.installed).toBe(false);
    expect(typeof file?.games?.[0]?.appId).toBe("string");
    expect(file?.source).toBe("client");
  });

  test("the store config hides a game by app name", () => {
    const file = readStore<StoreConfigFile>(paths.storeConfig);
    expect(file?.games?.hidden?.map((game) => game.appName)).toEqual(["ExampleHiddenGame"]);
    expect(file?.games?.favourites?.map((game) => game.appName)).toEqual(["steam_440"]);
    expect(file?.settings?.experimentalFeatures?.zoomPlatform).toBe(false);
  });

  test("the local library records Steam, emulator, sideload and store overlays", () => {
    const file = readStore<LocalLibraryFile>(paths.localLibrary);

    const steam = file?.games?.steam_440;
    expect(steam?.launchKind).toBe("steam-uri");
    expect(steam?.steamAppId).toBe("440");
    expect(steam?.heroniteSteamAuto).toBe(true);

    const emulator = file?.games?.emu_9f2c1a77b3d84e10;
    expect(emulator?.launchKind).toBe("emulator");
    expect(emulator?.emulatorName).toBe("Example Emulator");
    expect(emulator?.emulatorId).toBe("example-emulator");
    expect(emulator?.emulatorProfileId).toBe("example-ps2");
    expect(emulator?.platformId).toBe("sony_playstation2");
    expect(emulator?.roms).toEqual([{ name: "Example ROM", path: "/roms/example.iso" }]);
    expect(emulator?.selectedRomPath).toBe("/roms/example.iso");

    expect(file?.games?.ExampleSideload?.launchKind).toBe("executable");
    expect(file?.games?.ExampleEpicApp?.completionStatusId).toBe("playing");

    const hidden = file?.games?.ExampleHiddenGame;
    expect(hidden?.launchKind).toBe("executable");
    expect(hidden?.windowsExecutable).toBe("/games/example-hidden/example-game");
    expect(hidden?.remappedExecutable).toBe("/games/example-hidden/example-game");
  });

  test("the emulator record names its platform profile", () => {
    const file = readStore<EmulatorsFile>(paths.emulators);
    const profile = file?.emulators?.[0]?.profiles?.[0];
    expect(profile?.platformName).toBe("PlayStation 2");
    expect(profile?.platformId).toBe("sony_playstation2");
    expect(profile?.arguments).toBe('"{rom}"');
  });

  test("metadata and art use runner-qualified keys", () => {
    const metadata = readStore<MetadataFile>(paths.metadata);
    expect(metadata?.games?.["legendary:ExampleEpicApp"]?.developers).toEqual(["Example Studio"]);
    expect(metadata?.games?.["legendary:ExampleEpicApp"]?.igdbId).toBe(1234);

    const art = readStore<ArtFile>(paths.art);
    expect(art?.games?.["gog:1207658999"]?.coverUrl).toBe(
      "localart://art/gog_1207658999/cover-1790051478808.png",
    );
  });

  test("copies link Collection keys, not metadata keys", () => {
    const file = readStore<CopiesFile>(paths.copies);
    expect(file?.links).toEqual([["gog_1207658999", "legendary_ExampleEpicApp"]]);
    expect(file?.preferred).toEqual(["gog_1207658999"]);
  });

  test("sessions, statuses and playtime parse for the tab", () => {
    const sessions = readStore<SessionsFile>(paths.sessions);
    expect(sessions?.sessions?.ExampleEpicApp).toHaveLength(2);
    expect(sessions?.sessions?.ExampleEpicApp?.[0]?.elapsedSeconds).toBe(2700);

    const statuses = readStore<StatusesFile>(paths.statuses);
    expect(statuses?.statuses?.[0]?.slug).toBe("playing");
    expect(statuses?.lastPlayniteDriveMap).toEqual({ "D:": "/mnt/games" });

    const timestamp = readStore<TimestampFile>(paths.timestamp);
    expect(timestamp?.ExampleEpicApp?.totalPlayed).toBe(152);
    expect(timestamp?.steam_440?.firstPlayed).toBe("");
  });

  test("the download manager has a running head, a queued tail and a failed history row", () => {
    const file = readStore<DownloadManagerFile>(paths.downloadManager);

    expect(file?.userPaused).toBe(false);
    expect(file?.queue?.[0]?.params?.appName).toBe("amzn1.adg.product.Example");
    expect(file?.queue?.[0]?.status).toBeUndefined();
    expect(file?.queue?.[0]?.params?.gameInfo?.app_name).toBe("amzn1.adg.product.Example");
    expect(file?.queue?.[1]?.params?.appName).toBe("ExampleEpicAppDlc");
    expect(file?.finished?.[0]?.status).toBe("error");
    expect(file?.finished?.[0]?.error).toBe("Example failure: disk full");
  });
});

describe("heronite-data-paused fixture root", () => {
  test("carries only a user-paused download queue", () => {
    const pausedRoot = join(fixtures, "heronite-data-paused");
    const pausedPaths = dataPaths(pausedRoot);

    expect(existsSync(pausedPaths.downloadManager)).toBe(true);
    expect(existsSync(pausedPaths.sideloadLibrary)).toBe(false);

    const file = readStore<DownloadManagerFile>(pausedPaths.downloadManager);
    expect(file?.userPaused).toBe(true);
    expect(file?.queue).toHaveLength(1);
    expect(file?.queue?.[0]?.params?.appName).toBe("amzn1.adg.product.Example");
  });
});
