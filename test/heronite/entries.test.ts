// Heronite's Collection games mapped to provider entries: the external id, art chain, metadata,
// platform, catalog ids, detect hints and install state. The golden pins the fixture's whole output.

import type { Transport } from "../../src/heronite/launch.js";

import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { buildEntries, toEntry } from "../../src/heronite/entries.js";
import { assembleCollection, type CollectionGame } from "../../src/heronite/library.js";

const root = join(import.meta.dir, "..", "fixtures", "heronite-data");
const run: Transport = { kind: "run" };

function game(overrides: Partial<CollectionGame> = {}): CollectionGame {
  const appName = overrides.appName ?? "ExampleGame";
  const runner = overrides.runner ?? "sideload";
  return {
    key: overrides.key ?? `${runner}:${appName}`,
    runner,
    appName,
    title: overrides.title ?? "Example Game",
    gameInfo: overrides.gameInfo ?? { app_name: appName, runner, title: "Example Game" },
    local: overrides.local,
    metadata: overrides.metadata,
    art: overrides.art,
    emulator: overrides.emulator,
    steamAppId: overrides.steamAppId,
    installed: overrides.installed ?? true,
    steamInstalled: overrides.steamInstalled ?? false,
    downloading: overrides.downloading,
    sizeBytes: overrides.sizeBytes,
  };
}

function args(runner: string, appName: string) {
  return [
    { name: "runner", value: runner },
    { name: "appName", value: appName },
  ];
}

describe("buildEntries golden", () => {
  test("the fixture tree maps to the exact provider entries, in key order", () => {
    const entries = buildEntries(assembleCollection(root), run);

    expect(entries).toStrictEqual([
      {
        external_id: "gog:1207658999",
        title: "Example GOG Game",
        platform: "PC",
        description: "A hand-authored GOG game.",
        developer: "Example Studio",
        publisher: "Example Publisher",
        release_year: 2015,
        genres: ["Role-playing"],
        art: {
          portrait: "https://cdn.example/gog-vertical.jpg",
          hero: "https://cdn.example/gog-cover.jpg",
          logo: "https://cdn.example/my-logo.png",
          header: "https://cdn.example/gog-cover.jpg",
        },
        ids: { gog: "1207658999" },
        launch: { kind: "exec", value: "run", args: args("gog", "1207658999") },
        detect: {
          install_dir: "/games/Example GOG Game",
          env_marker: { key: "HEROIC_APP_NAME", value: "1207658999" },
        },
      },
      {
        external_id: "legendary:ExampleSteamCopyEpic",
        title: "Example Steam Copy Epic Game",
        platform: "PC",
        art: {
          portrait: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/library_600x900.jpg",
          hero: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/library_hero.jpg",
          logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/logo.png",
          header: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/header.jpg",
        },
        ids: { steam: "440", epic: "ExampleSteamCopyEpic" },
        launch: { kind: "exec", value: "run", args: args("legendary", "ExampleSteamCopyEpic") },
        detect: {
          steam_appid: 440,
        },
      },
      {
        external_id: "nile:amzn1.adg.product.Example",
        title: "Example Amazon Game",
        platform: "PC",
        description: "A hand-authored Amazon game that is still downloading.",
        developer: "Example Studio",
        release_year: 2023,
        genres: ["action"],
        art: {
          portrait: "https://cdn.example/amazon-tall.jpg",
          hero: "https://cdn.example/amazon-wide.jpg",
          logo: "https://cdn.example/amazon-logo.png",
          header: "https://cdn.example/amazon-wide.jpg",
        },
        launch: { kind: "exec", value: "run", args: args("nile", "amzn1.adg.product.Example") },
        detect: {
          env_marker: { key: "HEROIC_APP_NAME", value: "amzn1.adg.product.Example" },
        },
        install: { state: "missing", size_bytes: 13_421_772_800 },
      },
      {
        external_id: "sideload:ExampleSideload",
        title: "Example Sideload Game",
        platform: "PC",
        description: "A hand-authored sideload executable.",
        developer: "Example Studio",
        art: {
          portrait: "https://cdn.example/sideload-tall.jpg",
          hero: "https://cdn.example/sideload-wide.jpg",
          header: "https://cdn.example/sideload-wide.jpg",
        },
        launch: { kind: "exec", value: "run", args: args("sideload", "ExampleSideload") },
        detect: {
          install_dir: "/games/example-sideload",
          exe: "/games/example-sideload/example-game",
          process_name: "example-game",
          env_marker: { key: "HEROIC_APP_NAME", value: "ExampleSideload" },
        },
      },
      {
        external_id: "sideload:emu_9f2c1a77b3d84e10",
        title: "Example ROM Game",
        platform: "PlayStation 2",
        genres: ["Action"],
        art: {
          portrait: "https://cdn.example/rom-tall.jpg",
        },
        launch: { kind: "exec", value: "run", args: args("sideload", "emu_9f2c1a77b3d84e10") },
        detect: {
          install_dir: "/roms",
          exe: "/usr/bin/example-emulator",
          process_name: "example-emulator",
        },
      },
      {
        external_id: "sideload:steam_440",
        title: "Example Steam Game",
        platform: "PC",
        art: {
          portrait: "https://cdn.example/steam-art.jpg",
          hero: "https://cdn.example/steam-wide.jpg",
          logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/logo.png",
          header: "https://cdn.example/steam-wide.jpg",
        },
        ids: { steam: "440" },
        launch: { kind: "exec", value: "run", args: args("sideload", "steam_440") },
        detect: { steam_appid: 440 },
      },
    ]);
  });
});

