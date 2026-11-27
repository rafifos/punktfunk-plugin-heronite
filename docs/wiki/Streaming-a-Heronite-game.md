# Streaming a Heronite game

Heronite runs one instance for each data folder, and a launcher sits between punktfunk and the
game. Both facts change how a stream behaves. This page covers the launch path, the hooks that
make it reliable, and the diagnostics log that records what happened.

## The launch path

**Streaming:** Heronite permits one instance for each data folder. If Heronite is already open,
your launch gives the request to that instance and exits in milliseconds. This also applies when
**Start with the system** is on, which some setups enable by default. A streamed session's dedicated
display lives only as long as the launched command. The display therefore stops, the client
reconnects, and the game starts on the host's own screen. **Quit Heronite, or turn off Start with
the system, before you stream.** The plugin then starts Heronite inside the streamed session, where
it stays until the game ends.

Let punktfunk own the compositor and the layers. punktfunk ships its own gamescope and its matching
FROG WSI Vulkan layer (`punktfunk-gamescope` installs both). For the session, the host switches off
the distro's layer, so exactly one compositor's layer is active. A game that starts outside that
environment loses it. One example is a `steam://` hand-off to a Steam process that already runs on
the desktop. The active layer then reports `CreateSwapchainKHR: Creating swapchain for non-Gamescope
swapchain` or `Hooking has failed somewhere! You may have a bad Vulkan layer interfering` for a
window that the compositor never owned. That dialog stops the game before it creates a window, so
the stream has nothing to show while the game appears on the host's screen. **Quit Steam as well as
Heronite before you stream**, so the session starts its own. The hooks below do this for you.

