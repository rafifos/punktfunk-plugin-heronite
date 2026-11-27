import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { flagsPath, flagsText, writeStreamFlags } from "../../src/heronite/stream-flags.js";

describe("stream flags", () => {
  test("writes one whole-line flag per setting, which is what the hook greps", () => {
    expect(flagsText({ stopDesktopClients: true, captureDiagnostics: false })).toBe(
      "stop_desktop=1\ncapture=0\n",
    );
  });

  test("resolves through PUNKTFUNK_CONFIG_DIR, the root the sandbox sets", () => {
    expect(flagsPath({ PUNKTFUNK_CONFIG_DIR: "/run/punktfunk" })).toBe(
      "/run/punktfunk/plugin-state/heronite/stream-flags",
    );
  });

  test("resolves through XDG_CONFIG_HOME outside the sandbox", () => {
    expect(flagsPath({ XDG_CONFIG_HOME: "/home/x/.config" })).toBe(
      "/home/x/.config/plugin-state/heronite/stream-flags",
    );
  });

  test("writes the file, then leaves it alone when the contents already match", () => {
    const root = mkdtempSync(join(tmpdir(), "stream-flags-"));
    const env = { PUNKTFUNK_CONFIG_DIR: root };
    writeStreamFlags({ stopDesktopClients: true, captureDiagnostics: true }, env);
    const file = flagsPath(env);
    expect(readFileSync(file, "utf8")).toBe("stop_desktop=1\ncapture=1\n");
    // A second write of the same values is a no-op rather than a rewrite.
    writeStreamFlags({ stopDesktopClients: false, captureDiagnostics: true }, env);
    expect(readFileSync(file, "utf8")).toBe("stop_desktop=0\ncapture=1\n");
  });
});
