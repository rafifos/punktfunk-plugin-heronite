// The per-game tab's data: entry id to runner/app name, then playtime, sessions, status, source
// and install state. Every case runs against the hand-authored fixture tree or a throwaway root.

import type { GameStats } from "../../src/heronite/stats.js";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { parseEntryId, readStats, statusLines } from "../../src/heronite/stats.js";

const root = join(import.meta.dir, "..", "fixtures", "heronite-data");

function statsOf(entryId: string): GameStats {
  const stats = readStats(root, entryId);
  if (stats === undefined) throw new Error(`no stats for ${entryId}`);
  return stats;
}

const tempRoots: string[] = [];

function tempRoot(files: Readonly<Record<string, string | object>>): string {
  const dir = mkdtempSync(join(tmpdir(), "heronite-stats-"));
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

describe("parseEntryId", () => {
  test("splits the external id at its first colon", () => {
    expect(parseEntryId("sideload:ExampleSideload")).toEqual({
      runner: "sideload",
      appName: "ExampleSideload",
    });
    expect(parseEntryId("legendary:Calluna")).toEqual({
      runner: "legendary",
      appName: "Calluna",
    });
  });

  test("an app name may contain colons; the runner may not", () => {
    expect(parseEntryId("nile:amzn1.adg.product:Example")).toEqual({
      runner: "nile",
      appName: "amzn1.adg.product:Example",
    });
  });

  test("a missing colon or an empty half is not an id", () => {
    expect(parseEntryId("")).toBeUndefined();
    expect(parseEntryId("sideload")).toBeUndefined();
    expect(parseEntryId(":ExampleSideload")).toBeUndefined();
    expect(parseEntryId("sideload:")).toBeUndefined();
  });
});

describe("a played game", () => {
  test("the fixture's Epic game carries playtime, dates, sessions, status, source and install", () => {
    const stats = readStats(root, "heronite:legendary:ExampleEpicApp");

    expect(stats).toMatchObject({
      entryId: "heronite:legendary:ExampleEpicApp",
      runner: "legendary",
      appName: "ExampleEpicApp",
      title: "Example Epic Game",
      playtimeMinutes: 152,
      firstPlayed: "2026-10-01T18:30:00.000Z",
      lastPlayed: "2026-10-07T12:45:00.000Z",
      sessions: {
        count: 2,
        totalSeconds: 4500,
        lastStartedAt: "2026-10-07T12:00:00.000Z",
      },
      status: { id: "playing", name: "Playing" },
      source: "Epic",
      install: "installed",
    });
  });
});

describe("an unplayed game", () => {
  test("a session without recorded playtime keeps the session, not a fabricated zero playtime", () => {
    const stats = readStats(root, "heronite:sideload:steam_440");

    expect(stats).toMatchObject({
      title: "Example Steam Game",
      sessions: {
        count: 1,
        totalSeconds: 600,
        lastStartedAt: "2026-10-05T18:00:00.000Z",
      },
      source: "Steam",
      install: "installed",
    });
    expect(stats?.playtimeMinutes).toBeUndefined();
    expect(stats?.firstPlayed).toBeUndefined();
    expect(stats?.lastPlayed).toBeUndefined();
    // The fixture's status list has no not-played entry, so the tab invents none.
    expect(stats?.status).toBeUndefined();
  });
});

describe("the emulator game", () => {
  test("resolves its explicit not-played id through the built-in defaults", () => {
    const stats = readStats(root, "heronite:sideload:emu_9f2c1a77b3d84e10");

    expect(stats).toMatchObject({
      title: "Example ROM Game",
      status: { id: "not-played", name: "Not Played" },
      source: "Emulator",
      install: "installed",
    });
  });
});

describe("install state", () => {
  test("the GOG installed record marks a cache-uninstalled game installed", () => {
    const stats = readStats(root, "heronite:gog:1207658999");

    expect(stats?.install).toBe("installed");
    expect(stats?.status).toEqual({ id: "beaten", name: "Beaten" });
  });

  test("a game no store installed and nothing queues is missing", () => {
    const stats = readStats(root, "heronite:legendary:ExampleNotInstalledEpic");

    expect(stats?.install).toBe("missing");
  });

  test("the cached Steam library's id-only join marks a store game installed", () => {
    expect(readStats(root, "heronite:legendary:ExampleSteamCopyEpic")?.install).toBe("installed");
  });

  test("a live queue element is a download, never a finished history row", () => {
    expect(readStats(root, "heronite:nile:amzn1.adg.product.Example")?.install).toBe("downloading");
    // The fixture's failed game exists only in the history, so it is not a library game at all.
    expect(readStats(root, "heronite:legendary:ExampleFailedEpicApp")).toBeUndefined();
  });
});

describe("tolerant reads", () => {
  test("a malformed sessions or timestamp file is absent, never zero playtime", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [{ runner: "sideload", app_name: "ExampleSideload", title: "Example Sideload" }],
      },
      "local_library/sessions.json": "{ this is not json",
      "store/timestamp.json": "[[[",
    });

    const stats = readStats(dir, "heronite:sideload:ExampleSideload");

    expect(stats).toMatchObject({ title: "Example Sideload", install: "missing" });
    expect(stats?.playtimeMinutes).toBeUndefined();
    expect(stats?.firstPlayed).toBeUndefined();
    expect(stats?.lastPlayed).toBeUndefined();
    expect(stats?.sessions).toBeUndefined();
  });

  test("a missing sessions or timestamp file is absent too", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [{ runner: "sideload", app_name: "ExampleSideload", title: "Example Sideload" }],
      },
    });

    const stats = readStats(dir, "heronite:sideload:ExampleSideload");

    expect(stats?.playtimeMinutes).toBeUndefined();
    expect(stats?.sessions).toBeUndefined();
  });

  test("a malformed overlay file leaves the cache title and never invents a source", () => {
    const dir = tempRoot({
      "store_cache/legendary_library.json": {
        library: [{ runner: "legendary", app_name: "ExampleEpicApp", title: "Cache title" }],
        __timestamp: { library: "Tue Oct 06 2026 21:00:00 GMT-0300 (Local Time)" },
      },
      "local_library/library.json": "{ nope",
    });

    const stats = readStats(dir, "heronite:legendary:ExampleEpicApp");

    expect(stats?.title).toBe("Cache title");
    expect(stats?.source).toBeUndefined();
  });

  test("a store cache without its __timestamp wrapper contributes nothing", () => {
    const dir = tempRoot({
      "store_cache/legendary_library.json": {
        library: [{ runner: "legendary", app_name: "ExampleEpicApp", title: "Cache title" }],
      },
    });

    expect(readStats(dir, "heronite:legendary:ExampleEpicApp")).toBeUndefined();
  });
});

