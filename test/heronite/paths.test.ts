// Data-root resolution: the four install shapes the plan names, with the platform, home and
// environment injected so the tests never read the machine they run on.

import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  dataPaths,
  dataRootPresent,
  dataRoots,
  defaultRoots,
  dirAccess,
  findDataRoot,
  watchDirs,
} from "../../src/heronite/paths.js";

const HOME = "/home/example";
const FLATPAK_ROOT = `${HOME}/.var/app/app.heronite.Heronite/data/heronite`;

const linux = { platform: "linux" as const, home: HOME, env: {} };

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "heronite-paths-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("dataRoots", () => {
  test("Linux lists the native data folder, then the Flatpak one", () => {
    expect(dataRoots({}, linux)).toEqual([
      { root: `${HOME}/.local/share/heronite`, shape: "linux", flatpak: false },
      { root: FLATPAK_ROOT, shape: "flatpak", flatpak: true },
    ]);
  });

  test("XDG_DATA_HOME replaces the native folder", () => {
    const roots = dataRoots({}, { ...linux, env: { XDG_DATA_HOME: "/xdg/data" } });
    expect(roots.map((candidate) => candidate.root)).toEqual(["/xdg/data/heronite", FLATPAK_ROOT]);
  });

  test("Flatpak's own XDG_DATA_HOME does not duplicate the Flatpak root", () => {
    const roots = dataRoots(
      {},
      { ...linux, env: { XDG_DATA_HOME: `${HOME}/.var/app/app.heronite.Heronite/data` } },
    );
    expect(roots).toEqual([{ root: FLATPAK_ROOT, shape: "flatpak", flatpak: true }]);
  });

  test("a configured folder comes first and keeps the configured shape", () => {
    const roots = dataRoots({ dataFolder: "/media/heronite-data" }, linux);
    expect(roots[0]).toEqual({
      root: "/media/heronite-data",
      shape: "configured",
      flatpak: false,
    });
    expect(roots).toHaveLength(3);
  });

  test("a configured folder inside the Flatpak tree is still flagged Flatpak", () => {
    expect(dataRoots({ dataFolder: `${FLATPAK_ROOT}/profile` }, linux)[0]).toEqual({
      root: `${FLATPAK_ROOT}/profile`,
      shape: "configured",
      flatpak: true,
    });
  });

  test("Windows uses the installer default under %APPDATA%", () => {
    const roots = dataRoots({}, { platform: "win32", home: "C:\\Users\\example", env: {} });
    expect(roots).toEqual([
      {
        root: "C:\\Users\\example\\AppData\\Roaming\\heronite\\data",
        shape: "windows",
        flatpak: false,
      },
    ]);
  });

  test("Windows honours an APPDATA override", () => {
    const roots = dataRoots(
      {},
      { platform: "win32", home: "C:\\Users\\example", env: { APPDATA: "D:\\Roaming" } },
    );
    expect(roots[0]?.root).toBe("D:\\Roaming\\heronite\\data");
  });
});

describe("dirAccess", () => {
  test("reports a readable directory as ok, a missing path as missing", () => {
    const dir = tempDir();
    expect(dirAccess(dir)).toBe("ok");
    expect(dirAccess(join(dir, "absent"))).toBe("missing");
  });

  test("reports a directory it cannot list as denied", () => {
    const dir = join(tempDir(), "closed");
    mkdirSync(dir);
    chmodSync(dir, 0o000);
    try {
      expect(dirAccess(dir)).toBe("denied");
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});

describe("findDataRoot", () => {
  test("picks the first readable candidate", () => {
    const home = tempDir();
    const native = join(home, ".local", "share", "heronite");
    mkdirSync(native, { recursive: true });
    expect(findDataRoot({}, { ...linux, home })).toEqual({
      root: native,
      shape: "linux",
      flatpak: false,
    });
  });

  test("a configured folder wins over a readable default", () => {
    const home = tempDir();
    const configured = join(home, "my-heronite");
    mkdirSync(configured, { recursive: true });
    mkdirSync(join(home, ".local", "share", "heronite"), { recursive: true });
    expect(findDataRoot({ dataFolder: configured }, { ...linux, home })).toEqual({
      root: configured,
      shape: "configured",
      flatpak: false,
    });
  });

  test("returns nothing when no candidate is readable", () => {
    expect(findDataRoot({}, linux)).toBeUndefined();
  });
});

describe("dataRootPresent", () => {
  test("is false when nothing exists", () => {
    expect(dataRootPresent({}, linux)).toBe(false);
  });

  test("is true for a closed folder even though findDataRoot skips it", () => {
    const home = tempDir();
    const closed = join(home, "closed");
    mkdirSync(closed);
    chmodSync(closed, 0o000);
    try {
      expect(dataRootPresent({ dataFolder: closed }, { ...linux, home })).toBe(true);
      expect(findDataRoot({ dataFolder: closed }, { ...linux, home })).toBeUndefined();
    } finally {
      chmodSync(closed, 0o700);
    }
  });
});

describe("dataPaths", () => {
  test("lists every file the plan reads, all under the root", () => {
    const root = "/data/heronite";
    expect(dataPaths(root)).toEqual({
      sideloadLibrary: join(root, "sideload_apps/library.json"),
      epicLibrary: join(root, "store_cache/legendary_library.json"),
      gogLibrary: join(root, "store_cache/gog_library.json"),
      amazonLibrary: join(root, "store_cache/nile_library.json"),
      gogInstalled: join(root, "gog_store/installed.json"),
      steamLibrary: join(root, "store_cache/steam_library.json"),
      storeConfig: join(root, "store/config.json"),
      localLibrary: join(root, "local_library/library.json"),
      metadata: join(root, "local_library/metadata.json"),
      art: join(root, "local_library/art.json"),
      emulators: join(root, "local_library/emulators.json"),
      copies: join(root, "local_library/copies.json"),
      sessions: join(root, "local_library/sessions.json"),
      statuses: join(root, "local_library/statuses.json"),
      timestamp: join(root, "store/timestamp.json"),
      downloadManager: join(root, "store/download-manager.json"),
    });
  });
});

describe("watchDirs", () => {
  test("watches the folders Heronite rewrites while the plugin runs", () => {
    const root = "/data/heronite";
    expect(watchDirs(root)).toEqual([
      join(root, "sideload_apps"),
      join(root, "store_cache"),
      join(root, "gog_store"),
      join(root, "store"),
      join(root, "local_library"),
    ]);
  });
});

describe("defaultRoots", () => {
  test("returns the two Linux roots for the manifest's reads", () => {
    expect(defaultRoots({ home: HOME, env: {} })).toEqual([
      `${HOME}/.local/share/heronite`,
      `${HOME}/.var/app/app.heronite.Heronite/data/heronite`,
    ]);
  });

  test("honours XDG_DATA_HOME for the native root", () => {
    expect(defaultRoots({ home: HOME, env: { XDG_DATA_HOME: "/xdg/data" } })).toEqual([
      "/xdg/data/heronite",
      `${HOME}/.var/app/app.heronite.Heronite/data/heronite`,
    ]);
  });
});
