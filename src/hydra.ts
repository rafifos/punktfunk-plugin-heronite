// Hydra's library as the host sees it: where Hydra keeps its data, what its records say, and
// the entry and download row each one becomes. Hydra 4.x, `src/main/level` in hydralauncher/hydra.
import * as os from "node:os";
import * as path from "node:path";
import type { DownloadRow } from "@punktfunk/plugin-kit";
import { dirAccess, listDir, steamCdnUrl } from "@punktfunk/plugin-kit/library";
import type { ProviderEntry } from "@punktfunk/plugin-kit/wire";
import { readLevelDb } from "./leveldb.js";

export interface HydraGame {
	readonly title?: string;
	readonly objectId?: string;
	readonly shop?: string;
	readonly isDeleted?: boolean;
	readonly executablePath?: string | null;
	readonly iconUrl?: string | null;
	readonly libraryHeroImageUrl?: string | null;
	readonly logoImageUrl?: string | null;
	readonly customCoverImageUrl?: string | null;
	readonly customHeroImageUrl?: string | null;
	readonly customLogoImageUrl?: string | null;
	readonly platform?: string | null;
	readonly discs?: ReadonlyArray<{ readonly path?: string }>;
	readonly selectedDiscPath?: string | null;
}

export interface HydraDownload {
	readonly downloadPath?: string;
	readonly folderName?: string | null;
	readonly bytesDownloaded?: number;
	readonly fileSize?: number | null;
	readonly status?: string | null;
	readonly queued?: boolean;
	readonly extracting?: boolean;
	readonly extractionProgress?: number;
}

export interface HydraAssets {
	readonly coverImageUrl?: string | null;
	readonly libraryImageUrl?: string | null;
	readonly libraryHeroImageUrl?: string | null;
	readonly logoImageUrl?: string | null;
}

/** A download record and the sequence of its last write. */
export interface Seen<T> {
	readonly seq: number;
	readonly record: T;
}

export interface HydraLibrary {
	readonly games: Map<string, HydraGame>;
	readonly downloads: Map<string, Seen<HydraDownload>>;
	readonly assets: Map<string, HydraAssets>;
}

/** `[A-Za-z0-9._-]`, the host's `id` parameter class for the run link's values. */
const ID = /^[A-Za-z0-9._-]{1,128}$/;
const NOT_A_USER = new Set(["public", "default", "default user", "all users"]);

/** Hydra's data folders: the configured one, then Linux's, then every Windows profile's. */
export const dataDirs = (cfg: { dataDir?: string }): string[] => {
	const home = os.homedir();
	const xdg = process.env.XDG_CONFIG_HOME;
	const users = `${process.env.SystemDrive ?? "C:"}\\Users`;
	const configured = cfg.dataDir?.trim();
	return [
		...(configured ? [configured] : []),
		...(process.platform === "win32"
			? listDir(users)
					.filter((name) => !NOT_A_USER.has(name.toLowerCase()))
					.map((name) =>
						path.join(users, name, "AppData", "Roaming", "hydralauncher"),
					)
			: [
					...(xdg ? [path.join(xdg, "hydralauncher")] : []),
					path.join(home, ".config", "hydralauncher"),
					path.join(
						home,
						"snap",
						"hydralauncher",
						"current",
						".config",
						"hydralauncher",
					),
				]),
	];
};

/** Every `hydra-db` folder Hydra may use, reachable or not. */
export const dbDirs = (cfg: { dataDir?: string }): string[] => [
	...new Set(dataDirs(cfg).map((dir) => path.join(dir, "hydra-db"))),
];

/** The first `hydra-db` this process can read. */
export const findDb = (cfg: { dataDir?: string }): string | undefined =>
	dbDirs(cfg).find((dir) => dirAccess(dir) === "ok");

const parsed = <T>(value: string): T | undefined => {
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
};

/** Records under one sublevel, keyed `<shop>:<objectId>` as Hydra keys them. */
const sublevel = <T>(
	rows: ReturnType<typeof readLevelDb>,
	name: string,
): Map<string, Seen<T>> => {
	const prefix = `!${name}!`;
	const out = new Map<string, Seen<T>>();
	for (const [key, row] of rows) {
		if (!key.startsWith(prefix)) continue;
		const record = parsed<T>(row.value);
		if (record) out.set(key.slice(prefix.length), { seq: row.seq, record });
	}
	return out;
};

const records = <T>(seen: Map<string, Seen<T>>): Map<string, T> =>
	new Map([...seen].map(([key, { record }]) => [key, record]));

export const readLibrary = (db: string): HydraLibrary => {
	const rows = readLevelDb(db, ["!games!", "!downloads!", "!gameShopAssets!"]);
	return {
		games: records(sublevel<HydraGame>(rows, "games")),
		downloads: sublevel<HydraDownload>(rows, "downloads"),
		assets: records(sublevel<HydraAssets>(rows, "gameShopAssets")),
	};
};

