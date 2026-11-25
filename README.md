# punktfunk-plugin-heronite

A [Punktfunk](https://git.unom.io/unom/punktfunk) host plugin that will publish your
[Heronite](https://heronite.app) games to the host's library and start them through Heronite, so
Heronite's Wine/Proton setup, playtime and console mode apply.

**Pre-release.** Games, launcher tiles, settings and downloads work; the per-game tab arrives in
the coming milestone. See the [port plan](docs/port-plan.md) and the [ADRs](docs/adr/).

New to Punktfunk? [What is Punktfunk?](docs/punktfunk.md) covers the host/client model, how a
stream flows, and where plugins fit.

## Develop

```sh
bun install
bun test
bunx tsc --noEmit
bunx biome check
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
`$XDG_DATA_HOME/heronite` (or set the data folder in the plugin's settings).

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

## History

This repository began as the upstream Hydra plugin and was retargeted in place; Hydra support has
been removed. See [ADR-0002](docs/adr/0002-retarget-in-place-drop-hydra.md).

Licensed MIT OR Apache-2.0.

## Use of AI

This project uses AI for writing code.
