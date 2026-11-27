// Heronite's identities, in one place. Every module builds and splits them through these helpers
// so the Collection view, the download queue and the per-game tab cannot drift apart.

/** The plugin id the host prefixes onto every library id this plugin publishes. */
export const PLUGIN_ID = "heronite";

/** Runners whose own store client starts the game; they need no launch overlay. */
export const STORE_RUNNERS: ReadonlySet<string> = new Set(["legendary", "gog", "nile"]);

/** `<runner>:<appName>`, the provider entry's external id (ADR-0004). */
export function entryId(runner: string, appName: string): string {
  return `${runner}:${appName}`;
}

/**
 * Splits a provider entry's external id at its first colon (ADR-0004). Both halves must be
 * non-empty; an app name may contain further colons.
 */
export function parseEntryId(id: string): { runner: string; appName: string } | undefined {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) return undefined;
  return { runner: id.slice(0, separator), appName: id.slice(separator + 1) };
}

/** The key Heronite's overlay data uses: `<runner>:<appName>`, with Zoom stored under `sideload`. */
export function metadataKey(runner: string, appName: string): string {
  return entryId(runner === "zoom" ? "sideload" : runner, appName);
}

/** Heronite's in-memory Collection key: `<runner>_<appName>`. */
export function collectionKey(runner: string, appName: string): string {
  return `${runner}_${appName}`;
}

/** Splits a Collection key at its first underscore; the app name keeps any underscores after it. */
export function parseCollectionKey(key: string): { runner: string; appName: string } | undefined {
  const separator = key.indexOf("_");
  if (separator <= 0 || separator === key.length - 1) return undefined;
  return { runner: key.slice(0, separator), appName: key.slice(separator + 1) };
}