describe("toEntry title", () => {
  test("the local overlay wins over metadata, the store record and the app name", () => {
    expect(
      toEntry(game({ local: { appName: "ExampleGame", title: "Overlay Title" } }), run)?.title,
    ).toBe("Overlay Title");
  });

  test("metadata and store titles are used when the overlay has none", () => {
    const withMetadata = game({
      title: "ExampleGame",
      metadata: { title: "Metadata Title" },
      gameInfo: { app_name: "ExampleGame", title: "Store Title" },
    });
    expect(toEntry(withMetadata, run)?.title).toBe("Metadata Title");

    const withStore = game({
      title: "ExampleGame",
      gameInfo: { app_name: "ExampleGame", title: "Store Title" },
    });
    expect(toEntry(withStore, run)?.title).toBe("Store Title");
  });
});

describe("toEntry art chain", () => {
  test("custom remote art wins every slot", () => {
    const entry = toEntry(
      game({
        art: {
          coverUrl: "https://custom.example/cover.jpg",
          heroUrl: "https://custom.example/hero.jpg",
          logoUrl: "https://custom.example/logo.png",
          coverWideUrl: "https://custom.example/wide.jpg",
        },
        metadata: {
          coverUrl: "https://meta.example/cover.jpg",
          heroUrl: "https://meta.example/hero.jpg",
          logoUrl: "https://meta.example/logo.png",
          coverWideUrl: "https://meta.example/wide.jpg",
        },
        gameInfo: {
          app_name: "ExampleGame",
          art_square: "https://store.example/tall.jpg",
          art_cover: "https://store.example/wide.jpg",
          art_logo: "https://store.example/logo.png",
        },
      }),
      run,
    );

    expect(entry?.art).toEqual({
      portrait: "https://custom.example/cover.jpg",
      hero: "https://custom.example/hero.jpg",
      logo: "https://custom.example/logo.png",
      header: "https://custom.example/wide.jpg",
    });
  });

  test("localart: and file: become paths the host serves, and a relative value stays out", () => {
    const entry = toEntry(
      game({
        art: {
          coverUrl: "localart://metadata-art/sideload_x/cover.jpg",
          heroUrl: "file:///games/hero.jpg",
          logoUrl: "/relative/logo.png",
        },
        metadata: {
          coverSquareUrl: "https://meta.example/square.jpg",
          coverWideUrl: "https://meta.example/wide.jpg",
          logoUrl: "https://meta.example/logo.png",
        },
        gameInfo: {
          app_name: "ExampleGame",
          art_square: "https://store.example/tall.jpg",
          art_cover: "https://store.example/wide.jpg",
        },
      }),
      run,
      "/data/heronite",
    );

    // Heronite's own store wins over the remote fallbacks, and its scheme is not a URL either:
    // `localart://` is relative to `local_library`, `file://` is already absolute.
    expect(entry?.art).toEqual({
      portrait: expect.stringContaining("/data/heronite/local_library/metadata-art/"),
      hero: "/games/hero.jpg",
      logo: "https://meta.example/logo.png",
      header: "https://meta.example/wide.jpg",
    });
    expect(entry?.art?.portrait).toBe(
      join("/data/heronite", "local_library", "metadata-art/sideload_x/cover.jpg"),
    );
  });

  test("without a data root no local art is offered, because none could be served", () => {
    const entry = toEntry(game({ art: { coverUrl: "localart://metadata-art/x/cover.jpg" } }), run);

    expect(entry).not.toHaveProperty("art");
  });

  test("a localart: path that climbs out of local_library is refused", () => {
    const entry = toEntry(
      game({ art: { coverUrl: "localart://../../etc/passwd.png" } }),
      run,
      "/data/heronite",
    );

    expect(entry).not.toHaveProperty("art");
  });

  test("the header slot uses Heronite's headerUrl", () => {
    const entry = toEntry(
      game({ metadata: { headerUrl: "https://shared.example/header.jpg" } }),
      run,
      "/data/heronite",
    );

    expect(entry?.art?.header).toBe("https://shared.example/header.jpg");
  });

  test("portrait prefers tall art and hero prefers wide art", () => {
    const entry = toEntry(
      game({
        metadata: {
          coverSquareUrl: "https://meta.example/square.jpg",
          coverWideUrl: "https://meta.example/wide.jpg",
        },
        gameInfo: {
          app_name: "ExampleGame",
          art_square: "https://store.example/tall.jpg",
          art_cover: "https://store.example/wide.jpg",
          art_background: "https://store.example/bg.jpg",
        },
      }),
      run,
    );

    expect(entry?.art?.portrait).toBe("https://meta.example/square.jpg");
    expect(entry?.art?.hero).toBe("https://meta.example/wide.jpg");
    expect(entry?.art?.header).toBe("https://meta.example/wide.jpg");
  });

  test("the Steam CDN fills slots no other source has", () => {
    const entry = toEntry(game({ steamAppId: "440" }), run);

    expect(entry?.art).toEqual({
      portrait: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/library_600x900.jpg",
      hero: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/library_hero.jpg",
      logo: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/logo.png",
      header: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/header.jpg",
    });
  });

  test("nothing servable means no art object at all", () => {
    const entry = toEntry(
      game({
        art: { coverUrl: "localart://art/x/cover.png" },
        gameInfo: { app_name: "ExampleGame", art_square: "file:///games/tall.jpg" },
      }),
      run,
    );

    expect(entry).not.toHaveProperty("art");
  });
});

