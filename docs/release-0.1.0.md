# 0.1.0

The first release of `@rafifos/plugin-heronite`: a Punktfunk library source for Heronite, replacing
this repository's Hydra support.

## What it does

- Publishes every installed Heronite game the host can start, plus every game Heronite is
  downloading, as `heronite:<runner>:<appName>`.
- Starts every title through Heronite itself, so its Wine/Proton prefix, emulator profile, mods and
  playtime apply.
- Mirrors Heronite's store download queue in the host's Downloads list, and lets a launch wait for
  a title Heronite is already fetching.
- Adds a read-only per-game tab with Heronite's playtime, first and last played, and completion
  status.

## Breaking: library ids changed

The plugin id, store claim and library ids changed from `hydra` to `heronite`:

| Before                | After                         |
| --------------------- | ----------------------------- |
| `hydra:steam:620`     | `heronite:steam:620`          |
| `hydra:custom:<uuid>` | `heronite:sideload:<appName>` |

Pins, cached art, GameStream app ids and per-entry settings from the Hydra plugin do not carry
over; the source launcher is different, so the titles are not the same entries. Remove the Hydra
plugin before installing this one so both do not list the same library.

## Known limitations

- **Windows is untested.** The paths and the manifest are implemented from Heronite's source and
  the fixture tree; no Windows host has run this yet.
- No download percentage, speed or ETA: Heronite does not persist progress.
- A download interrupted by killing Heronite stays `downloading` until Heronite writes its queue
  file again.
- Install state is Heronite's own, so a game deleted outside Heronite can linger.
- Only remote art is used; art Heronite keeps in `localart:` files is skipped.
- Only copy groups you made by hand are collapsed, not Heronite's automatic twins.
- The protocol fallback (no `heronite-rs` on `PATH` and no program folder) drops any title whose
  encoded launch URL exceeds the host's 128-character parameter cap. It also cannot hold a
  dedicated display: it needs a registered `heronite://` handler, and `xdg-open` exits before a
  game appears, so a streamed session should use `heronite-rs`, a program folder (an AppImage is
  accepted) or Flatpak.
- Heronite permits one instance. If it already runs, including when **Start with the system** is
  on, a launch gives the request to that instance and exits in milliseconds. This stops the
  dedicated display of a streamed session, so quit Heronite before you stream.

## Install

```sh
punktfunk-host plugins add @rafifos/plugin-heronite --allow-public-registry
```

Licensed MIT OR Apache-2.0.