describe("status resolution", () => {
  test("a custom status list names the game's id", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [{ runner: "sideload", app_name: "ExampleGame", is_installed: true }],
      },
      "local_library/library.json": {
        games: { ExampleGame: { appName: "ExampleGame", completionStatusId: "custom-1" } },
      },
      "local_library/statuses.json": {
        statuses: [{ id: "custom-1", name: "Finished twice", slug: "beaten" }],
      },
    });

    expect(readStats(dir, "heronite:sideload:ExampleGame")?.status).toEqual({
      id: "custom-1",
      name: "Finished twice",
    });
  });

  test("an empty completionStatusId takes the list's not-played slug, id and name", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [{ runner: "sideload", app_name: "ExampleGame", is_installed: true }],
      },
      "local_library/library.json": {
        games: { ExampleGame: { appName: "ExampleGame", completionStatusId: "" } },
      },
      "local_library/statuses.json": {
        statuses: [
          { id: "playing-1", name: "In progress", slug: "playing" },
          { id: "untouched-1", name: "Untouched", slug: "not-played" },
        ],
      },
    });

    expect(readStats(dir, "heronite:sideload:ExampleGame")?.status).toEqual({
      id: "untouched-1",
      name: "Untouched",
    });
  });

  test("without statuses.json the nine defaults apply, and an unknown id is omitted", () => {
    const files = (completionStatusId: string) => ({
      "sideload_apps/library.json": {
        games: [{ runner: "sideload", app_name: "ExampleGame", is_installed: true }],
      },
      "local_library/library.json": {
        games: { ExampleGame: { appName: "ExampleGame", completionStatusId } },
      },
    });

    const beaten = tempRoot(files("beaten"));
    expect(readStats(beaten, "heronite:sideload:ExampleGame")?.status).toEqual({
      id: "beaten",
      name: "Beaten",
    });

    const endless = tempRoot(files("endless"));
    expect(readStats(endless, "heronite:sideload:ExampleGame")?.status).toEqual({
      id: "endless",
      name: "On Going",
    });

    const absent = tempRoot(files(""));
    expect(readStats(absent, "heronite:sideload:ExampleGame")?.status).toEqual({
      id: "not-played",
      name: "Not Played",
    });

    const unknown = tempRoot(files("my-own-status"));
    expect(readStats(unknown, "heronite:sideload:ExampleGame")?.status).toBeUndefined();
  });

  test("an explicitly empty statuses list also falls back to the defaults", () => {
    const dir = tempRoot({
      "sideload_apps/library.json": {
        games: [{ runner: "sideload", app_name: "ExampleGame", is_installed: true }],
      },
      "local_library/library.json": {
        games: { ExampleGame: { appName: "ExampleGame", completionStatusId: "" } },
      },
      "local_library/statuses.json": { statuses: [] },
    });

    expect(readStats(dir, "heronite:sideload:ExampleGame")?.status).toEqual({
      id: "not-played",
      name: "Not Played",
    });
  });
});

