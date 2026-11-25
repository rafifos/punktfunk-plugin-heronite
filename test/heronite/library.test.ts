// The Collection view: merge the store caches with the local overlay, apply Heronite's filters,
// collapse the copy groups it recorded and join the Steam library by app id. Every case here runs
// against the hand-authored fixture tree or a throwaway root, never against a real Heronite.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { assembleCollection, parseDisplaySize } from "../../src/heronite/library.js";

const fixtures = join(import.meta.dir, "..", "fixtures");
const root = join(fixtures, "heronite-data");
const pausedRoot = join(fixtures, "heronite-data-paused");

const tempRoots: string[] = [];

function tempRoot(files: Readonly<Record<string, string | object>>): string {
  const dir = mkdtempSync(join(tmpdir(), "heronite-library-"));
  tempRoots.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const file = join(dir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function keys(dir: string): readonly string[] {
  return assembleCollection(dir).games.map((game) => game.key);
}

function byKey(dir: string, key: string) {
  return assembleCollection(dir).games.find((game) => game.key === key);
}

describe("assembleCollection golden", () => {
  test("the fixture tree yields the exact games, sorted by key", () => {
    const collection = assembleCollection(root);

    expect(collection.games.map((game) => game.key)).toEqual([
      "gog:1207658999",
      "legendary:ExampleSteamCopyEpic",
      "nile:amzn1.adg.product.Example",
      "sideload:ExampleSideload",
      "sideload:emu_9f2c1a77b3d84e10",
      "sideload:steam_440",
    ]);
  });

  test("the local overlay, metadata and art are joined by their own keys", () => {
    const gog = byKey(root, "gog:1207658999");
    expect(gog?.local?.launchKind).toBe("executable");
    expect(gog?.metadata?.genres).toEqual(["Role-playing"]);
    expect(gog?.art?.logoUrl).toBe("https://cdn.example/my-logo.png");

    const emulator = byKey(root, "sideload:emu_9f2c1a77b3d84e10");
    expect(emulator?.local?.emulatorId).toBe("example-emulator");
    expect(emulator?.emulator?.profile.platformName).toBe("PlayStation 2");
    expect(emulator?.emulator?.romPath).toBe("/roms/example.iso");
  });

  test("the GOG installed record marks the game installed and fills its install block", () => {
    const gog = byKey(root, "gog:1207658999");

    expect(gog?.installed).toBe(true);
    expect(gog?.steamInstalled).toBe(false);
    expect(gog?.gameInfo.install).toEqual({
      is_dlc: false,
      install_path: "/games/Example GOG Game",
      install_size: "12.5 GiB",
      version: "1.0.0",
      platform: "linux",
    });
  });

  test("the downloading title carries its queue element and parsed size", () => {
    const amazon = byKey(root, "nile:amzn1.adg.product.Example");

    expect(amazon?.installed).toBe(false);
    expect(amazon?.downloading?.params?.appName).toBe("amzn1.adg.product.Example");
    expect(amazon?.sizeBytes).toBe(13_421_772_800);
  });
});

describe("assembleCollection filters", () => {
  test("hidden, DLC, browser, unavailable and zoom games never reach the collection", () => {
    const present = keys(root);

    expect(present).not.toContain("sideload:ExampleHiddenGame");
    expect(present).not.toContain("legendary:ExampleEpicAppDlc");
    expect(present).not.toContain("sideload:ExampleBrowserGame");
    expect(present).not.toContain("sideload:ExampleUnavailableGame");
  });

  test("a game that is neither installed nor downloading is out", () => {
    expect(keys(root)).not.toContain("legendary:ExampleNotInstalledEpic");
  });

  test("the finished history never marks a game as downloading", () => {
    expect(keys(root)).not.toContain("legendary:ExampleFailedEpicApp");
  });

  test("the zoom runner is dropped from a store cache", () => {
    const dir = tempRoot({
      "store_cache/gog_library.json": {
        games: [
          { runner: "gog", app_name: "1207658999", title: "Example GOG", is_installed: true },
          { runner: "zoom", app_name: "1234567890", title: "Example Zoom", is_installed: true },
        ],
        __timestamp: { games: "Tue Oct 06 2026 21:05:00 GMT-0300 (Local Time)" },
      },
    });

    expect(keys(dir)).toEqual(["gog:1207658999"]);
  });

  test("an unavailable launch kind removes a game that would otherwise qualify", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "ExampleUnavailable",
            title: "Example Unavailable",
            is_installed: true,
            install: { executable: "/games/example/game", platform: "linux" },
          },
          {
            runner: "sideload",
            app_name: "ExampleEmptyKind",
            title: "Example Empty Kind",
            is_installed: true,
            install: { executable: "/games/example/game", platform: "linux" },
          },
        ],
      },
      "local_library/library.json": {
        games: {
          ExampleUnavailable: {
            appName: "ExampleUnavailable",
            launchKind: "unavailable",
            title: "Example Unavailable",
          },
          ExampleEmptyKind: {
            appName: "ExampleEmptyKind",
            launchKind: "",
            title: "Example Empty Kind",
          },
        },
      },
    });

    expect(keys(dir)).toEqual([]);
  });

  test("launcher, client and xbox launches need no executable", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: ["ExampleLauncher", "ExampleClient", "ExampleXbox"].map((appName) => ({
          runner: "sideload",
          app_name: appName,
          title: appName,
          is_installed: true,
          install: { platform: "linux" },
        })),
      },
      "local_library/library.json": {
        games: {
          ExampleLauncher: { appName: "ExampleLauncher", launchKind: "launcher" },
          ExampleClient: { appName: "ExampleClient", launchKind: "client" },
          ExampleXbox: { appName: "ExampleXbox", launchKind: "xbox" },
        },
      },
    });

    expect(keys(dir)).toEqual([
      "sideload:ExampleClient",
      "sideload:ExampleLauncher",
      "sideload:ExampleXbox",
    ]);
  });

  test("a steam_ app name alone makes a Steam URI game runnable", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "steam_440",
            title: "Example Steam Game",
            is_installed: true,
            install: {},
          },
          {
            runner: "sideload",
            app_name: "ExampleSteamUri",
            title: "Example Steam URI",
            is_installed: true,
            install: {},
          },
        ],
      },
      "local_library/library.json": {
        games: {
          steam_440: { appName: "steam_440", launchKind: "steam-uri" },
          ExampleSteamUri: { appName: "ExampleSteamUri", launchKind: "steam-uri" },
        },
      },
    });

    expect(keys(dir)).toEqual(["sideload:steam_440"]);
  });

  test("an executable can come from a Heronite command", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "ExampleCommand",
            title: "Example Command",
            is_installed: true,
            install: { platform: "linux" },
            heroniteCommand: "/games/example/run.sh",
          },
        ],
      },
      "local_library/library.json": {
        games: { ExampleCommand: { appName: "ExampleCommand", launchKind: "executable" } },
      },
    });

    expect(keys(dir)).toEqual(["sideload:ExampleCommand"]);
  });

  test("an emulator game without a matching profile is out", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "emu_0000000000000000",
            title: "Example ROM",
            is_installed: true,
            install: { platform: "linux" },
          },
        ],
      },
      "local_library/library.json": {
        games: {
          emu_0000000000000000: {
            appName: "emu_0000000000000000",
            launchKind: "emulator",
            emulatorId: "missing-emulator",
            emulatorProfileId: "missing-profile",
            selectedRomPath: "/roms/example.iso",
          },
        },
      },
      "local_library/emulators.json": { emulators: [] },
    });

    expect(keys(dir)).toEqual([]);
  });

  test("a sideload game with no overlay never becomes an entry", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "ExampleNoOverlay",
            title: "Example No Overlay",
            is_installed: true,
            install: { executable: "/games/example/game", platform: "linux" },
          },
        ],
      },
    });

    expect(keys(dir)).toEqual([]);
  });
});