describe("toEntry metadata", () => {
  test("collection metadata wins over the store record", () => {
    const entry = toEntry(
      game({
        metadata: {
          description: "Meta description",
          developers: ["Meta Developer"],
          publishers: ["Meta Publisher"],
          genres: ["Meta Genre"],
          releaseDate: "1999-12-31",
        },
        gameInfo: {
          app_name: "ExampleGame",
          developer: "Store Developer",
          description: "Store description",
          extra: {
            genres: ["store-genre"],
            releaseDate: "2020-01-01",
            about: { description: "About description" },
          },
        },
      }),
      run,
    );

    expect(entry?.description).toBe("Meta description");
    expect(entry?.developer).toBe("Meta Developer");
    expect(entry?.publisher).toBe("Meta Publisher");
    expect(entry?.genres).toEqual(["Meta Genre"]);
    expect(entry?.release_year).toBe(1999);
  });

  test("the store record fills what collection metadata lacks", () => {
    const entry = toEntry(
      game({
        gameInfo: {
          app_name: "ExampleGame",
          developer: "Store Developer",
          description: "Store description",
          extra: { genres: ["store-genre"], releaseDate: "2020-01-01" },
        },
      }),
      run,
    );

    expect(entry?.description).toBe("Store description");
    expect(entry?.developer).toBe("Store Developer");
    expect(entry?.publisher).toBeUndefined();
    expect(entry?.genres).toEqual(["store-genre"]);
    expect(entry?.release_year).toBe(2020);
  });

  test("the store's about block is the last description fallback", () => {
    const entry = toEntry(
      game({
        gameInfo: {
          app_name: "ExampleGame",
          extra: { about: { description: "About description" } },
        },
      }),
      run,
    );

    expect(entry?.description).toBe("About description");
  });
});