describe("title and source", () => {
  test("the overlay wins over metadata, which wins over the store cache", () => {
    const files = (overlayTitle: string | undefined, metadataTitle: string | undefined) => ({
      "store_cache/legendary_library.json": {
        library: [{ runner: "legendary", app_name: "ExampleEpicApp", title: "Cache title" }],
        __timestamp: { library: "Tue Oct 06 2026 21:00:00 GMT-0300 (Local Time)" },
      },
      ...(metadataTitle === undefined
        ? {}
        : {
            "local_library/metadata.json": {
              games: { "legendary:ExampleEpicApp": { title: metadataTitle } },
            },
          }),
      ...(overlayTitle === undefined
        ? {}
        : {
            "local_library/library.json": {
              games: { ExampleEpicApp: { appName: "ExampleEpicApp", title: overlayTitle } },
            },
          }),
    });

    const all = tempRoot(files("Overlay title", "Metadata title"));
    expect(readStats(all, "heronite:legendary:ExampleEpicApp")?.title).toBe("Overlay title");

    const metadata = tempRoot(files(undefined, "Metadata title"));
    expect(readStats(metadata, "heronite:legendary:ExampleEpicApp")?.title).toBe("Metadata title");

    const cache = tempRoot(files(undefined, undefined));
    expect(readStats(cache, "heronite:legendary:ExampleEpicApp")?.title).toBe("Cache title");
  });

  test("known sources get a display label, client ids included, and unknowns stay raw", () => {
    const files = (source: string) => ({
      "sideload_apps/library.json": {
        games: [{ runner: "sideload", app_name: "ExampleGame", is_installed: true }],
      },
      "local_library/library.json": {
        games: { ExampleGame: { appName: "ExampleGame", source } },
      },
    });

    expect(readStats(tempRoot(files("amazon")), "heronite:sideload:ExampleGame")?.source).toBe(
      "Amazon",
    );
    expect(readStats(tempRoot(files("battlenet")), "heronite:sideload:ExampleGame")?.source).toBe(
      "Battle.net",
    );
    expect(
      readStats(tempRoot(files("my-own-client")), "heronite:sideload:ExampleGame")?.source,
    ).toBe("my-own-client");
  });
});

describe("statusLines", () => {
  test("the played fixture game's lines, in order and greppable", () => {
    expect(statusLines(statsOf("heronite:legendary:ExampleEpicApp"))).toEqual([
      { level: "info", text: "Playtime: 2 h 32 m" },
      { level: "info", text: "Sessions: 2 (1 h 15 m)" },
      { level: "info", text: "Last played: 2026-10-07" },
      { level: "info", text: "First played: 2026-10-01" },
      { level: "info", text: "Status: Playing" },
      { level: "info", text: "Source: Epic" },
      { level: "info", text: "Installed" },
    ]);
  });

  test("an unplayed game has no playtime line, and whole hours drop the minutes", () => {
    const texts = statusLines(statsOf("heronite:sideload:steam_440")).map((line) => line.text);

    expect(texts).toContain("Sessions: 1 (10 m)");
    expect(texts.some((text) => text.startsWith("Playtime:"))).toBe(false);
    expect(texts.some((text) => text.startsWith("Status:"))).toBe(false);
    expect(texts).toContain("Source: Steam");

    const base = statsOf("heronite:legendary:ExampleEpicApp");
    expect(
      statusLines({ ...base, sessions: { count: 1, totalSeconds: 7200 } }).map((line) => line.text),
    ).toContain("Sessions: 1 (2 h)");
  });

  test("the install line speaks Heronite's language", () => {
    const base = statsOf("heronite:legendary:ExampleEpicApp");

    expect(statusLines({ ...base, install: "missing" })).toContainEqual({
      level: "info",
      text: "Not installed",
    });
    expect(statusLines({ ...base, install: "downloading" })).toContainEqual({
      level: "info",
      text: "Downloading in Heronite",
    });
  });

  test("at most 8 lines, each at most 120 characters", () => {
    const wide: GameStats = {
      entryId: "heronite:sideload:ExampleGame",
      runner: "sideload",
      appName: "ExampleGame",
      title: "Example Game",
      playtimeMinutes: 100_000,
      firstPlayed: "2026-01-01T00:00:00.000Z",
      lastPlayed: "2026-01-02T00:00:00.000Z",
      sessions: { count: 12, totalSeconds: 7200 },
      status: { id: "playing", name: "Playing" },
      source: "x".repeat(300),
      install: "missing",
    };

    const lines = statusLines(wide);

    expect(lines.length).toBeLessThanOrEqual(8);
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(120);
    expect(lines.some((line) => line.text.length === 120)).toBe(true);
  });
});

describe("readStats identity", () => {
  test("only heronite:-prefixed ids are ours", () => {
    expect(readStats(root, "steam:440")).toBeUndefined();
    expect(readStats(root, "hydra:1234")).toBeUndefined();
    expect(readStats(root, "legendary:ExampleEpicApp")).toBeUndefined();
  });

  test("an id Heronite's files never mention has no stats", () => {
    expect(readStats(root, "heronite:sideload:does-not-exist")).toBeUndefined();
    expect(readStats(root, "heronite:")).toBeUndefined();
  });
});
