// The Hydra library source: Hydra Launcher's games in the host's library, started through
// Hydra so its Wine/Proton setup, playtime and achievements apply. Downloads Hydra runs show
// in the host's Downloads list, and a launch of a title still downloading waits for it.
import * as fs from "node:fs";
import { InstallRefused } from "@punktfunk/plugin-kit";
import { defineLibraryPlugin, dirAccess } from "@punktfunk/plugin-kit/library";
import { Effect, Schema } from "effect";
import {
	type DownloadMemory,
	dbDirs,
	downloadChanges,
	findDb,
	type Launchers,
	launcherEntries,
	readDownloads,
	readLibrary,
	startRefusal,
	toEntries,
} from "./hydra.js";

const HydraConfig = Schema.Struct({
	dataDir: Schema.optionalKey(
		Schema.String.annotate({
			title: "Hydra data folder",
			description:
				"The folder holding Hydra's hydra-db folder. Leave empty to find it automatically.",
		}),
	),
	launcher: Schema.Boolean.annotate({
		title: "Show a Hydra tile",
		description: "Add a tile that opens Hydra's window.",
	}).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(true), {
			encodingStrategy: "omit",
		}),
	),
	bigPicture: Schema.Boolean.annotate({
		title: "Show a Hydra Big Picture tile",
		description: "Add a tile that opens Hydra's controller interface.",
	}).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(true), {
			encodingStrategy: "omit",
		}),
	),
});

/** Inside the sandbox `/usr` is bound, so the packaged binary is visible here. */
const launchers = (): Launchers => ({
	platform: process.platform,
	packaged:
		process.platform === "linux" && fs.existsSync("/usr/bin/hydralauncher"),
});

/** The memory the downloads loop keeps; the install asks read its rows. */
const memory: DownloadMemory = new Map();

const refused = (message: string) =>
	Effect.fail(new InstallRefused({ message }));

export const plugin = defineLibraryPlugin({
	name: "hydra",
	title: "Hydra",
	configSchema: HydraConfig,

	// A folder closed to the runner still counts: `wants` asks the operator for it.
	detect: (cfg) =>
		Effect.sync(() => dbDirs(cfg).some((dir) => dirAccess(dir) !== "missing")),

	scan: (cfg) =>
		Effect.sync(() => {
			const db = findDb(cfg);
			return db ? toEntries(readLibrary(db), launchers()) : [];
		}),

	launchers: (cfg) => launcherEntries(cfg, launchers()),

	wants: dbDirs,

	watchDirs: (cfg) => {
		const db = findDb(cfg);
		return db ? [db] : [];
	},

	downloads: (reporter, config) =>
		Effect.gen(function* () {
			for (;;) {
				const cfg = yield* config.pipe(Effect.orElseSucceed(() => ({})));
				const db = findDb(cfg);
				if (db) {
					const downloads = yield* Effect.try(() => readDownloads(db)).pipe(
						Effect.orElseSucceed(() => undefined),
					);
					if (downloads) {
						for (const row of downloadChanges(downloads, memory, Date.now())) {
							reporter.set(row);
						}
					}
				}
				yield* Effect.sleep("2 seconds");
			}
		}),

	install: {
		start: ({ externalId }, cfg) =>
			Effect.gen(function* () {
				const db = findDb(cfg);
				const game = db ? readLibrary(db).games.get(externalId) : undefined;
				const why = startRefusal(game, memory.get(externalId)?.row);
				if (why) return yield* refused(why);
			}),
		pause: () => refused("Hydra runs this download. Pause it in Hydra."),
		cancel: () => refused("Hydra runs this download. Cancel it in Hydra."),
		uninstall: () => refused("Remove the game's files in Hydra."),
	},
});