export const readDownloads = (db: string): Map<string, Seen<HydraDownload>> =>
	sublevel<HydraDownload>(readLevelDb(db, ["!downloads!"]), "downloads");

const http = (v: string | null | undefined): string | undefined =>
	v && /^https?:\/\//.test(v) ? v : undefined;

/** The ROM a classics title starts from, the way Hydra picks it. */
const romOf = (g: HydraGame): string | undefined =>
	g.selectedDiscPath || g.discs?.find((d) => d.path)?.path || undefined;

/** The file Hydra starts the title from; none means its files aren't ready. */
export const runnable = (g: HydraGame): string | undefined =>
	g.shop === "launchbox" ? romOf(g) : g.executablePath || undefined;

/** Which manifest templates this host's install can use. */
export interface Launchers {
	readonly platform: NodeJS.Platform;
	/** Hydra's own binary is on `PATH`: the deb, rpm and AUR packages. */
	readonly packaged: boolean;
}

const gameTemplate = ({ platform, packaged }: Launchers) =>
	platform === "win32" ? "open-windows" : packaged ? "run" : "open";

const detectOf = (
	g: HydraGame,
	file: string,
	d: HydraDownload | undefined,
	launchers: Launchers,
): ProviderEntry["detect"] => {
	if (g.shop === "launchbox") return { install_dir: path.dirname(file) };
	// A launcher exe often starts the real game from a subfolder of the download.
	const folder =
		d?.downloadPath && d.folderName
			? path.join(d.downloadPath, d.folderName)
			: undefined;
	const umu = launchers.platform === "linux" && /\.exe$/i.test(file);
	return {
		install_dir:
			folder && file.startsWith(folder + path.sep)
				? folder
				: path.dirname(file),
		exe: file,
		// Hydra runs Windows games on Linux through umu, which stamps this on the game.
		...(umu
			? { env_marker: { key: "GAMEID", value: `umu-${g.objectId}` } }
			: {}),
	};
};

/**
 * Every title with files on disk, and every one Hydra is still downloading. A title Hydra
 * only lists, with no download, has nothing the host could start or wait for.
 */
export const toEntries = (
	lib: HydraLibrary,
	launchers: Launchers,
): ProviderEntry[] => {
	const out: ProviderEntry[] = [];
	for (const [key, g] of lib.games) {
		if (g.isDeleted || !g.shop || !g.objectId) continue;
		if (!ID.test(g.shop) || !ID.test(g.objectId)) continue;
		const download = lib.downloads.get(key)?.record;
		const file = runnable(g);
		if (!file && (!download || download.status === "removed")) continue;
		const a = lib.assets.get(key);
		const appid = g.shop === "steam" ? Number(g.objectId) : Number.NaN;
		const steam = (kind: "portrait" | "hero" | "logo") =>
			Number.isSafeInteger(appid) ? steamCdnUrl(appid, kind) : undefined;
		out.push({
			external_id: key,
			title: g.title?.trim() || g.objectId,
			launch: {
				kind: "exec",
				value: gameTemplate(launchers),
				args: [
					{ name: "shop", value: g.shop },
					{ name: "game", value: g.objectId },
				],
			},
			art: {
				portrait:
					http(g.customCoverImageUrl) ??
					http(a?.coverImageUrl) ??
					http(a?.libraryImageUrl) ??
					steam("portrait") ??
					null,
				hero:
					http(g.customHeroImageUrl) ??
					http(g.libraryHeroImageUrl) ??
					http(a?.libraryHeroImageUrl) ??
					steam("hero") ??
					null,
				logo:
					http(g.customLogoImageUrl) ??
					http(g.logoImageUrl) ??
					http(a?.logoImageUrl) ??
					steam("logo") ??
					null,
			},
			platform: g.shop === "launchbox" ? (g.platform ?? null) : "PC",
			...(g.shop === "steam" ? { ids: { steam: g.objectId } } : {}),
			...(file
				? { detect: detectOf(g, file, download, launchers) }
				: {
						install: {
							state: "missing" as const,
							...(download?.fileSize ? { size_bytes: download.fileSize } : {}),
						},
					}),
		});
	}
	return out;
};

/**
 * Hydra's Big Picture tile: Hydra started with `--big-picture`, the mode's only switch. The
 * packaged Linux binary runs from the manifest; any other install the host finds itself, on
 * Windows in the user's profile, on Linux by the desktop entry that handles Hydra's link.
 */
const bigPictureTile = ({ platform, packaged }: Launchers): ProviderEntry[] => {
	const launch =
		platform === "linux" && packaged
			? { kind: "exec", value: "big-picture" }
			: platform === "linux" || platform === "win32"
				? { kind: "launcher_ui", value: "hydra-big-picture" }
				: undefined;
	return launch
		? [
				{
					external_id: "big-picture",
					title: "Hydra Big Picture",
					role: "launcher" as const,
					icon: "hydra",
					launch,
					platform: "PC",
				},
			]
		: [];
};

