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

### The two launcher tiles' marks

Both tiles name a brand-mark token — `heronite` for the desktop tile, `heronite-console` for console
mode — and that is the only thing the host accepts there. `icon` is a token matching
`[a-z][a-z0-9-]{0,31}` that each client resolves against the marks it bundles; image bytes and URLs
are rejected, so a plugin cannot ship its own artwork. The art slots are not a way round it either:
the host's art proxy serves raster containers only and **refuses SVG outright**, because the web
console renders library art in a browser and SVG is script-capable XML. On top of that this plugin
serves no static directory to host a raster copy, and Heronite's own marks are GPL-3.0 against this
package's MIT OR Apache-2.0 (ADR-0003), so they cannot be vendored here.

No shipped client bundles either token yet, so both tiles render as their name on an accent face —
unchanged from before this was added. They light up, with no release here, the day punktfunk's
`assets/launcher-icons` gains the marks. Asking for two different tokens means a client that ships
only `heronite` still dresses the desktop tile and leaves console mode legible rather than wrong.

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
game ends. Let punktfunk own the compositor **and** the layers: punktfunk ships its own gamescope and
its matching FROG WSI Vulkan layer (`punktfunk-gamescope` installs both), and the host switches the
distro's layer off for the session so exactly one compositor's layer is live. A game that starts
outside that environment — a `steam://` hand-off to a Steam that was already running on the
desktop, for example — loses it, and the live layer then reports `CreateSwapchainKHR: Creating
swapchain for non-Gamescope swapchain` / `Hooking has failed somewhere! You may have a bad Vulkan
layer interfering` for a window the compositor never owned. That dialog blocks the game before it
creates a window, so the stream has nothing to show while the game appears on the host's own screen.
**Quit Steam as well as Heronite before streaming**, so the session starts its own; if the dialog
still appears, compare the game's environment — inside the session it carries
`GAMESCOPE_WAYLAND_DISPLAY` and `PUNKTFUNK_GAMESCOPE_WSI=1`
(`tr '\0' '\n' < /proc/<game pid>/environ`).

**So neither has to be quit by hand**, install the two hooks. `hooks.json` supports `"hold": true` on
`game.launching`: the launch waits for the hook, so it runs _before_ the entry's command — a connect
hook only races the launch and loses. The installer copies both scripts and merges three entries
(`game.launching` → prep, `session.ended` and `host.started` → restore) into
`~/.config/punktfunk/hooks.json`, then restarts the host — no checkout needed:

```sh
curl -fsSL https://raw.githubusercontent.com/rafifos/punktfunk-plugin-heronite/main/contrib/stream-prep/install.sh | sh
```

It is idempotent — entries it owns are replaced, any other hook in the file is kept — so re-running it
after an update is safe. `PLUGIN_REF=…` pins the ref it downloads from, and
`HERONITE_PROGRAM_DIR=…` names the app folder if the AppImage is not in `~/Applications`. From a
checkout, `contrib/stream-prep/install.sh` installs the files beside it instead of downloading.

