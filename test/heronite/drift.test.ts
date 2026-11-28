// Drift detection against a real Heronite data folder: run the whole pure pipeline and check the
// shape of what comes out, without pinning any title from it. Skipped unless the operator points
// `HERONITE_TEST_DATA_DIR` at a real root, so nothing personal is ever committed.

import { describe, expect, test } from "bun:test";

import { buildEntries } from "../../src/heronite/entries.js";
import { chooseTransport, launcherTiles } from "../../src/heronite/launch.js";
import { assembleCollection } from "../../src/heronite/library.js";

const root = process.env.HERONITE_TEST_DATA_DIR;

/** The protocol fallback keeps the run independent of this machine's PATH. */
const transport = chooseTransport(
  {},
  { platform: "linux", onPath: () => false, exists: () => false },
);

describe.skipIf(root === undefined)("drift against a real Heronite data root", () => {
  test("the pipeline reads it without throwing and every entry is publishable", () => {
    const entries = buildEntries(assembleCollection(root as string), transport);

    for (const entry of entries) {
      expect(entry.external_id).toMatch(/^[a-z]+:.+$/);
      expect(entry.title.trim()).not.toBe("");
      expect(entry.launch?.kind).toBe("exec");
      for (const url of Object.values(entry.art ?? {})) {
        if (url !== null && url !== undefined) expect(url).toMatch(/^https?:\/\//);
      }
      // Install state is Heronite's; the plugin never probes a game file (ADR-0006).
      expect(["installed", "missing"]).toContain(entry.install?.state ?? "installed");
    }

    const tiles = launcherTiles(transport, {});
    expect(tiles.map((tile) => tile.external_id)).toContain("launcher");
  });

  test("no detect hint names Steam itself as the game", () => {
    // Heronite records the Steam client as an installed Steam title's executable. Steam outlives
    // the game, so a hint that matches it keeps the host's session Running after the game quits.
    const entries = buildEntries(assembleCollection(root as string), transport);

    for (const entry of entries) {
      const detect = entry.detect ?? {};
      if (detect.exe !== undefined && detect.exe !== null) {
        expect(detect.exe.toLowerCase()).not.toMatch(/[\\/]steam(\.exe|\.sh)?$/);
      }
      if (detect.process_name !== undefined && detect.process_name !== null) {
        expect(detect.process_name.toLowerCase()).not.toMatch(/^steam(\.exe|\.sh)?$/);
      }
      expect(detect.install_dir).not.toBe("/usr/bin");
    }
  });
});