/** Hydra's own tiles: its window and its Big Picture mode. */
export const launcherEntries = (
	cfg: { launcher?: boolean; bigPicture?: boolean },
	{ platform, packaged }: Launchers,
): ProviderEntry[] => [
	...(cfg.launcher !== false
		? [
				{
					external_id: "launcher",
					title: "Hydra",
					role: "launcher" as const,
					icon: "hydra",
					launch: {
						kind: "exec",
						value: platform === "win32" ? "window-windows" : "window",
					},
					platform: "PC",
				},
			]
		: []),
	...(cfg.bigPicture !== false ? bigPictureTile({ platform, packaged }) : []),
];

/** Hydra keeps writing an active download every 2 s; this long without a write, it isn't running. */
export const STALE_MS = 30_000;

/** What the host is told about one Hydra download; `stale` means Hydra stopped writing it. */
export const rowOf = (
	externalId: string,
	d: HydraDownload,
	stale: boolean,
): DownloadRow => {
	const total = d.fileSize && d.fileSize > 0 ? d.fileSize : undefined;
	const doneBytes = Math.max(0, d.bytesDownloaded ?? 0);
	const base = {
		externalId,
		doneBytes,
		...(total ? { totalBytes: total } : {}),
	};
	if (d.extracting || d.status === "extracting") {
		const pct = Math.round((d.extractionProgress ?? 0) * 100);
		return { ...base, state: "installing", phase: `Extracting ${pct}%` };
	}
	switch (d.status) {
		case "active":
			return stale
				? { ...base, state: "paused", phase: "Hydra isn't running" }
				: { ...base, state: "downloading" };
		case "complete":
		case "seeding":
			return { ...base, doneBytes: total ?? doneBytes, state: "done" };
		case "error":
			return {
				...base,
				state: "failed",
				error: "Hydra stopped the download. Retry it in Hydra.",
			};
		case "removed":
			return { ...base, state: "cancelled" };
		default:
			return { ...base, state: d.queued ? "queued" : "paused" };
	}
};

const terminal = (row: DownloadRow) =>
	row.state === "done" || row.state === "failed" || row.state === "cancelled";

/** Per download: its last write, when that write was first seen, and the row last sent. */
export type DownloadMemory = Map<
	string,
	{ seq: number; at: number; row: DownloadRow }
>;

/**
 * The rows to send after one read of Hydra's downloads. A row goes out when it changes; a
 * finished or failed download goes out only when it was seen running, so a restart doesn't
 * list every old download again. A download Hydra drops counts as cancelled.
 */
export const downloadChanges = (
	downloads: Map<string, Seen<HydraDownload>>,
	memory: DownloadMemory,
	now: number,
): DownloadRow[] => {
	const out: DownloadRow[] = [];
	for (const [key, { seq, record }] of downloads) {
		const was = memory.get(key);
		const at = was && was.seq === seq ? was.at : now;
		const row = rowOf(key, record, now - at > STALE_MS);
		memory.set(key, { seq, at, row });
		if (was ? same(was.row, row) : terminal(row)) continue;
		if (terminal(row) && was && terminal(was.row)) continue;
		out.push(row);
	}
	for (const [key, was] of memory) {
		if (downloads.has(key)) continue;
		memory.delete(key);
		if (!terminal(was.row)) {
			out.push({
				externalId: key,
				state: "cancelled",
				doneBytes: was.row.doneBytes,
			});
		}
	}
	return out;
};

const same = (a: DownloadRow, b: DownloadRow) =>
	a.state === b.state &&
	a.doneBytes === b.doneBytes &&
	a.totalBytes === b.totalBytes &&
	a.phase === b.phase &&
	a.error === b.error;

/**
 * Why the host can't have Hydra download a title, or `undefined` when Hydra already is. Hydra
 * has no way to start a download from outside, so a title is only ever waited for.
 */
export const startRefusal = (
	game: HydraGame | undefined,
	row: DownloadRow | undefined,
): string | undefined => {
	if (
		row?.state === "downloading" ||
		row?.state === "queued" ||
		row?.state === "installing"
	) {
		return undefined;
	}
	if (row?.phase === "Hydra isn't running") {
		return "Hydra isn't running. Start Hydra to resume the download.";
	}
	if (row?.state === "paused")
		return "the download is paused in Hydra. Resume it there.";
	if (row?.state === "failed")
		return "Hydra stopped the download. Retry it in Hydra.";
	if (row?.state === "done") {
		return game && runnable(game)
			? "Hydra just finished it. Start it again in a moment."
			: "Hydra doesn't know which file starts the game yet. Choose it on the game's page in Hydra.";
	}
	return "Hydra starts downloads itself. Pick a download for this game in Hydra.";
};
