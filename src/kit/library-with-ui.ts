// `defineLibraryPlugin` owns the only `serveUi` call, so it cannot serve a per-game tab. This
// composes the kit's exported pieces instead — config service, provider client, sync engine, access
// requests, `serveUi` and the CLI — reproducing its behaviour plus one game section.
// `@punktfunk/plugin-kit` is pinned to 0.15.0 because this layer follows its internals.

import type { EventOf, GameRef } from "@punktfunk/host/core";
import type { CliCommand, ConfigService, ServeUiGame } from "@punktfunk/plugin-kit";
import type {
  LibraryInstall,
  LibraryPlugin,
  LibraryPluginDef,
  ScanReport,
} from "@punktfunk/plugin-kit/library";
import type { ProviderEntry } from "@punktfunk/plugin-kit/wire";

import { readFileSync, writeFileSync } from "node:fs";

import {
  type AccessRequestOutcome,
  type AccessRequestPath,
  DEFAULT_FS_CHANGE_MIN_INTERVAL,
  type DownloadReporter,
  definePluginKit,
  downloadReporter,
  HostClient,
  type InstallAction,
  type InstallAsk,
  makeConfigService,
  makeSyncEngine,
  type PluginInfo,
  type PluginKitDef,
  ProviderClient,
  type ProviderClientService,
  requestAccess,
  runPluginCli,
  type ServeUiInstall,
  serveUi,
  unreachable,
} from "@punktfunk/plugin-kit";
import {
  diffParity,
  formatParityReport,
  fromHostEntry,
  fromProviderEntry,
  type HostGameEntry,
  type ParityReport,
} from "@punktfunk/plugin-kit/library";
import { Duration, Effect, Schema, Stream } from "effect";

/** {@link ServeUiInstall}, with the plugin's config as each handler's second argument. */
const withConfig = <Cfg>(
  install: LibraryInstall<Cfg>,
  config: Effect.Effect<Cfg, unknown>,
): ServeUiInstall => {
  const ask =
    (action: InstallAction) =>
    (a: InstallAsk): Effect.Effect<void, unknown> =>
      config.pipe(Effect.flatMap((cfg) => install[action](a, cfg)));
  return {
    start: ask("start"),
    pause: ask("pause"),
    cancel: ask("cancel"),
    uninstall: ask("uninstall"),
  };
};

/** `--flag value` from an argv slice, or undefined. */
const flagValue = (argv: readonly string[], flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

/** Sort by path; the kit keeps this helper private. */
const byPath = <T extends string | AccessRequestPath>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) =>
    (typeof a === "string" ? a : a.path).localeCompare(typeof b === "string" ? b : b.path),
  );

/** One line per folder the host answered; a launcher that is simply not installed stays quiet. */
const logOutcomes = (outcomes: readonly AccessRequestOutcome[]) =>
  Effect.forEach(
    outcomes,
    ({ path, outcome }) => {
      if (outcome === "pending") return Effect.logInfo(`asked the operator for ${path}`);
      if (outcome === "denied") return Effect.logInfo(`the operator did not allow ${path}`);
      if (outcome === "granted") {
        return Effect.logWarning(
          `${path} is allowed but not visible to this plugin — a folder that appeared after the runner started needs a runner restart`,
        );
      }
      if (outcome === "refused:not_directory") return Effect.void;
      return Effect.logInfo(`the host won't offer ${path} (${outcome.replace(/^refused:/, "")})`);
    },
    { discard: true },
  );

/**
 * Ask for the wanted folders the plugin can't reach, once per distinct set, then scan. A request
 * the host never answered is asked again on the next scan; it never fails the scan.
 */
