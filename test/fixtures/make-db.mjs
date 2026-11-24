// Writes test/fixtures/hydra-db with classic-level, the store Hydra itself uses.
// Run from a folder with `npm i classic-level@2`: node <repo>/test/fixtures/make-db.mjs
// The first batch lands in a table on reopen; the second stays in the live log.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ClassicLevel } from "classic-level";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "hydra-db");
fs.rmSync(out, { recursive: true, force: true });

const game = (shop, objectId, title, extra = {}) => ({
  title,
  iconUrl: `https://cdn.example/${objectId}/icon.png`,
  libraryHeroImageUrl: `https://cdn.example/${objectId}/hero.jpg`,
  logoImageUrl: `https://cdn.example/${objectId}/logo.png`,
  playTimeInMilliseconds: 0,
  lastTimePlayed: null,
  objectId,
  shop,
  remoteId: null,
  isDeleted: false,
  ...extra,
});

const download = (shop, objectId, extra) => ({
  shop,
  objectId,
  uri: "magnet:?xt=urn:btih:0000",
  folderName: null,
  downloadPath: "/home/deck/Games/Hydra",
  progress: 0,
  downloader: 1,
  bytesDownloaded: 0,
  fileSize: null,
  shouldSeed: false,
  status: "paused",
  queued: false,
  timestamp: 1759500000000,
  extracting: false,
  automaticallyExtract: true,
  automaticallyDeleteArchiveFiles: false,
  ...extra,
});

const open = async () => {
  const db = new ClassicLevel(out, { valueEncoding: "json" });
  await db.open();
  return {
    db,
    games: db.sublevel("games", { valueEncoding: "json" }),
    downloads: db.sublevel("downloads", { valueEncoding: "json" }),
    assets: db.sublevel("gameShopAssets", { valueEncoding: "json" }),
    cache: db.sublevel("gameShopCache", { valueEncoding: "json" }),
  };
};

// Batch one: on disk as a table after the reopen below.
{
  const { db, games, downloads, assets, cache } = await open();
  // Enough bulk before `!games!` to spread the table over many blocks.
  for (let i = 0; i < 40; i++) {
    await cache.put(`steam:${1000 + i}:en`, {
      about: "A very long store page. ".repeat(150),
    });
  }
  await games.put(
    "steam:1091500",
    game("steam", "1091500", "Cyberpunk 2077", {
      executablePath: "/home/deck/Games/Hydra/Cyberpunk 2077/bin/x64/Cyberpunk2077.exe",
      winePrefixPath: "/home/deck/Games/Hydra/Prefixes/1091500",
    }),
  );
  await games.put(
    "steam:620",
    game("steam", "620", "Portal 2", {
      executablePath: "/home/deck/Games/Portal 2/old.sh",
    }),
  );
  await games.put("steam:367520", game("steam", "367520", "Hollow Knight"));
  await games.put("steam:105600", game("steam", "105600", "Terraria"));
  await games.put(
    "steam:1145360",
    game("steam", "1145360", "Hades", {
      isDeleted: true,
      executablePath: "/home/deck/Games/Hades/Hades.exe",
    }),
  );
  await games.put(
    "steam:413150",
    game("steam", "413150", "Stardew Valley", {
      executablePath: "/home/deck/Games/Stardew/StardewValley",
    }),
  );
  await games.put(
    "custom:6f1c3d52-8a1e-4f7b-9d2e-1a2b3c4d5e6f",
    game("custom", "6f1c3d52-8a1e-4f7b-9d2e-1a2b3c4d5e6f", "My Game", {
      iconUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      customIconUrl: "local:/home/deck/Pictures/icon.png",
      executablePath: "/home/deck/Games/MyGame/game.x86_64",
    }),
  );
  await games.put(
    "launchbox:okami-ps2",
    game("launchbox", "okami-ps2", "Okami", {
      platform: "Sony PlayStation 2",
      discs: [{ path: "/home/deck/ROMs/ps2/Okami (USA).iso", label: "Disc 1" }],
    }),
  );
  await assets.put("steam:1091500", {
    objectId: "1091500",
    shop: "steam",
    title: "Cyberpunk 2077",
    iconUrl: null,
    libraryHeroImageUrl: "https://cdn.example/1091500/hero.jpg",
    libraryImageUrl: "https://cdn.example/1091500/library_600x900.jpg",
    logoImageUrl: "https://cdn.example/1091500/logo.png",
    logoPosition: null,
    coverImageUrl: "https://cdn.example/1091500/cover.jpg",
    downloadSources: [],
    updatedAt: 1759500000000,
  });
  await downloads.put(
    "steam:1091500",
    download("steam", "1091500", {
      status: "complete",
      folderName: "Cyberpunk 2077",
      progress: 1,
      bytesDownloaded: 70e9,
      fileSize: 70e9,
    }),
  );
  await downloads.put(
    "steam:367520",
    download("steam", "367520", { fileSize: 9e9, bytesDownloaded: 1e9 }),
  );
  await db.put("userPreferences", { downloadsPath: "/home/deck/Games/Hydra" });
  await db.close();
}

// Batch two: still in the log when Hydra is running.
{
  const { db, games, downloads, cache } = await open();
  // Bigger than a 32 KiB log block, so the record spans several fragments.
  await cache.put("steam:9999:en", { about: "x".repeat(40_000) });
  await downloads.put(
    "steam:367520",
    download("steam", "367520", {
      status: "active",
      folderName: "Hollow Knight",
      progress: 0.42,
      bytesDownloaded: 3.78e9,
      fileSize: 9e9,
    }),
  );
  await games.put(
    "steam:620",
    game("steam", "620", "Portal 2", {
      executablePath: "/home/deck/Games/Portal 2/portal2.sh",
    }),
  );
  await games.del("steam:413150");
  await games.put("steam:1245620", game("steam", "1245620", "Elden Ring"));
  await downloads.put(
    "steam:1245620",
    download("steam", "1245620", {
      status: "complete",
      folderName: "ELDEN RING.rar",
      progress: 1,
      bytesDownloaded: 50e9,
      fileSize: 50e9,
      extracting: true,
      extractionProgress: 0.5,
    }),
  );
  await games.put("steam:292030", game("steam", "292030", "The Witcher 3"));
  await downloads.put(
    "steam:292030",
    download("steam", "292030", { status: "error", fileSize: 40e9 }),
  );
  await games.put("steam:1086940", game("steam", "1086940", "Baldur's Gate 3"));
  await downloads.put(
    "steam:1086940",
    download("steam", "1086940", { status: "waiting", queued: true }),
  );
  await db.close();
}

// A running Hydra holds LOCK; the reader never opens it, so the fixture doesn't need it.
fs.rmSync(path.join(out, "LOCK"), { force: true });
fs.rmSync(path.join(out, "LOG"), { force: true });
fs.rmSync(path.join(out, "LOG.old"), { force: true });