Two samples are taken (`game.running`, and again 25 s later, because `game.running` fires when the
launcher's process appears — often a minute before Proton and the game exist). They write
`~/.local/state/punktfunk/stream-diagnostics.log`: one block per launched game listing the Wine,
Proton and session processes with their `DISPLAY`, `WAYLAND_DISPLAY`, `GAMESCOPE_WAYLAND_DISPLAY`
and WSI variables, plus the audio plumbing: the default sink, every sink's channel format, and each
stream's. That is the difference between a game rendering inside the session and one that
escaped to the desktop — the gamescope layer only ever reports a non-gamescope swapchain for the
second — so a black screen leaves the answer behind instead of needing someone at a terminal while
it happens:

```sh
tail -20 ~/.local/state/punktfunk/stream-diagnostics.log
```

A real capture from a gamescope session shows why that matters:

```
--- pid 272301 (steam): … steam://rungameid/3527290
    GAMESCOPE_WAYLAND_DISPLAY=gamescope-0
    PUNKTFUNK_GAMESCOPE_WSI=1          # our layer is live in this process
    WAYLAND_DISPLAY=wayland-1          # …and this is the DESKTOP's compositor
    ENABLE_GAMESCOPE_WSI=0
    DISPLAY=:2
```

Steam's runtime re-exposes the host session's Wayland socket inside the container, so a
Wayland-capable client under it presents to KWin while the gamescope WSI layer is loaded — which is
exactly when that layer reports `Creating swapchain for non-Gamescope swapchain`. Force the game onto
X11 with Steam → the game → Launch Options:

```
env -u WAYLAND_DISPLAY %command%
```

`env -u` unsets it rather than blanking it, and that difference matters: Proton decides on the
variable's _presence_, `if "wayland" in self.compat_config and "WAYLAND_DISPLAY" in self.env`, so an
empty value still enables the Wayland driver. HDR is unaffected either way — the HDR10 swapchain comes
from the gamescope WSI layer over X11 (`--hdr-enabled`, `PUNKTFUNK_GAMESCOPE_WSI=1`, `DXVK_HDR=1`),
none of which reads `WAYLAND_DISPLAY`.

A hook cannot do this for you — it is a separate process, and a child's environment is fixed when the
host forks it — so the choice is where the variable is set:

| Where                                                   | Scope                          | Measured result                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steam launch options `env -u WAYLAND_DISPLAY %command%` | one game                       | **works** — it runs after everything else, so nothing re-adds the variable                                                                                        |
| `PROTON_ENABLE_WAYLAND=0`                               | every Proton title             | **does not work** — the game arrived without the variable at all: Steam's runtime drops `PROTON_*` when it builds the game's environment, so Proton never sees it |
| the plugin's own launch (`exe: "env"`)                  | every game through this plugin | **does not work** — same reason: the value is set two processes too early and the game process never receives it                                                  |

The working line, once per title, in Steam → the game → Properties → Launch Options:

```
env -u WAYLAND_DISPLAY %command%
```

There is no global equivalent: Steam has no session-wide launch options, and the variable is re-added
inside its runtime container after any launcher-level attempt. A title with a launch option already
set keeps it — just add the prefix.

When another tool already owns the launch line — goverlay, for instance, writes
`"…/bgmod" -- env gamemoderun %command%` — the prefix goes **after the `--`**, which is where bgmod
hands over, and **before** the program:

```
"…/goverlay/gameconfig/global/bgmod" -- env -u WAYLAND_DISPLAY gamemoderun %command%
```

bgmod reads the `bgmod.conf` that sits **next to its own binary** (measured), and its `[Env]` section is
exported to the game, so a per-game copy does the same without touching Steam:

```ini
[Env]
WAYLAND_DISPLAY=
```

That exports the key empty rather than removing it — enough here, but `env -u` is the stricter form.
Put it in `gameconfig/<Game>/bgmod.conf` and point that game's launch option at that folder's `bgmod`;
the `global/bgmod.conf` copy applies to every goverlay-wrapped title, desktop included, and it already
carries `PROTON_ENABLE_HDR=1` and `ENABLE_HDR_WSI=1`.

The diagnostics log records `PROTON_ENABLE_WAYLAND`, `PROTON_USE_WAYLAND` and `SDL_VIDEODRIVER` for
every game process, so whichever route you pick, the log says whether it arrived.

**Sound is a client setting, and 5.1 is one of them.** The host opens its capture at the channel count
the client asked for — `pf-audio`: "a host-owned null sink claimed as the session default, advertising
`channels` so apps can produce real surround" — and `AudioParams` accepts 2, 6 (5.1) or 8 (7.1).
`AudioLayout` carries Opus layouts for all three, and 7.1.4 is padded with silence per frame. Above
Opus, **Lossless** sends uncompressed PCM instead, gated on `PUNKTFUNK_AUDIO_HIRES` (on by default) and
on fitting a quarter of the video bitrate. A soundbar fed PCM by the TV is therefore the expected path:
set the client to **Audio channels: 5.1** and **Audio quality: Lossless**. The diagnostics log settles
what you got — a sink reading `6ch` means the session negotiated surround before any game had an
opinion, and a stream still at `2ch` means the game itself never produced it.

A game **already running at the desk** is handled by title: if its Steam AppId matches the entry
being launched, the prep stops it too — otherwise the session's Heronite hands the launch to the
desktop instance and exits, which tears the display down and reconnects in a loop. A _different_
title running at the desk is left alone, with a line in the journal saying so.

Two opt-outs, for the hook's `run` string or the installer's environment:

```sh
PUNKTFUNK_PREP=0     # never stop anything; close Steam/Heronite yourself before a stream
PUNKTFUNK_RESTORE=0  # never start them again when a session ends
```

**The plugin does not try.** An earlier revision wrapped every transport in
`env PROTON_ENABLE_WAYLAND=0`; a capture of the running game showed `PEAK.exe` carrying
`WAYLAND_DISPLAY=wayland-1` and no `PROTON_ENABLE_WAYLAND` at all, so the prefix was reverted rather
than left in place looking like a fix. `ExecTemplate` has no environment field and the host reads the
manifest before the plugin runs, so a console toggle could not reach the game either. The unset has to
happen at the game's own launch, which is why it is a launch option and not a plugin setting.

The prep stops only processes **without** `GAMESCOPE_WAYLAND_DISPLAY` in their environment, so the
session's own Heronite and Steam are never touched, and a desk launch is skipped outright. It also
leaves everything alone when a Steam game is running at the desk — killing an unsaved session is worse
than a stream that cannot start — and says so in the journal. The restore
starts them again once gamescope is gone, through `systemd-run --user` so they outlive the hook's
process group. A stopped Heronite also leaves `$XDG_RUNTIME_DIR/heronite-rs-*.sock` behind — the next
start reads `ECONNRESET` from it and reports _already running but stopped responding_ — so the prep
removes it once no instance is alive. The same one-time result without hooks: turn off Steam's _Run
Steam when my computer starts_ and Heronite's _Start with the system_.

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

Why the decode layer stays Effect-free and how its IO is injected: [ADR 0007](docs/adr/0007-pure-decode-layer-injected-io.md).

## Releasing

[release-please](https://github.com/googleapis/release-please) owns the version, the changelog and the
tag; nothing is versioned by hand. Write [Conventional Commits](https://www.conventionalcommits.org/)
on `main` — `feat:` bumps the minor, `fix:` the patch, `feat!:` the major — and the workflow opens (or
updates) a _chore: release_ pull request:

| Workflow                                                   | Runs on                                          | Does                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [ci.yml](.github/workflows/ci.yml)                         | every push to `main` and every pull request      | Biome, `tsc --noEmit`, `bun test`, build, `npm pack --dry-run`                                                                             |
| [release-please.yml](.github/workflows/release-please.yml) | every push to `main`                             | opens the release PR; on merge, tags the commit and cuts the GitHub release, then calls `publish.yml`                                      |
| [publish.yml](.github/workflows/publish.yml)               | called by the release, or run by hand with a tag | builds the tag, refuses a tag that disagrees with `package.json`, skips a version already on the registry, then `npm publish --provenance` |

The release pull request's CI run waits for a maintainer to approve it — GitHub treats a pull request
opened by `github-actions[bot]` as outside-collaborator work — so approve the run, then merge.

Tags are plain `v<version>` (`include-component-in-tag` is off). `publish.yml` still reads the
version from the end of the tag, so a component-prefixed tag would work too.

Merge the release PR to ship. The version in `package.json`, the changelog entry, the `vX.Y.Z` tag
and the npm package therefore always agree. `publish.yml` also takes a tag by hand
(_Actions → Publish → Run workflow_) to re-run one that failed, and it is safe to re-run: a version
already on the registry is a no-op.

The plugin definition carries no version of its own: `pluginDef.version` reads `package.json`,
which `bun build` inlines into `dist`. A release therefore reports the new version to the host with
no second place to bump.

Publishing uses **trusted publishing**: the job holds no npm credential at all. `id-token: write`
lets npm verify the run's GitHub OIDC identity and mint a short-lived token, and `--provenance` signs
the attestation with the same identity. The binding lives on the registry, not in this repository:

```sh
npm trust github @rafifos/plugin-heronite \
  --repo rafifos/punktfunk-plugin-heronite \
  --file publish.yml --allow-publish
npm trust list @rafifos/plugin-heronite
```

npm reports a refused exchange as a bare `ENEEDAUTH` and keeps the registry's reason for its debug
log, so `publish.yml` asks the registry the same question first
([preflight-trusted-publish.ts](scripts/preflight-trusted-publish.ts)) and prints the answer. A
binding that no longer matches — a renamed repository, a renamed workflow file, a deleted entry —
therefore names itself in the run summary instead of sending you to `--loglevel verbose`:

```
::error::the registry refused the OIDC exchange for @rafifos/plugin-heronite (HTTP 404: …)
::error::bind or re-bind the workflow, then re-run: npm trust github …
```

Re-running the workflow after a re-bind is the whole repair: a version already on the registry is a
no-op, and a version that failed to publish is still absent, so it goes out on the retry. Publish
through the workflow rather than by hand even in an emergency — a manual publish carries no
attestation, and an npm version cannot be re-published to add one, so repairing it costs a patch
release.

### The first version, once

A trusted relationship can only be bound to a package that already exists, so version `0.1.0` needs
one publish that is not trusted. Publish **the real version**, not a placeholder: npm versions are
immutable, so a `0.0.0` stands in the version list forever, and unpublishing it releases the name
that the trust binding hangs from. Merge the release pull request first, then, from the tag:

```sh
git checkout v0.1.0
npm login                 # 2FA prompt
bun install --frozen-lockfile
npm publish --access public
```

`prepublishOnly` builds `dist`, so the tarball matches the tag. A local publish cannot attach
provenance — that needs a CI OIDC identity — so `0.1.0` carries none and every later version does. If
you want `0.1.0` attested too, put an npm Automation token in the `NPM_TOKEN` secret for that one
release instead, then delete the secret: `publish.yml` uses a token only while the secret exists and
authenticates over OIDC as soon as it is gone, and it skips a version that is already published, so
merging the release after a manual publish is a no-op rather than a failure.

Then bind the trust — and publish something within two days, because a new trusted publisher expires
if it is never used:

```sh
npm trust github @rafifos/plugin-heronite \
  --repo rafifos/punktfunk-plugin-heronite \
  --file publish.yml --allow-publish
npm trust list @rafifos/plugin-heronite
```

`--allow-publish` matters: a new relationship is allowed `npm stage publish` only, so plain
`npm publish` from the workflow is refused without it. Name `publish.yml`, the file that holds the
publishing job: a reusable workflow's jobs keep their own file's identity in the OIDC claims, which
is what this repository's `v0.1.1` release proved — the run logged
`credential: OIDC (trusted publishing)`, signed a provenance statement and published. `0.1.0` was
the manual bootstrap and carries no attestation; every release from `0.1.1` on does.

`bootstrap-sha` in `release-please-config.json` is `d537e40`, the parent of `190d767`, the first
commit of this repository's own history, so every changelog starts at `190d767` and never reaches the
Hydra-era commits below the fork point. It is a root-level option: inside `packages."."` release-please
ignores it and walks the whole history.

The repository has to stay public for provenance attestations to be published.

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