describe("assembleCollection copy collapse", () => {
  test("the first installed member of a linked group is kept and the others are out", () => {
    const present = keys(root);

    expect(present).toContain("gog:1207658999");
    expect(present).not.toContain("legendary:ExampleEpicApp");
  });

  test("a non-installed member is skipped in favour of a later one", () => {
    const present = keys(root);

    expect(present).toContain("nile:amzn1.adg.product.Example");
    expect(present).not.toContain("legendary:ExampleNotInstalledEpic");
  });

  test("a group with no installed member publishes none of its copies", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "ExampleCopyA",
            title: "Example Copy A",
            is_installed: false,
            install: { executable: "/games/a/game", platform: "linux" },
          },
          {
            runner: "sideload",
            app_name: "ExampleCopyB",
            title: "Example Copy B",
            is_installed: false,
            install: { executable: "/games/b/game", platform: "linux" },
          },
        ],
      },
      "local_library/library.json": {
        games: {
          ExampleCopyA: { appName: "ExampleCopyA", launchKind: "executable" },
          ExampleCopyB: { appName: "ExampleCopyB", launchKind: "executable" },
        },
      },
      "local_library/copies.json": {
        links: [["sideload_ExampleCopyA", "sideload_ExampleCopyB"]],
        preferred: ["sideload_ExampleCopyA"],
      },
    });

    expect(keys(dir)).toEqual([]);
  });

  test("an installed member later in the group wins over a downloading first member", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "ExampleCopyA",
            title: "Example Copy A",
            is_installed: false,
            install: { executable: "/games/a/game", platform: "linux" },
          },
          {
            runner: "sideload",
            app_name: "ExampleCopyB",
            title: "Example Copy B",
            is_installed: true,
            install: { executable: "/games/b/game", platform: "linux" },
          },
        ],
      },
      "local_library/library.json": {
        games: {
          ExampleCopyA: { appName: "ExampleCopyA", launchKind: "executable" },
          ExampleCopyB: { appName: "ExampleCopyB", launchKind: "executable" },
        },
      },
      "local_library/copies.json": {
        links: [["sideload_ExampleCopyA", "sideload_ExampleCopyB"]],
      },
      "store/download-manager.json": {
        queue: [{ params: { runner: "sideload", appName: "ExampleCopyA" } }],
      },
    });

    expect(keys(dir)).toEqual(["sideload:ExampleCopyB"]);
  });

  test("with no installed member, the first downloading copy is published", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "ExampleCopyA",
            title: "Example Copy A",
            is_installed: false,
            install: { executable: "/games/a/game", platform: "linux" },
          },
          {
            runner: "sideload",
            app_name: "ExampleCopyB",
            title: "Example Copy B",
            is_installed: false,
            install: { executable: "/games/b/game", platform: "linux" },
          },
        ],
      },
      "local_library/library.json": {
        games: {
          ExampleCopyA: { appName: "ExampleCopyA", launchKind: "executable" },
          ExampleCopyB: { appName: "ExampleCopyB", launchKind: "executable" },
        },
      },
      "local_library/copies.json": {
        links: [["sideload_ExampleCopyA", "sideload_ExampleCopyB"]],
      },
      "store/download-manager.json": {
        queue: [
          { params: { runner: "sideload", appName: "ExampleCopyA" } },
          { params: { runner: "sideload", appName: "ExampleCopyB" } },
        ],
      },
    });

    expect(keys(dir)).toEqual(["sideload:ExampleCopyA"]);
  });
});

