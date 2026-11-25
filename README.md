# @rafifos/plugin-heronite

[![Formatted with Biome](https://img.shields.io/badge/Formatted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev/) [![Linted with Biome](https://img.shields.io/badge/Linted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev) [![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

A [Punktfunk](https://git.unom.io/unom/punktfunk) host plugin that publishes your
[Heronite](https://heronite.app) games to the host's library and starts them through Heronite, so
Heronite's Wine/Proton prefix, emulator profile, playtime and console mode apply exactly as when
you press **Play** in Heronite.

New to Punktfunk? [What is Punktfunk?](docs/punktfunk.md) covers the host/client model, how a
stream flows, and where plugins fit. New to Heronite? [What is Heronite?](docs/heronite.md)
covers the launcher this plugin reads.

Needs Heronite 1.8 and host 0.43 or later. An older host lists the games and ignores the rest.

## What gets listed

- Every Heronite game it can start that is installed: a Steam title, a store game from Epic, GOG
  or Amazon, a sideloaded executable, an emulator ROM, or a game another launcher owns.
- Every game Heronite is downloading, marked as not installed with the size it recorded.
- A **Heronite** tile that opens Heronite's window, and a **Heronite Console** tile that opens its
  controller interface. Either can be switched off in the settings; the console tile needs a known
  `heronite-rs`.

Left out: games only in a store's catalogue, hidden games, DLCs, browser titles, and the `zoom`
runner. A copy group you linked in Heronite appears once, as the first installed copy.

## Setup

**Linux package (deb, rpm, Arch):** nothing to set. Heronite's data in
`~/.local/share/heronite` is found by itself, and launches use `heronite-rs` from `PATH`.

**AppImage:** set **Heronite program folder** to the folder holding the AppImage, usually
`~/Applications`. The plugin runs the AppImage with Heronite's own flags, which keeps one
long-lived process the host can follow — what a streamed session needs. Do not rely on the
`heronite://` scheme instead: an AppImage integration often registers no handler, and a hand-off
launch through `xdg-open` exits before anything appears. The `paths` verb prints which transport
is in use and warns on the fallback.

**Streaming:** Heronite runs **one instance per data folder**. If Heronite is already open —
including **Start with the system**, which is on by default in some setups — your launch hands the
request to that instance and exits in milliseconds. A streamed session's dedicated display lives
only as long as the launched command, so it is torn down and the client reconnects, while the game
starts on the host's own screen. **Quit Heronite (or turn off Start with the system) before
streaming**: the plugin then starts Heronite inside the streamed session, where it stays until the
game ends. Let punktfunk own the compositor too: if your launch options wrap the game in another
launcher's gamescope (goverlay, for example), use a profile without gamescope for streaming and
keep only the overlay tools.

A streamed game entry also waits for the game's **own window** before the client shows it. The host
reports the game `running` as soon as its process is up, but holds its splash until the window
reaches the screen — "often far later than its process: a Proton prefix build, a splash on a black
window" — and a chain like Heronite → Steam → goverlay can outlast the client's patience. For that
shape, stream the **Heronite** tile instead: a launcher entry keeps the session up until you leave
it, so you get Heronite's own window in the stream and start the game from there. That is the flow
to prefer whenever a launcher sits in front of the game.

The protocol fallback starts Heronite on the host's own screen. A client that asks for its own mode
makes the host spin up a dedicated display whose lifetime is the launched command; a hand-off
command exits at once, so the display goes away and the client reconnects. Give the plugin a
program — `heronite-rs` on `PATH`, the program folder, or Flatpak — before streaming Heronite
titles.

**Flatpak:** nothing to set. The Flatpak's data folder
(`~/.var/app/app.heronite.Heronite/data/heronite`) is found by itself, and launches go through
`flatpak run app.heronite.Heronite`.

**Windows installer:** the plugin runner cannot read your profile by itself. The manifest names
`%APPDATA%\heronite\data`, so a current host opens it when the plugin installs; an older host asks
for it under **Library** → **Game sources** → Heronite. Windows is untested so far.

**Portable copy, or a data folder elsewhere:** set **Heronite data folder** to the folder holding
`store` and `local_library`. If the program is not on `PATH`, set **Heronite program folder** too;
that is what enables headless launches and the console tile on a portable install.

Pause, cancel and remove stay in Heronite: it owns the files.

## Install

```sh
punktfunk-host plugins add @rafifos/plugin-heronite --allow-public-registry
```

A package outside the `@punktfunk` scope needs `--allow-public-registry`. Remove it with
`punktfunk-host plugins remove @rafifos/plugin-heronite`.

## Develop

```sh
bun install
bun test
bunx tsc --noEmit
bunx biome check
bun run build          # dist/index.js and dist/cli.js
bun pm pack            # the tarball a host installs
```

The CLI works against a real Heronite install, or a folder you point it at with the settings:

```sh
bun src/cli.ts detect          # present | absent
bun src/cli.ts scan --preview  # the entries a sync would push
bun src/cli.ts paths           # data root, file presence, entry and launcher counts
```

`detect`, `scan` and `paths` run offline. `parity` and `uninstall` talk to a running host:

```sh
bun src/cli.ts parity --snapshot before.json   # capture the host's library for this store
bun src/cli.ts parity --compare before.json    # exits 1 when an entry changed
bun src/cli.ts uninstall                       # remove the entries and release the store claim
```

To try the offline verbs against the fixture, copy `test/fixtures/heronite-data` to
`$XDG_DATA_HOME/heronite` (or set the data folder in the plugin's settings). Point the suite at a
real data root with `HERONITE_TEST_DATA_DIR` to catch drift from a Heronite update; nothing from
it is committed.

`src/heronite/*` is pure — paths in, data out, no Effect and no host client — so the parsers, the
filters and the entry mapping are tested without a running host. `src/kit/library-with-ui.ts` is
the only place that talks to Punktfunk: it composes the kit's exported pieces because
`defineLibraryPlugin` owns the only `serveUi` call and so cannot serve a per-game tab. That is why
`@punktfunk/plugin-kit` is pinned to an exact version.

## Downloads

Heronite runs its own store downloads, so the host's Downloads list mirrors Heronite's queue
rather than driving it. What it can show follows from what Heronite persists in
`store/download-manager.json`:

- **No percentage, speed or ETA.** Heronite writes the file on queue transitions, not while bytes
  move. A row carries the size Heronite recorded and, once finished, that size as done; there is
  nothing to interpolate in between.
- **A killed Heronite leaves its last state on disk.** If Heronite is killed mid-download, the
  title stays `downloading` (or `paused`) until Heronite writes the file again; the plugin cannot
  tell that nothing is moving.
- **A launch waits only for a title Heronite is already fetching.** Starting a game listed as
  missing succeeds only while Heronite reports it `downloading`, `queued` or `installing`; the
  host waits and then starts it. Anything else is refused with a sentence telling you to start the
  download in Heronite. Pause, cancel and remove always refuse, because Heronite owns the files.

## Per-game tab

Each of the plugin's entries opens a read-only tab: Heronite's own playtime and first/last played
from `store/timestamp.json` and `local_library/sessions.json`, plus the completion status it
resolved from `local_library/statuses.json`. The tab shows a short status list and an empty form —
saving does nothing, because the plugin never writes to Heronite's files.

## History

This repository began as the upstream Hydra plugin and was retargeted in place; Hydra support has
been removed. Library ids therefore changed from `hydra:*` to `heronite:*`, so pins, art caches and
GameStream app ids from the Hydra plugin do not carry over. See
[ADR-0002](docs/adr/0002-retarget-in-place-drop-hydra.md) and the
[0.1.0 release note](docs/release-0.1.0.md).

## Use of AI

This project uses AI for writing code.

Licensed MIT OR Apache-2.0.
