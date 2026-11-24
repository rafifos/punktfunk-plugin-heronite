# punktfunk-plugin-hydra

[![Formatted with Biome](https://img.shields.io/badge/Formatted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev/) [![Linted with Biome](https://img.shields.io/badge/Linted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev) [![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

A [punktfunk](https://git.unom.io/unom/punktfunk) host plugin that adds your
[Hydra Launcher](https://hydralauncher.gg) games to the host's library, with Hydra's covers.
Games start through Hydra, so its Wine/Proton prefix, launch options, playtime and achievements
apply exactly as when you click **Play** in Hydra.

New to Punktfunk? [What is Punktfunk?](docs/punktfunk.md) covers the host/client model, how a
stream flows, and where plugins fit.

Needs Hydra 4.x and host 0.41 or later. Download progress needs host 0.43 or
later; an older host lists the games and ignores the rest.

## What gets listed

- Every game in Hydra's library that Hydra can start: a PC game with its executable set, or a
  Classics game with a ROM.
- Every game Hydra is downloading, marked as not installed.
- A **Hydra** tile that opens Hydra's window, and a **Hydra Big Picture** tile that opens its
  controller interface. Either can be switched off in the settings.

A game you only added to Hydra's library, with no download, is left out: the host has nothing
to start or wait for.

## Downloads

Hydra picks the download source and runs the download; nothing outside Hydra can start one.
What the host gets:

- Hydra's downloads in the console's **Downloads** list, with progress, speed and time left.
  Extracting shows as installing.
- A player who starts a game Hydra is still downloading waits on the launch screen until Hydra
  is done, then the game starts.
- Anything Hydra isn't downloading right now gets a sentence saying what to do in Hydra: pick a
  download, resume it, retry it, or choose the game's executable. Pause, cancel and remove stay
  in Hydra too.
- When Hydra isn't running, its downloads read as paused.

## Setup

**Linux:** nothing to set. Hydra's data in `~/.config/hydralauncher` (AppImage, deb, rpm, AUR)
or the snap's folder is found by itself. Games open through the `hydralauncher://` link; an
AppImage needs to be integrated (Gear Lever, AppImageLauncher) so the link and the Big Picture
tile reach it.

**Windows:** the plugin runner can't read your profile by itself. The manifest names
`%APPDATA%\hydralauncher\hydra-db` by its own files, so a current host opens it when the plugin
installs; an older host asks for it under **Library** → **Game sources** → Hydra.

Elsewhere, set **Hydra data folder** to the folder holding `hydra-db`.

## Develop

```sh
bun install
bun test
bunx tsc --noEmit
bunx biome check
bun src/cli.ts scan --preview   # what a sync would send
```

The plugin reads Hydra's LevelDB itself (`src/leveldb.ts`), without taking Hydra's lock, so it
works while Hydra runs. `test/fixtures/hydra-db` was written by classic-level, Hydra's own
store; `test/fixtures/make-db.mjs` writes it again.

Licensed MIT OR Apache-2.0.

## Use of AI

This project uses AI for writing code.
