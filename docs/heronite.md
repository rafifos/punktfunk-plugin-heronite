# What is Heronite?

Heronite is a free, open-source game launcher for Windows, Linux and the Steam Deck, written in
Rust by Rafael Goulart. It gathers the games you own across several stores and emulators into one
library and starts them itself. It starts a game natively, through Wine or Proton on Linux, or
through an emulator.
It is [GPL-3.0](https://github.com/RafaelGoulartB/Heronite/blob/main/LICENSE), needs no account and
sends no telemetry.

- Website: [heronite.app](https://heronite.app)
- Source: [github.com/RafaelGoulartB/Heronite](https://github.com/RafaelGoulartB/Heronite)
- Current release at the time of writing: 1.8.0

## What it brings together

| Area            | What Heronite does                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stores          | Steam, Epic Games, GOG, Amazon Games, Battle.net, EA app, Ubisoft Connect and Rockstar Games; the Xbox app's Microsoft Store / PC Game Pass titles on Windows                 |
| Emulation       | Finds your emulators (RetroArch, PCSX2, Dolphin, RPCS3 and 18 more) and turns ROM folders into games with covers                                                              |
| Wine and Proton | One prefix per game on Linux; installs and updates GE-Proton or Proton-CachyOS in the app; shows ProtonDB and anti-cheat status before you pick                               |
| Saves           | Ludusavi backs a game's saves up after each session; Restore brings any backup back                                                                                           |
| Play time       | Records every session, with weekly, monthly and yearly stats, a backlog goal and a year in review                                                                             |
| Console mode    | A controller-first layout for a TV or Steam Deck, with Xbox, PlayStation, Nintendo and Steam Deck button hints; opens with `--console` in Steam or when a controller connects |
| Imports         | Brings games in from Heroic, Lutris, Bottles, Faugus and Playnite without modifying their files, so those launchers keep working                                              |

Steam libraries are read without a login. Epic, GOG and Amazon are handled natively by bundled
helpers (`legendary`, `gogdl`, `nile`). Battle.net, EA app, Ubisoft Connect and Rockstar Games
Launcher run as their own clients under Wine on Linux, and as themselves on Windows.

## Platforms and install

- **Windows 10 and 11, 64-bit:** an installer or a portable zip. The package is not code-signed
  yet, so SmartScreen can warn one time.
- **Linux:** an AppImage that runs on most distributions, SteamOS included, and updates itself. The
  releases page also has `.deb`, `.rpm` and Arch packages.
- **Steam Deck:** the AppImage, with a dedicated guide.

## Performance

The UI is native Rust drawn on the GPU with [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui),
the same framework behind the Zed editor. There is no bundled browser and no Electron. Heronite's
own figures for a cold start are a 215 ms median from launch to a usable library, about 150 MB of
memory and 0.1 % CPU while idle, and 64 MB on disk.

## Where its data lives

- **Data folder:** `~/.local/share/heronite` on Linux, `%APPDATA%\heronite\data` on Windows.
  `HERONITE_DATA_DIR` overrides it.
- **Library:** JSON files under `<data>/local_library/`, which include `library.json`,
  `sessions.json`, `statuses.json` and `emulators.json`.
- **UI state and caches:** `~/.config/heronite` and `~/.cache/heronite` on Linux.

Nothing is shared with Heroic or with the earlier Heronite app (`heronite-rs`). The folder keeps
their layout and formats, but Heronite never reads or writes Heroic's folders; Heroic's games come
in only when you switch its import on.

## Where this repo fits

This repository is the Punktfunk link for Heronite: it reads Heronite's data folder and publishes
its games to a [Punktfunk](./punktfunk.md) host as `heronite:<runner>:<appName>`, starts every
title through Heronite, mirrors Heronite's download queue, and adds a read-only per-game tab. It
never writes to Heronite's files and never starts a game's own executable, so Heronite's prefixes,
emulator profiles and playtime stay authoritative. The port is done; see the
[README](../README.md) for setup and the [0.1.0 release note](./release-0.1.0.md).

## Further reading

- [Heronite vs Playnite](https://heronite.app/compare/playnite/), [vs Heroic](https://heronite.app/compare/heroic/), [vs Lutris](https://heronite.app/compare/lutris/)
- [Installation](https://heronite.app/docs/installation/), [getting started](https://heronite.app/docs/getting-started/), [FAQ](https://heronite.app/docs/faq/)
- [Changelog](https://heronite.app/changelog/), [releases](https://github.com/RafaelGoulartB/Heronite/releases), [discussions](https://github.com/RafaelGoulartB/Heronite/discussions)

---

Written from [heronite.app](https://heronite.app) and the
[Heronite repository](https://github.com/RafaelGoulartB/Heronite), read 2026-11-24.
