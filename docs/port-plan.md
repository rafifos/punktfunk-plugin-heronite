# Port plan: from the Hydra plugin to a Heronite library source

This repository becomes a Punktfunk plugin that publishes Heronite's games to a host's library and
starts them through Heronite. It keeps this repository's package scaffold, test patterns and git
history; the Hydra database reader and record parser are removed.

Decisions live in the ADRs: [launch through Heronite](adr/0001-launch-through-heronite.md),
[retarget in place](adr/0002-retarget-in-place-drop-hydra.md),
[reimplement Heronite's formats](adr/0003-reimplement-heronite-formats.md),
[entry identity](adr/0004-entry-identity.md),
[package name](adr/0005-package-name.md) and
[trust install flags](adr/0006-trust-install-flags.md). Vocabulary is in
[GLOSSARY.md](../GLOSSARY.md).

## Identity

| Field             | Value                                                             |
| ----------------- | ----------------------------------------------------------------- |
| npm package       | `@rafifos/plugin-heronite`                                        |
| plugin id / store | `heronite`                                                        |
| library ids       | `heronite:<runner>:<appName>`                                     |
| first version     | `0.1.0` (the Hydra-era tags were removed; upstream keeps its own) |
| licence           | MIT OR Apache-2.0                                                 |

The Heronite checkout under `__references/` is a read-only reference. It is git-ignored and its GPL
code is never copied or translated.

## Architecture

```
src/
  index.ts                 export default plugin.def
  cli.ts                   await plugin.cli()
  plugin.ts                config schema, scan, launchers, watch, downloads, install, tab
  heronite/
    paths.ts               data-root discovery and every file path
    json.ts                tolerant JSON reads (missing/empty/malformed)
    model.ts               TypeScript shapes of Heronite's JSON files
    library.ts             assembles the Collection view from the store files
    entries.ts             Heronite game -> ProviderEntry
    launch.ts              transport choice, launcher tiles, protocol URLs
    downloads.ts           queue read, row mapping, change diffing
    stats.ts               playtime, status and sessions for the per-game tab
  kit/
    library-with-ui.ts     library wiring with a per-game UI section
test/
  fixtures/heronite-data/  hand-authored data root
```

`heronite/*` is pure: it takes paths and returns data, with no Effect or host client. `kit/*` is the
only place that talks to Punktfunk. Tests target the pure layer and the fixture tree.

`defineLibraryPlugin` cannot serve a per-game tab (it owns the only `serveUi` call), so
[`kit/library-with-ui.ts`] composes the kit's exported pieces itself: config service, provider
client, sync engine, access requests, `serveUi` and the CLI. `@punktfunk/plugin-kit` is pinned to an
exact version because this layer follows its internals.

## What the plugin reads

Data root, in order: the configured **Heronite data folder**, then the platform defaults.

| Install           | Data root                                                     |
| ----------------- | ------------------------------------------------------------- |
| Linux package     | `~/.local/share/heronite` (`$XDG_DATA_HOME/heronite`)         |
| Linux Flatpak     | `~/.var/app/app.heronite.Heronite/data/heronite`              |
| Windows installer | `~/AppData/Roaming/heronite/data` (`%APPDATA%\heronite\data`) |
| Windows portable  | `<copy>\data` — only through the configured folder            |
| any               | `HERONITE_DATA_DIR` — only through the configured folder      |

Files used:

| File                                 | Used for                                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| `sideload_apps/library.json`         | local games, Steam entries, their `is_installed` and executable     |
| `store_cache/legendary_library.json` | Epic library                                                        |
| `store_cache/gog_library.json`       | GOG library                                                         |
| `store_cache/nile_library.json`      | Amazon library                                                      |
| `gog_store/installed.json`           | GOG install paths and executables                                   |
| `store_cache/steam_library.json`     | installed Steam app ids (for the id-only Steam join)                |
| `store/config.json`                  | hidden games, favourites                                            |
| `local_library/library.json`         | launch kind, executable, ROMs, emulator ids, status                 |
| `local_library/metadata.json`        | title, description, developers, publishers, genres, dates, art URLs |
| `local_library/art.json`             | art set by hand (remote URLs only; `localart:` is skipped)          |
| `local_library/emulators.json`       | emulator profiles and platform names                                |
| `local_library/copies.json`          | copy groups linked by the user                                      |
| `local_library/sessions.json`        | per-game sessions (tab)                                             |
| `local_library/statuses.json`        | completion status labels (tab)                                      |
| `store/timestamp.json`               | playtime and last played (tab)                                      |
| `store/download-manager.json`        | the download queue and history                                      |

Heronite writes JSON through a temp file and rename, so reads are safe while it runs; every read is
retried once and a malformed file is treated as absent, never as an empty library.

## Scan rules

A game is published when all of these hold:

- it is not hidden in Heronite, not a DLC, not a browser title, and not the `zoom` runner;
- its launch kind resolves to something Heronite can start: `steam-uri`, `executable`, `emulator`,
  `launcher`, `client`, `xbox`, or a store runner (`legendary`, `gog`, `nile`);
- it is installed, or Heronite is downloading it (then it is published as `install: missing`).

Installed means Heronite's `is_installed`, or — for a store game — its `steamAppId` matching an entry
the cached Steam library marks installed (ADR-0006: files are never probed).

Copies are collapsed only for groups in `copies.json`; the first installed member is published.
Automatic Steam twins and title-based groups stay separate in v1.

Each provider entry carries:

- `external_id`: `<runner>:<appName>`; `title`: the displayed title;
- `launch`: transport-dependent (below);
- `art`: custom remote art, then fetched metadata, then the store's `art_square`/`art_cover`, then
  `art_background`, then Steam CDN by app id; `logo` from the same chain;
- `platform`: the emulator profile's platform name for emulator titles, `PC` otherwise;
- `ids.steam` / `ids.gog` / `ids.epic` when the runner gives one;
- `developer`, `publisher`, `description`, `release_year`, `genres` from collection metadata;
- `detect`: `install_dir` from the install path or the executable's folder, `exe` when known,
  `process_name` from the executable's basename, `steam_appid` for Steam titles, and an `env_marker`
  only if Heronite is found to stamp one;
- `install.state`: `missing` with `size_bytes` while downloading; omitted when installed.

Launcher tiles: **Heronite** (opens the window) and **Heronite Console** (`--console --fullscreen`,
only when the program is known). Both toggleable.

## Launch transports

Every title starts Heronite; the plugin never starts a game's own executable (ADR-0001). The
transport is chosen per install, not per game:

| Situation                 | Recipe                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `heronite-rs` on `PATH`   | `heronite-rs --no-gui --launch <runner> <appName>`                                        |
| program folder configured | `<program>/heronite-rs --no-gui --launch <runner> <appName>`                              |
| Flatpak data root found   | `flatpak run app.heronite.Heronite --no-gui --launch <runner> <appName>`                  |
| otherwise                 | `xdg-open` (Linux) / `explorer.exe` (Windows) with `heronite://launch?appName=…&runner=…` |

Arguments use Heronite's two-argument `--launch` form so no URL encoding is involved. The protocol
fallback percent-encodes both values; the host caps a parameter at 128 characters, so a title whose
encoded URL exceeds that is dropped at publish time — an accepted limitation of the fallback.

No `--handoff`: when the plugin starts Heronite, the host keeps the process tree and sees the game
end. When an already-running Heronite takes the request, the spawned process exits immediately and
the `detect` hints keep the session alive.

## Downloads and install asks

`store/download-manager.json` holds the queue and the history, not live progress. Rows map as:

| Queue element                   | Row                                                      |
| ------------------------------- | -------------------------------------------------------- |
| first, queue not paused         | `downloading`, total from the stored size when parseable |
| other queued elements           | `queued`                                                 |
| `finished` with `status: done`  | `done`                                                   |
| `finished` with `status: error` | `failed`, with Heronite's error when present             |
| `finished` with `status: abort` | `cancelled`                                              |
| queue paused by the user        | `paused`                                                 |

Only changes are sent. Heronite writes the file on queue transitions, so neither percent, speed, ETA
nor "is Heronite running" can be derived; the README documents that a download interrupted by
killing Heronite stays `downloading` until Heronite writes the file again.

Install asks: `start` accepts only a title already downloading, queued or installing (the host waits,
then starts it); anything else is refused with a sentence naming Heronite. `pause`, `cancel` and
`uninstall` always refuse, because Heronite owns the files.

## Per-game tab

`entryId` → `<runner>:<appName>` → read `sessions.json` (count, total, last), `timestamp.json`
(playtime, first/last played) and `statuses.json` (the game's completion status). The tab is
read-only, with a short status list and an empty form.

## Manifest

```json
"punktfunk": {
  "schema": 1,
  "id": "heronite",
  "reads": ["~/.local/share/heronite", "~/.var/app/app.heronite.Heronite/data/heronite"],
  "files": ["~/AppData/Roaming/heronite/data"],
  "exec": { "run": { … }, "run-program": { … }, "run-flatpak": { … },
            "open": { … }, "open-windows": { … },
            "window": { … }, "window-program": { … }, "window-flatpak": { … },
            "console": { … }, "console-program": { … }, "console-flatpak": { … } }
}
```

No `writes`, no `network`, no `registry`: art is remote URLs the host fetches, and the plugin writes
only its own state. The program and data folders come from operator-granted `handedPath` fields,
so portable copies and odd installs work without widening the manifest.

## Settings

1. **Heronite data folder** — handed path, empty to auto-detect.
2. **Heronite program folder** — handed path, optional; enables headless launches and the console
   tile where the program is not on `PATH`.
3. **Show a Heronite tile** — default on.
4. **Show a Heronite Console tile** — default on; hidden when no program is known.

## Testing

- `test/fixtures/heronite-data`: a hand-authored tree covering a store game, a sideload executable,
  a Steam URI entry, an emulator game, a downloading title, a hidden game, a DLC, a copy group, a
  paused queue and a partial Steam library. No personal data.
- Unit tests per module: data-root resolution, tolerant reads, library assembly and filters, copy
  collapse, Steam join, entry mapping (launch, art, meta, detect, install), queue mapping and
  diffing, tab data.
- CLI checks: `bun test`, `bunx tsc --noEmit`, `bunx biome check`, `bun src/cli.ts detect`,
  `bun src/cli.ts scan --preview`, `bun src/cli.ts paths`.
- Optional: point the tests at a real data root with `HERONITE_TEST_DATA_DIR` for drift detection;
  nothing from it is committed.

## Milestones

1. **Scaffold and identity** — rename the package, write the manifest, remove the Hydra code and
   fixtures, keep build/test/typecheck green, README stub.
2. **Data root, model and parser** — paths, tolerant JSON, types, fixtures, `detect` and `paths`.
3. **Scan and entries** — library assembly, filters, copy collapse, Steam join, launch selection,
   art, metadata, detect hints, launcher tiles, `scan --preview`.
4. **Plugin wiring** — `library-with-ui`, sync loop, watch and poll, settings, CLI verbs and
   `parity`.
5. **Downloads and install asks** — queue mapping, reporter loop, install handlers, wait-on-launch.
6. **Per-game tab** — `serveUi({ game })`, playtime, status, sessions.
7. **Docs and first release** — README, the two primers, `v0.1.0`, npm publish, install check.

## Known limitations

- No download percentage, speed or ETA, and no way to tell whether Heronite is running.
- A download interrupted by killing Heronite stays `downloading` until Heronite writes the file.
- Install state is Heronite's, so a game deleted outside it can linger.
- Only remote art is used; `localart:` files are skipped.
- Only user-made copy groups are collapsed, not automatic twins.
- The protocol fallback drops titles whose encoded URL exceeds 128 characters.
- No client bundles a Heronite launcher icon, so both tiles show their names until one is added
  upstream.
- Windows paths are implemented from the source and fixtures; a Windows host has not run this yet.