describe("toEntry platform and ids", () => {
  test("an emulator title takes its profile's platform name", () => {
    const entry = toEntry(
      game({
        local: {
          appName: "ExampleGame",
          launchKind: "emulator",
          emulatorId: "example-emulator",
          emulatorProfileId: "example-ps2",
        },
        emulator: {
          emulator: { id: "example-emulator" },
          profile: { id: "example-ps2", platformName: "PlayStation 2" },
          romPath: "/roms/example.iso",
        },
      }),
      run,
    );

    expect(entry?.platform).toBe("PlayStation 2");
  });

  test("every other title is PC", () => {
    expect(toEntry(game(), run)?.platform).toBe("PC");
  });

  test("gog and legendary runners carry their catalog ids", () => {
    expect(
      toEntry(
        game({ runner: "gog", appName: "1207658999", gameInfo: { app_name: "1207658999" } }),
        run,
      )?.ids,
    ).toEqual({ gog: "1207658999" });

    expect(
      toEntry(
        game({
          runner: "legendary",
          appName: "ExampleEpicApp",
          gameInfo: { app_name: "ExampleEpicApp" },
        }),
        run,
      )?.ids,
    ).toEqual({ epic: "ExampleEpicApp" });
  });

  test("a Steam title carries its app id", () => {
    expect(toEntry(game({ appName: "steam_440", steamAppId: "440" }), run)?.ids).toEqual({
      steam: "440",
    });
  });

  test("a store game's metadata Steam app id is recognition, not identity", () => {
    const entry = toEntry(
      game({
        runner: "legendary",
        appName: "ExampleEpicApp",
        steamAppId: "440",
        local: { appName: "ExampleEpicApp", launchKind: "executable" },
        metadata: { steamAppId: "440" },
      }),
      run,
    );

    expect(entry?.ids).toEqual({ epic: "ExampleEpicApp" });
    // The same app id still feeds art, which the runner did record as this title's Steam copy.
    expect(entry?.art?.portrait).toBe(
      "https://cdn.cloudflare.steamstatic.com/steam/apps/440/library_600x900.jpg",
    );
  });

  test("a store game whose launch kind resolves to Steam carries its Steam id", () => {
    const entry = toEntry(
      game({
        runner: "legendary",
        appName: "ExampleSteamCopyEpic",
        steamAppId: "440",
        local: { appName: "ExampleSteamCopyEpic", launchKind: "steam-uri", steamAppId: "440" },
      }),
      run,
    );

    expect(entry?.ids).toEqual({ steam: "440", epic: "ExampleSteamCopyEpic" });
  });

  test("a title with no catalog id has no ids object", () => {
    expect(toEntry(game(), run)).not.toHaveProperty("ids");
  });
});