describe("assembleCollection Steam join", () => {
  test("a not-installed store game joins the installed Steam cache by local steam app id", () => {
    const game = byKey(root, "legendary:ExampleSteamCopyEpic");

    expect(game?.installed).toBe(true);
    expect(game?.steamInstalled).toBe(true);
    expect(game?.gameInfo.is_installed).toBe(false);
  });

  test("the join also reads the app id from collection metadata", () => {
    const dir = tempRoot({
      "store_cache/legendary_library.json": {
        library: [
          {
            app_name: "ExampleMetadataJoin",
            runner: "legendary",
            title: "Example Metadata Join",
            is_installed: false,
          },
        ],
        __timestamp: { library: "Tue Oct 06 2026 21:00:00 GMT-0300 (Local Time)" },
      },
      "store_cache/steam_library.json": {
        games: [{ appId: "440", name: "Example Steam Game", installed: true }],
        family: [{ appId: "730", name: "Example Shared Game", installed: true }],
      },
      "local_library/metadata.json": {
        games: {
          "legendary:ExampleMetadataJoin": {
            appName: "ExampleMetadataJoin",
            runner: "legendary",
            steamAppId: "730",
          },
        },
      },
    });

    expect(byKey(dir, "legendary:ExampleMetadataJoin")?.installed).toBe(true);
  });

  test("a Steam row that is not installed does not join", () => {
    const dir = tempRoot({
      "store_cache/legendary_library.json": {
        library: [
          {
            app_name: "ExampleNotJoined",
            runner: "legendary",
            title: "Example Not Joined",
            is_installed: false,
          },
        ],
        __timestamp: { library: "Tue Oct 06 2026 21:00:00 GMT-0300 (Local Time)" },
      },
      "store_cache/steam_library.json": {
        games: [{ appId: "620", name: "Example Other Steam Game", installed: false }],
      },
      "local_library/library.json": {
        games: { ExampleNotJoined: { appName: "ExampleNotJoined", steamAppId: "620" } },
      },
    });

    expect(keys(dir)).toEqual([]);
  });

  test("a sideload Steam entry is installed only by its own flag, not the Steam cache", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [
          {
            runner: "sideload",
            app_name: "steam_440",
            title: "Example Steam Game",
            is_installed: false,
            install: {},
          },
        ],
      },
      "local_library/library.json": {
        games: {
          steam_440: {
            appName: "steam_440",
            runner: "sideload",
            launchKind: "steam-uri",
            steamAppId: "440",
          },
        },
      },
      "store_cache/steam_library.json": {
        games: [{ appId: "440", name: "Example Steam Game", installed: true }],
      },
    });

    expect(keys(dir)).toEqual([]);
  });

  test("a store game with the same ids does join the Steam cache and publishes", () => {
    const dir = tempRoot({
      "store_cache/legendary_library.json": {
        library: [
          {
            app_name: "ExampleSteamCopyEpic",
            runner: "legendary",
            title: "Example Steam Copy Epic Game",
            is_installed: false,
            install: { is_dlc: false },
          },
        ],
        __timestamp: { library: "Tue Oct 06 2026 21:00:00 GMT-0300 (Local Time)" },
      },
      "local_library/library.json": {
        games: {
          ExampleSteamCopyEpic: {
            appName: "ExampleSteamCopyEpic",
            runner: "legendary",
            launchKind: "steam-uri",
            steamAppId: "440",
          },
        },
      },
      "store_cache/steam_library.json": {
        games: [{ appId: "440", name: "Example Steam Game", installed: true }],
      },
    });

    expect(keys(dir)).toEqual(["legendary:ExampleSteamCopyEpic"]);
  });
});

