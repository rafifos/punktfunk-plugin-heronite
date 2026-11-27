// The CLI verbs against a throwaway data root: `detect`, `scan --preview` and `paths` all work
// offline, and each transport the assertions see is set up explicitly so a dev box's own
// `heronite-rs` or configured folder cannot change them.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const repoRoot = join(import.meta.dir, "..");
const fixture = join(repoRoot, "test", "fixtures", "heronite-data");
const cli = join(repoRoot, "src", "cli.ts");

/** The fixture's six publishable games, in Collection order. */
const FIXTURE_IDS = [
  "gog:1207658999",
  "legendary:ExampleSteamCopyEpic",
  "nile:amzn1.adg.product.Example",
  "sideload:ExampleSideload",
  "sideload:emu_9f2c1a77b3d84e10",
  "sideload:steam_440",
];

let temp: string;
let dataHome: string;

function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: join(temp, "home"),
      XDG_DATA_HOME: dataHome,
      PUNKTFUNK_CONFIG_DIR: join(temp, "config"),
      // No `heronite-rs` anywhere: the transport falls back to the protocol URL, and the
      // console tile (which needs a known program) is absent.
      PATH: join(temp, "bin"),
    },
  });
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "heronite-cli-"));
  dataHome = join(temp, "data");
  mkdirSync(join(temp, "bin"), { recursive: true });
  cpSync(fixture, join(dataHome, "heronite"), { recursive: true });
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe("cli", () => {
  test("detect reports the fixture root as present", () => {
    const result = run("detect");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("present");
  });

  test("scan --preview prints the fixture games and the window tile", () => {
    const result = run("scan", "--preview");

    expect(result.status).toBe(0);
    const entries = JSON.parse(result.stdout) as ReadonlyArray<{
      external_id: string;
      role?: string;
    }>;
    const games = entries.filter((entry) => entry.role !== "launcher");
    const launchers = entries.filter((entry) => entry.role === "launcher");

    expect(games.map((entry) => entry.external_id)).toEqual(FIXTURE_IDS);
    expect(launchers.map((entry) => entry.external_id)).toEqual(["launcher"]);
  });

  test("paths prints the root, its shape, every file and the counts", () => {
    const result = run("paths");
    const lines = result.stdout.trimEnd().split("\n");
    const root = join(dataHome, "heronite");

    expect(result.status).toBe(0);
    expect(lines).toContain(`data root: ${root} (linux)`);
    expect(lines).toContain("files:");
    expect(lines).toContain(`  found ${join(root, "sideload_apps", "library.json")}`);
    expect(lines).toContain(`  found ${join(root, "store", "download-manager.json")}`);
    expect(lines.filter((line) => line.startsWith("  found "))).toHaveLength(16);
    expect(lines.filter((line) => line.startsWith("  missing "))).toHaveLength(0);
    expect(lines).toContain("entries: 6");
    expect(lines).toContain("launchers: 1");
  });

  test("paths names the transport and warns when it is the protocol fallback", () => {
    // A launch that hands off to the heronite:// handler cannot hold a dedicated display: the
    // handler may not be registered at all, and xdg-open exits before the game appears.
    const lines = run("paths").stdout.trimEnd().split("\n");

    expect(lines).toContain("transport: open");
    expect(lines.some((line) => line.startsWith("warning: ") && line.includes("heronite://"))).toBe(
      true,
    );
  });

  test("paths warns that a running Heronite takes the launch and ends a streamed display", () => {
    // Heronite is single-instance: with one already running (Start with the system), the launched
    // process hands the request over and exits in milliseconds, so a dedicated display dies with
    // it. The operator has to quit Heronite (or turn autostart off) before streaming.
    const programDir = join(temp, "program");
    mkdirSync(programDir, { recursive: true });
    writeFileSync(join(programDir, "heronite-rs"), "");
    mkdirSync(join(temp, "config", "plugin-state", "heronite"), { recursive: true });
    writeFileSync(
      join(temp, "config", "plugin-state", "heronite", "config.json"),
      `${JSON.stringify({ programDir })}\n`,
    );

    const lines = run("paths").stdout.trimEnd().split("\n");

    expect(lines).toContain(`transport: run-program (${join(programDir, "heronite-rs")})`);
    expect(
      lines.some((line) => line.startsWith("warning: ") && line.includes("one instance")),
    ).toBe(true);
  });

  test("with no data root, detect is absent and paths says so", () => {
    dataHome = join(temp, "empty");

    const detected = run("detect");
    const paths = run("paths").stdout.trimEnd().split("\n");

    expect(detected.stdout.trim()).toBe("absent");
    expect(paths).toContain("no Heronite data root found");
    expect(paths).toContain("entries: 0");
    expect(paths).toContain("launchers: 0");
  });
});