describe("toEntry detect", () => {
  test("an executable launch exposes its path and process name", () => {
    const detect = toEntry(
      game({
        local: {
          appName: "ExampleGame",
          launchKind: "executable",
          remappedExecutable: "/games/example/game.exe",
        },
      }),
      run,
    )?.detect;

    expect(detect).toEqual({
      install_dir: "/games/example",
      exe: "/games/example/game.exe",
      process_name: "game.exe",
      env_marker: { key: "HEROIC_APP_NAME", value: "ExampleGame" },
    });
  });

  test("the install path wins over the executable's folder", () => {
    const detect = toEntry(
      game({
        gameInfo: {
          app_name: "ExampleGame",
          install: {
            executable: "/games/example/bin/game.exe",
            install_path: "/games/example-root",
          },
        },
        local: { appName: "ExampleGame", launchKind: "executable" },
      }),
      run,
    )?.detect;

    expect(detect?.install_dir).toBe("/games/example-root");
  });

  test("an emulator launch omits the Heroic env marker", () => {
    const detect = toEntry(
      game({
        local: { appName: "ExampleGame", launchKind: "emulator" },
        emulator: {
          emulator: { id: "example-emulator" },
          profile: { id: "example-ps2", platformName: "PlayStation 2" },
          romPath: "/roms/example.iso",
        },
      }),
      run,
    )?.detect;

    expect(detect).not.toHaveProperty("env_marker");
  });

  test("a Steam URI launch omits the Heroic env marker but keeps the app id", () => {
    const detect = toEntry(
      game({
        appName: "steam_440",
        steamAppId: "440",
        local: { appName: "steam_440", launchKind: "steam-uri", steamAppId: "440" },
      }),
      run,
    )?.detect;

    expect(detect).toEqual({ steam_appid: 440 });
  });

  test("a store launch stamps HEROIC_APP_NAME", () => {
    const detect = toEntry(
      game({
        runner: "legendary",
        appName: "ExampleEpicApp",
        gameInfo: { app_name: "ExampleEpicApp" },
      }),
      run,
    )?.detect;

    expect(detect).toEqual({ env_marker: { key: "HEROIC_APP_NAME", value: "ExampleEpicApp" } });
  });

  test("a launcher or client launch stamps HEROIC_APP_NAME", () => {
    const detect = toEntry(
      game({ local: { appName: "ExampleGame", launchKind: "launcher" } }),
      run,
    )?.detect;

    expect(detect).toEqual({ env_marker: { key: "HEROIC_APP_NAME", value: "ExampleGame" } });
  });
});

describe("toEntry install", () => {
  test("an installed title carries no install object", () => {
    expect(toEntry(game({ installed: true }), run)).not.toHaveProperty("install");
  });

  test("a downloading title is missing with its size", () => {
    const entry = toEntry(
      game({
        installed: false,
        downloading: { params: { appName: "ExampleGame" } },
        sizeBytes: 1024,
      }),
      run,
    );

    expect(entry?.install).toEqual({ state: "missing", size_bytes: 1024 });
  });

  test("a downloading title with no parseable size is still missing", () => {
    const entry = toEntry(
      game({ installed: false, downloading: { params: { appName: "ExampleGame" } } }),
      run,
    );

    expect(entry?.install).toEqual({ state: "missing" });
  });

  test("an installed title stays installed even when a queue element exists", () => {
    const entry = toEntry(
      game({
        installed: true,
        downloading: { params: { appName: "ExampleGame" } },
        sizeBytes: 1024,
      }),
      run,
    );

    expect(entry).not.toHaveProperty("install");
  });
});

describe("buildEntries launch cap", () => {
  test("a title the protocol URL cannot carry is dropped", () => {
    const appName = "a".repeat(200);
    const collection = {
      games: [
        game({
          appName,
          gameInfo: { app_name: appName, runner: "sideload", title: "Long Name" },
          local: { appName, launchKind: "executable", remappedExecutable: "/games/long/game" },
        }),
      ],
    };

    expect(buildEntries(collection, { kind: "open", template: "open" })).toEqual([]);
    expect(buildEntries(collection, run)).toHaveLength(1);
  });
});