describe("assembleCollection queue-only games", () => {
  test("a paused queue still admits the download Heronite started before its cache was written", () => {
    const collection = assembleCollection(pausedRoot);

    expect(collection.games.map((game) => game.key)).toEqual(["nile:amzn1.adg.product.Example"]);

    const game = collection.games[0];
    expect(game?.title).toBe("Example Amazon Game");
    expect(game?.runner).toBe("nile");
    expect(game?.installed).toBe(false);
    expect(game?.downloading?.params?.runner).toBe("nile");
    expect(game?.sizeBytes).toBe(13_421_772_800);
  });
});

describe("assembleCollection tolerant reads", () => {
  test("a malformed file is skipped without emptying the other sources", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": "{ not json",
      "store_cache/gog_library.json": {
        games: [
          { runner: "gog", app_name: "1207658999", title: "Example GOG", is_installed: true },
        ],
        __timestamp: { games: "Tue Oct 06 2026 21:05:00 GMT-0300 (Local Time)" },
      },
    });

    expect(keys(dir)).toEqual(["gog:1207658999"]);
  });

  test("a store cache without its timestamp reads as empty", () => {
    const dir = tempRoot({
      "store_cache/gog_library.json": {
        games: [
          { runner: "gog", app_name: "1207658999", title: "Example GOG", is_installed: true },
        ],
      },
    });

    expect(keys(dir)).toEqual([]);
  });

  test("a missing data root is an empty collection, not a crash", () => {
    const collection = assembleCollection(join(root, "does-not-exist"));

    expect(collection.games).toEqual([]);
  });
});

describe("parseDisplaySize", () => {
  test("parses the binary units Heronite writes", () => {
    expect(parseDisplaySize("12.5 GiB")).toBe(13_421_772_800);
    expect(parseDisplaySize("1.5 GiB")).toBe(1_610_612_736);
    expect(parseDisplaySize("1.00 GiB")).toBe(1_073_741_824);
    expect(parseDisplaySize("512 MiB")).toBe(536_870_912);
    expect(parseDisplaySize("1 KiB")).toBe(1_024);
  });

  test("parses decimal units and bytes", () => {
    expect(parseDisplaySize("2 GB")).toBe(2_000_000_000);
    expect(parseDisplaySize("100 MB")).toBe(100_000_000);
    expect(parseDisplaySize("1 KB")).toBe(1_000);
    expect(parseDisplaySize("1024 B")).toBe(1_024);
    expect(parseDisplaySize("0")).toBe(0);
  });

  test("returns undefined for absent or unrecognized sizes", () => {
    expect(parseDisplaySize(undefined)).toBeUndefined();
    expect(parseDisplaySize("")).toBeUndefined();
    expect(parseDisplaySize("a lot")).toBeUndefined();
    expect(parseDisplaySize("12.5 TiB")).toBeUndefined();
  });
});
