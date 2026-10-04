// Hydra's records against the entries and download rows the host gets.
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import {
	type DownloadMemory,
	downloadChanges,
	type HydraDownload,
	type Launchers,
	launcherEntries,
	readDownloads,
	readLibrary,
	type Seen,
	startRefusal,
	toEntries,
} from "../src/hydra.js";

const FIXTURE = path.join(import.meta.dir, "fixtures", "hydra-db");
const linux: Launchers = { platform: "linux", packaged: false };
const byId = (launchers = linux) =>
	new Map(
		toEntries(readLibrary(FIXTURE), launchers).map((e) => [e.external_id, e]),
	);

describe("entries", () => {
	test("lists installed titles and the ones Hydra is downloading", () => {
		expect([...byId().keys()].sort()).toEqual([
			"custom:6f1c3d52-8a1e-4f7b-9d2e-1a2b3c4d5e6f",
			"launchbox:okami-ps2",
			"steam:1086940",
			"steam:1091500",
			"steam:1245620",
			"steam:292030",
			"steam:367520",
			"steam:620",
		]);
	});

	test("an installed Windows game runs through Hydra and is found by its folder and umu id", () => {
		expect(byId().get("steam:1091500")).toEqual({
			external_id: "steam:1091500",
			title: "Cyberpunk 2077",
			launch: {
				kind: "exec",
				value: "open",
				args: [
					{ name: "shop", value: "steam" },
					{ name: "game", value: "1091500" },
				],
			},
			art: {
				portrait: "https://cdn.example/1091500/cover.jpg",
				hero: "https://cdn.example/1091500/hero.jpg",
				logo: "https://cdn.example/1091500/logo.png",
			},
			platform: "PC",
			ids: { steam: "1091500" },
			detect: {
				install_dir: "/home/deck/Games/Hydra/Cyberpunk 2077",
				exe: "/home/deck/Games/Hydra/Cyberpunk 2077/bin/x64/Cyberpunk2077.exe",
				env_marker: { key: "GAMEID", value: "umu-1091500" },
			},
		});
	});

	test("a native game without Hydra's art falls back to Steam's", () => {
		const portal = byId().get("steam:620");
		expect(portal?.art?.portrait).toBe(
			"https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_600x900.jpg",
		);
		expect(portal?.detect).toEqual({
			install_dir: "/home/deck/Games/Portal 2",
			exe: "/home/deck/Games/Portal 2/portal2.sh",
		});
	});

	test("a title still downloading is missing, with its size", () => {
		const knight = byId().get("steam:367520");
		expect(knight?.install).toEqual({ state: "missing", size_bytes: 9e9 });
		expect(knight?.detect).toBeUndefined();
	});

	test("a custom game keeps no local art, a classic keeps its system", () => {
		const custom = byId().get("custom:6f1c3d52-8a1e-4f7b-9d2e-1a2b3c4d5e6f");
		expect(custom?.art).toEqual({ portrait: null, hero: null, logo: null });
		expect(custom?.ids).toBeUndefined();
		const okami = byId().get("launchbox:okami-ps2");
		expect(okami?.platform).toBe("Sony PlayStation 2");
		expect(okami?.detect).toEqual({ install_dir: "/home/deck/ROMs/ps2" });
	});

	test("the template follows the install", () => {
		const windows = byId({ platform: "win32", packaged: false });
		expect(windows.get("steam:1091500")?.launch?.value).toBe("open-windows");
		expect(windows.get("steam:1091500")?.detect?.env_marker).toBeUndefined();
		const packaged = byId({ platform: "linux", packaged: true });
		expect(packaged.get("steam:620")?.launch?.value).toBe("run");
	});
});

describe("launcher tiles", () => {
	test("Big Picture from the packaged binary, else through the host", () => {
		const ids = (platform: NodeJS.Platform, packaged: boolean) =>
			launcherEntries({}, { platform, packaged }).map(
				(e) => `${e.external_id}:${e.launch?.value}`,
			);
		expect(ids("linux", true)).toEqual([
			"launcher:window",
			"big-picture:big-picture",
		]);
		expect(ids("linux", false)).toEqual([
			"launcher:window",
			"big-picture:hydra-big-picture",
		]);
		expect(ids("win32", false)).toEqual([
			"launcher:window-windows",
			"big-picture:hydra-big-picture",
		]);
		expect(
			launcherEntries({}, { platform: "win32", packaged: false })[1]?.launch,
		).toEqual({ kind: "launcher_ui", value: "hydra-big-picture" });
		expect(
			launcherEntries({ launcher: false, bigPicture: false }, linux),
		).toEqual([]);
	});
});

describe("downloads", () => {
	const states = (rows: ReturnType<typeof downloadChanges>) =>
		rows.map(
			(r) => `${r.externalId} ${r.state}${r.phase ? ` (${r.phase})` : ""}`,
		);

	test("first read reports what is running, not what finished earlier", () => {
		const memory: DownloadMemory = new Map();
		expect(states(downloadChanges(readDownloads(FIXTURE), memory, 0))).toEqual([
			"steam:367520 downloading",
			"steam:1245620 installing (Extracting 50%)",
			"steam:1086940 queued",
		]);
	});

	test("a download Hydra stops writing reads as paused; finishing and vanishing send once", () => {
		const memory: DownloadMemory = new Map();
		const read = readDownloads(FIXTURE);
		downloadChanges(read, memory, 0);
		expect(states(downloadChanges(read, memory, 31_000))).toEqual([
			"steam:367520 paused (Hydra isn't running)",
		]);

		const knight = read.get("steam:367520") as Seen<HydraDownload>;
		const next = new Map(read);
		next.set("steam:367520", {
			seq: knight.seq + 1,
			record: { ...knight.record, status: "complete", bytesDownloaded: 9e9 },
		});
		next.delete("steam:1086940");
		expect(states(downloadChanges(next, memory, 32_000))).toEqual([
			"steam:367520 done",
			"steam:1086940 cancelled",
		]);
		expect(downloadChanges(next, memory, 33_000)).toEqual([]);
	});

	test("start waits on a running download and explains everything else", () => {
		const row = (
			state: "downloading" | "paused" | "done" | "failed",
			phase?: string,
		) => ({
			externalId: "steam:1",
			state,
			doneBytes: 0,
			...(phase ? { phase } : {}),
		});
		const missing = { shop: "steam", objectId: "1" };
		expect(startRefusal(missing, row("downloading"))).toBeUndefined();
		expect(
			startRefusal(missing, row("paused", "Hydra isn't running")),
		).toContain("Hydra isn't running");
		expect(startRefusal(missing, row("paused"))).toContain("paused in Hydra");
		expect(startRefusal(missing, row("failed"))).toContain("Retry it in Hydra");
		expect(startRefusal(missing, row("done"))).toContain(
			"which file starts the game",
		);
		expect(
			startRefusal({ ...missing, executablePath: "/g/game" }, row("done")),
		).toContain("just finished");
		expect(startRefusal(missing, undefined)).toContain("Pick a download");
	});
});