If the dialog still appears, read the environment of the game
(`tr '\0' '\n' < /proc/<game pid>/environ`). Inside the session it has `GAMESCOPE_WAYLAND_DISPLAY`
and `PUNKTFUNK_GAMESCOPE_WSI=1`, and `WAYLAND_DISPLAY` is empty. If `WAYLAND_DISPLAY` is not empty,
a program before Steam set it. See [What sets `WAYLAND_DISPLAY`](#what-sets-wayland_display).

## The hooks

**You do not need to quit them by hand.** Install the hooks. `hooks.json` supports `"hold": true`
on `game.launching`. The launch waits for the hook, so the hook runs before the entry's command. A
connect hook only races the launch and loses. The installer puts the three scripts in
`~/.local/bin` and adds five entries to `~/.config/punktfunk/hooks.json`. The entries are
`game.launching` for the prep, `game.running` twice for the diagnostics sample, and `session.ended`
plus `host.started` for the restore. The installer then restarts the host. You do not need a
checkout:

```sh
curl -fsSL https://raw.githubusercontent.com/rafifos/punktfunk-plugin-heronite/main/contrib/stream-prep/install.sh | sh
```

The installer is idempotent. It replaces the entries that it owns and keeps every other hook in the
file, so you can run it again after an update. `PLUGIN_REF=…` sets the ref that it downloads from.
`HERONITE_PROGRAM_DIR=…` sets the app folder when the AppImage is not in `~/Applications`. From a
checkout, `contrib/stream-prep/install.sh` installs the files beside it instead of downloading them.

## Settings

Two of these are switches in the plugin's own settings page:

| Setting                                          | Default | What it does                                                        |
| ------------------------------------------------ | ------- | ------------------------------------------------------------------- |
| Close desktop Heronite and Steam before a stream | on      | the prep hook stops a Heronite or Steam that is open on the desktop |
| Record a diagnostics sample for each stream      | on      | the capture hook writes `stream-diagnostics.log`                    |

A hook cannot read the plugin's settings, because it is a child of the host and sees the host's
environment. The plugin therefore writes them to its own state folder, one flag per line:

```
~/.config/punktfunk/plugin-state/heronite/stream-flags
```

```sh
stop_desktop=1
capture=1
```

The hooks compare whole lines with `grep -qx`, so editing that file by hand works too. Delete it and
both hooks fall back to their defaults, which are on.

The other three switches are for the hook's `run` string, or the installer's environment. They take
precedence over the plugin setting:

```sh
PUNKTFUNK_PREP=0     # never stop anything; close Steam/Heronite yourself before a stream
PUNKTFUNK_RESTORE=0  # never start them again when a session ends
PUNKTFUNK_CAPTURE=0  # never write a diagnostics sample
```

The prep stops only processes that do not have `GAMESCOPE_WAYLAND_DISPLAY` in their environment. The
session's own Heronite and Steam are never touched, and a launch at the desk is skipped. The prep
also leaves everything alone when a Steam game runs on the desktop, because it is worse to stop a
session with unsaved data than to have a stream that does not start. It writes a line in the
journal in that case. The restore starts the programs again when gamescope has stopped. It uses
`systemd-run --user` so that they continue after the process group of the hook. A stopped Heronite
keeps `$XDG_RUNTIME_DIR/heronite-rs-*.sock`. The next start reads `ECONNRESET` from that socket and
reports _already running but stopped responding_, so the prep removes the socket when no instance is
active. You can get the same result once without hooks: turn off _Run Steam when my computer starts_
in Steam and _Start with the system_ in Heronite.

## The diagnostics log

The hooks take two samples: one at `game.running` and one 25 s later. The second sample is necessary
because `game.running` occurs when the launcher's process appears, which is often a minute before
Proton and the game exist. The samples write
`~/.local/state/punktfunk/stream-diagnostics.log`. The file has one block for each launched game. A
block lists the Wine, Proton and session processes with their `DISPLAY`, `WAYLAND_DISPLAY`,
`GAMESCOPE_WAYLAND_DISPLAY` and WSI variables. It also lists the audio path: the default sink, the
channel format of each sink, and the format of each stream. These values show whether a game renders
inside the session or on the desktop. The gamescope layer reports a non-gamescope swapchain only in
the second case. A black screen therefore leaves the answer in the log, and you do not need a
terminal on the host while it happens:

```sh
tail -20 ~/.local/state/punktfunk/stream-diagnostics.log
```

The file has a cap. When it is larger than 512 KiB, the oldest lines are discarded, so a host that
runs for a long time does not grow it without limit. `PUNKTFUNK_CAPTURE=0` turns the samples off,
together with `PUNKTFUNK_PREP=0` and `PUNKTFUNK_RESTORE=0` for the other two hooks. A delayed sample
that outlives its session records that fact and stops. It does not report the desktop as if it were
the stream.

## A real capture

A real capture from a gamescope session shows why the log matters. This capture is from before the
launcher stopped setting the variable:

```
--- pid 272301 (steam): … steam://rungameid/3527290
    GAMESCOPE_WAYLAND_DISPLAY=gamescope-0
    PUNKTFUNK_GAMESCOPE_WSI=1          # our layer is live in this process
    WAYLAND_DISPLAY=wayland-1          # …and this is the DESKTOP's compositor: the broken case
    ENABLE_GAMESCOPE_WSI=0
    DISPLAY=:2
```

With the correct entry, the third line reads `WAYLAND_DISPLAY=`, which is empty. An empty value puts
the game on the session's compositor.

Steam's runtime exposes the Wayland socket of the host session again inside the container. A
Wayland-capable client under it therefore presents to KWin while the gamescope WSI layer is loaded.
That is exactly when the layer reports `Creating swapchain for non-Gamescope swapchain`. The
condition is in the environment of the game, so the correction belongs where the variable comes
from.

## HDR and audio

HDR is not affected. The HDR10 swapchain comes from the gamescope WSI layer over X11
(`--hdr-enabled`, `PUNKTFUNK_GAMESCOPE_WSI=1`, `DXVK_HDR=1`), and none of these reads
`WAYLAND_DISPLAY`.

The diagnostics log records `WAYLAND_DISPLAY`, `PROTON_ENABLE_WAYLAND`, `PROTON_USE_WAYLAND` and
`SDL_VIDEODRIVER` for each game process. It therefore shows whether the setting arrived.

**Sound is a client setting, and 5.1 is one of the options.** The host opens its capture at the
channel count that the client asked for. `pf-audio` says: "a host-owned null sink claimed as the
session default, advertising `channels` so apps can produce real surround". `AudioParams` accepts 2,
6 (5.1) or 8 (7.1) channels. `AudioLayout` has Opus layouts for all three, and 7.1.4 is padded with
silence for each frame. Above Opus, **Lossless** sends uncompressed PCM instead. It requires
`PUNKTFUNK_AUDIO_HIRES`, which is on by default, and a quarter of the video bitrate. A soundbar that
the TV feeds with PCM is therefore the expected path. Set the client to **Audio channels: 5.1** and
**Audio quality: Lossless**. The diagnostics log shows the result. A sink with `6ch` means that the
session selected surround before a game had an opinion. A stream that is still `2ch` means that the
game never produced surround.

## A game already running on the desktop

A game that already runs on the desktop is handled by title. If its Steam AppId is the same as the
entry being launched, the prep stops it. Without that, the session's Heronite gives the launch to
the desktop instance and exits, which stops the display and causes a reconnect loop. The prep leaves
a different title alone and writes a line in the journal.

## The window the host waits for

A streamed game entry also waits for the game's own window before the client shows it. The host
reports the game as `running` when its process starts, but it holds the splash until the window
appears. The host's own note says this is "often far later than its process: a Proton prefix build,
a splash on a black window". A chain such as Heronite then Steam can take longer than the client
waits. For that shape, stream the **Heronite** tile instead. A launcher entry keeps the session
active until you leave it, so the stream shows Heronite's own window and you start the game there.
Prefer this flow when a launcher is before the game.

The protocol fallback starts Heronite on the host's own screen. When a client asks for its own mode,
the host creates a dedicated display with the lifetime of the launched command. A hand-off command
exits at once, so the display stops and the client reconnects. Give the plugin a program before you
stream Heronite titles: `heronite-rs` on `PATH`, the program folder, or Flatpak.
