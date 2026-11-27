// The two streaming switches, shared between the plugin's settings and the shell hooks.
//
// A hook runs as a child of the host, with the host's environment, so it cannot read the plugin's
// settings directly. The plugin therefore writes this one-line-per-flag file into its own state
// folder, which the sandbox binds read-write, and the hooks test it with `grep -qx`. Plain text,
// no JSON parser, no `eval`: a hook has to stay a few lines of POSIX shell.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** What the settings say. Both default to on, which is the behaviour before they existed. */
interface StreamFlags {
  readonly stopDesktopClients: boolean;
  readonly captureDiagnostics: boolean;
}

/** `1` or `0`, because a hook compares whole lines and nothing else. */
const bit = (on: boolean): string => (on ? "1" : "0");

/** The file the hooks read. Kept separate from `config.json`, which is the host's format. */
const flagsText = (flags: StreamFlags): string =>
  `stop_desktop=${bit(flags.stopDesktopClients)}\ncapture=${bit(flags.captureDiagnostics)}\n`;

/**
 * Where the file goes. The sandbox sets `PUNKTFUNK_CONFIG_DIR` to its own root, so the path is
 * correct inside the sandbox and on a workstation without either side knowing about the other.
 */
const flagsPath = (env: NodeJS.ProcessEnv = process.env): string => {
  const home = env.HOME ?? "/tmp";
  const config = env.PUNKTFUNK_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return join(config, "plugin-state", "heronite", "stream-flags");
};

/**
 * Writes the file when its contents differ, and never throws: a plugin that cannot write its flags
 * must still serve a library. A failed write leaves the previous file, which keeps the hooks on
 * their last known setting instead of on a default.
 */
const writeStreamFlags = (flags: StreamFlags, env: NodeJS.ProcessEnv = process.env): void => {
  const file = flagsPath(env);
  const text = flagsText(flags);
  try {
    if (readFileSync(file, "utf8") === text) return;
  } catch {
    // No file yet, or unreadable: write it below.
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  } catch {
    // Nothing to report: the hooks fall back to their own defaults.
  }
};

export { flagsPath, flagsText, type StreamFlags, writeStreamFlags };