const accessAwareCompute = <Cfg, A, E, R>(
  wants: ((cfg: Cfg) => readonly (string | AccessRequestPath)[]) | undefined,
  title: string,
  load: Effect.Effect<Cfg, E, R>,
  compute: (cfg: Cfg) => Effect.Effect<A, E, R>,
): (() => Effect.Effect<A, E, R | HostClient>) => {
  let lastAsked: string | undefined;
  return () =>
    load.pipe(
      Effect.flatMap((cfg) => {
        const dirs = byPath(unreachable(wants?.(cfg) ?? []));
        const key = JSON.stringify(dirs);
        if (key === lastAsked) return compute(cfg);
        if (dirs.length === 0) {
          lastAsked = key;
          return compute(cfg);
        }
        return requestAccess(dirs, title).pipe(
          Effect.tap((outcomes) => {
            if (outcomes.length === dirs.length) lastAsked = key;
            return logOutcomes(outcomes);
          }),
          Effect.andThen(compute(cfg)),
        );
      }),
    );
};

/** {@link LibraryPluginDef}, plus the per-game section the kit's own factory cannot serve. */
export interface LibraryPluginWithUiDef<S extends Schema.Top> extends LibraryPluginDef<S> {
  /**
   * The tab on each library entry. The factory receives the plugin's config service so a later
   * milestone can read settings without changing this module's signature.
   */
  readonly game?: (config: ConfigService<S>) => ServeUiGame<Schema.Top>;
}

/** A parity capture that could not be read or written, with the file it concerned. */
export class ParitySnapshotError extends Schema.TaggedError<ParitySnapshotError>()(
  "ParitySnapshotError",
  {
    operation: Schema.Literals(["read", "write"]),
    path: Schema.String,
    cause: Schema.String,
  },
) {}

/**
 * Read a `parity --snapshot` capture and diff it against freshly produced entries. Split out of
 * the CLI so the release gate is testable without a running host.
 */
export const compareParitySnapshot = Effect.fnUntraced(function* (
  baseline: string,
  store: string,
  entries: readonly ProviderEntry[],
): Effect.fn.Return<ParityReport, ParitySnapshotError> {
  const captured = yield* Effect.try({
    try: () =>
      JSON.parse(readFileSync(baseline, "utf8")) as readonly ReturnType<typeof fromHostEntry>[],
    catch: (cause) =>
      new ParitySnapshotError({ operation: "read", path: baseline, cause: String(cause) }),
  });
  return diffParity(
    captured,
    entries.map((entry) => fromProviderEntry(store, entry)),
  );
});

/**
 * Build a library plugin whose scans reconcile dynamic folder requests and whose UI carries one
 * per-game section. Mirrors `defineLibraryPlugin`'s defaults and CLI verbs.
 */
export const defineLibraryPluginWithUi = <S extends Schema.Top>(
  def: LibraryPluginWithUiDef<S>,
): LibraryPlugin => {
  const store = def.store === null ? undefined : (def.store ?? def.name);
  const poll = def.pollInterval ?? Duration.minutes(15);
  const debounce = def.debounce ?? Duration.seconds(3);
  const minInterval = def.minInterval ?? DEFAULT_FS_CHANGE_MIN_INTERVAL;

  /** The config service, built fresh wherever it is needed (it only requires `PluginInfo`). */
  const config: Effect.Effect<ConfigService<S>, never, PluginInfo> = makeConfigService({
    schema: def.configSchema,
  });

  /** Scan + launcher entries, in the order they should reach the host. */
  const computeEntries = Effect.fnUntraced(function* (cfg: S["Type"]): Effect.fn.Return<{
    readonly entries: readonly ProviderEntry[];
    readonly report: ScanReport;
  }> {
    const present = yield* def.detect(cfg);
    // A launcher that isn't installed contributes NOTHING — not even its launcher entries. A
    // "Steam Big Picture" tile on a box without Steam would only fail to launch.
    if (!present) {
      return {
        entries: [] as readonly ProviderEntry[],
        report: { entries: 0, launchers: 0, present: false } as const,
      };
    }
    const scanned = yield* def.scan(cfg);
    const launchers = def.launchers?.(cfg) ?? [];
    return {
      entries: [...scanned, ...launchers],
      report: {
        entries: scanned.length,
        launchers: launchers.length,
        present: true,
      } as const,
    };
  });

  /**
   * Push one entry set to the host under the store claim, warning **once** if the host is too old
   * to honour it: an old host would silently list this source's titles as unbadged `custom:`
   * entries beside the built-in scanner's identical ones.
   */
  const applyEntries =
    (provider: ProviderClientService, state: { warned: boolean }) =>
    (entries: readonly ProviderEntry[]): Effect.Effect<void, unknown> =>
      provider.reconcile(def.name, entries, store).pipe(
        Effect.tap((echoed) => {
          if (!store || state.warned || echoed.length === 0) return Effect.void;
          if (echoed.some((e) => e.store === store)) return Effect.void;
          state.warned = true;
          return Effect.logWarning(
            `host is too old for store claims: this source's games will appear as custom ` +
              `entries and the host's own "${store}" scanner is not suppressed, so titles ` +
              `may be listed twice. Updating the host resolves it.`,
          );
        }),
        Effect.asVoid,
      );

  const main = Effect.gen(function* () {
    const cfgService = yield* config;
    const provider = yield* ProviderClient;
    const state = { warned: false };
    const compute = accessAwareCompute(
      def.wants,
      def.title ?? def.name,
      cfgService.load,
      computeEntries,
    );

    const engine = yield* makeSyncEngine<ScanReport, readonly ProviderEntry[], HostClient>({
      compute,
      apply: applyEntries(provider, state),
      // The host IS the state: a full-replace reconcile is idempotent, so nothing is persisted
      // between runs, and every sync pushes — which also covers a host reinstalled underneath us.
      lastSync: { get: Effect.succeed(undefined), set: () => Effect.void },
      settings: cfgService.load.pipe(
        Effect.map((cfg) => def.watchDirs?.(cfg) ?? []),
        // A config file that won't decode must not stop the poll loop: fall back to no watch dirs
        // and keep the timer running.
        Effect.catch(() => Effect.succeed([] as readonly string[])),
        Effect.map((watchDirs) => ({
          pollInterval: poll,
          watch: true,
          debounce,
          minInterval,
          watchDirs,
        })),
      ),
    });

    // The UI server serves `__config` (and the SDK's `__health`), plus the game section, `__hold`
    // and `__install` when the definition asks for them: no `staticDir`, no API. The `library`
    // category keeps installed scanners out of the console's sidebar.
    const game = def.game?.(cfgService);
    const launching = def.holds?.["game.launching"];
    yield* serveUi({
      title: def.title ?? def.name,
      category: "library",
      config: { schema: def.configSchema, service: cfgService },
      ...(game === undefined ? {} : { game }),
      ...(launching === undefined
        ? {}
        : {
            holds: {
              "game.launching": (g: GameRef, event: EventOf<"game.launching">) =>
                cfgService.load.pipe(Effect.flatMap((cfg) => launching(g, cfg, event))),
            },
          }),
      ...(def.holdTimeoutMs === undefined ? {} : { holdTimeoutMs: def.holdTimeoutMs }),
      ...(def.install === undefined ? {} : { install: withConfig(def.install, cfgService.load) }),
    });
    if (def.downloads !== undefined) {
      const reporter: DownloadReporter = yield* downloadReporter(def.name);
      yield* Effect.forkScoped(def.downloads(reporter, cfgService.load));
    }

    yield* engine.start;
    // A saved settings change is exactly when a user expects the library to update — and it may
    // have changed `watchDirs`, so re-read settings rather than just re-syncing.
    yield* Effect.forkScoped(Stream.runForEach(cfgService.changes, () => engine.reconfigure));
    yield* Effect.never;
  });

  const kitDef: PluginKitDef<never, ProviderClient> = {
    name: def.name,
    ...(def.version === undefined ? {} : { version: def.version }),
    layer: ProviderClient.layer,
    main: main as Effect.Effect<void, never, ProviderClient | HostClient | PluginInfo | never>,
  };

  const standardCommands: Record<string, CliCommand<ProviderClient>> = {
    detect: {
      summary: "report whether this launcher is installed on the host",
      // Offline on purpose: "is it here?" must be answerable without a running host.
      offline: true,
      run: () =>
        Effect.gen(function* () {
          const cfg = yield* (yield* config).load;
          console.log((yield* def.detect(cfg)) ? "present" : "absent");
        }),
    },
    scan: {
      summary: "scan and print what WOULD be synced (--preview for the JSON entries)",
      // Also offline: the point is to debug a scanner against real launcher files without
      // touching the host's library.
      offline: true,
      run: (argv) =>
        Effect.gen(function* () {
          const cfg = yield* (yield* config).load;
          const { entries, report } = yield* computeEntries(cfg);
          if (argv.includes("--preview")) {
            console.log(JSON.stringify(entries, null, 2));
          } else {
            console.log(
              `${report.present ? "present" : "absent"}: ${report.entries} games, ` +
                `${report.launchers} launcher entries`,
            );
          }
        }),
    },
    parity: {
      summary: "prove this plugin reproduces the built-in scanner (--snapshot <f> | --compare <f>)",
      // `--compare` runs THIS plugin's scan and reads no host library; `--snapshot` does. The verb
      // is registered online (no `offline`), so both flags connect to the host first.
      run: (argv) =>
        Effect.gen(function* () {
          const snapshot = flagValue(argv, "--snapshot");
          const compare = flagValue(argv, "--compare");
          if (snapshot === undefined && compare === undefined) {
            console.error(
              "usage: parity --snapshot <file>   (capture the host's CURRENT library for this store)\n" +
                "       parity --compare  <file>   (diff this plugin's scan against that capture)",
            );
            process.exitCode = 2;
            return;
          }
          if (snapshot !== undefined) {
            // The baseline: what the host reports for THIS store. Capture it from a host whose
            // built-in scanner still serves the store, before installing the plugin.
            const host = yield* HostClient;
            const body = yield* host.request("GET", "/library");
            const mine = (Array.isArray(body) ? (body as HostGameEntry[]) : [])
              .filter((e) => e.store === (store ?? def.name))
              .map(fromHostEntry)
              .sort((a, b) => a.id.localeCompare(b.id));
            yield* Effect.try({
              try: () => writeFileSync(snapshot, `${JSON.stringify(mine, null, 2)}\n`),
              catch: (cause) =>
                new ParitySnapshotError({
                  operation: "write",
                  path: snapshot,
                  cause: String(cause),
                }),
            });
            console.log(`captured ${mine.length} "${store ?? def.name}" entries to ${snapshot}`);
            return;
          }
          const cfg = yield* (yield* config).load;
          const { entries } = yield* computeEntries(cfg);
          // The usage guard above leaves exactly one of the two flags set.
          const report = yield* compareParitySnapshot(
            compare as string,
            store ?? def.name,
            entries,
          );
          console.log(formatParityReport(report));
          // A non-zero exit is what makes this usable as a release gate rather than a report
          // somebody skims.
          if (!report.ok) process.exitCode = 1;
        }),
    },
    uninstall: {
      summary: "remove this source's games from the host and release its store claim",
      run: () =>
        Effect.gen(function* () {
          const provider = yield* ProviderClient;
          // The empty reconcile clears the entries; DELETE is what releases the CLAIM, which
          // brings back a host's built-in scanner for the store, where one exists.
          yield* provider.reconcile(def.name, [], undefined);
          yield* provider.remove(def.name);
          console.log(`${def.name}: entries removed, store claim released`);
        }),
    },
  };

  return {
    def: definePluginKit(kitDef),
    cli: (argv) =>
      runPluginCli({
        def: kitDef,
        commands: {
          ...standardCommands,
          ...(def.commands ?? {}),
        } as Record<string, CliCommand<ProviderClient>>,
        ...(argv === undefined ? {} : { argv }),
      }),
  };
};
