# What sets WAYLAND_DISPLAY

`WAYLAND_DISPLAY` in a game's environment makes the game render to the desktop compositor
instead of the session's gamescope. The gamescope WSI layer then reports a non-gamescope
swapchain and the client shows a black screen. This page records where the variable comes from.

What sets `WAYLAND_DISPLAY`

The environment of the session is clean. The host starts the session without `WAYLAND_DISPLAY`, so
the variable reaches the game only if the launcher before Steam sets it. This host was measured by
capturing the same title through punktfunk's own `steam:` entry and through Heronite's entry:

| Entry                       | session's own Steam         | game   |
| --------------------------- | --------------------------- | ------ |
| `steam:2483190`             | no `WAYLAND_DISPLAY`        | fine   |
| `heronite:sideload:steam_…` | `WAYLAND_DISPLAY=wayland-1` | broken |

Look at the launcher, not at Steam. A `WAYLAND_DISPLAY` entry in the launcher's environment options,
for one app or for all apps, goes into the session's Steam and from there into the game. Remove that
entry to correct the problem. No launch option is necessary after that.

If a launcher keeps the variable and its settings do not let you remove it, two alternatives remain:

| Where                          | Setting                            | What it does                                                        |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------- |
| Heronite → environment options | `WAYLAND_DISPLAY` = _(empty)_      | client tries `wayland-0`, fails, falls back to X11 inside gamescope |
| Steam → launch options         | `env -u WAYLAND_DISPLAY %command%` | removes the variable for that title only                            |

Both alternatives work. The first is one setting for all titles. The second applies to one game.
Neither replaces the removal of the entry that set the variable. Earlier revisions of these notes
documented the per-game option first and then the launcher's global variable. The measurements
above settled the question.

A hook cannot do this. The host starts the game with an environment that the hook cannot change.
That is why the prep script closes instances instead of changing variables.

**The plugin does not try to set the variable.** An earlier revision wrapped every transport in
`env PROTON_ENABLE_WAYLAND=0`. A capture of the running game showed `PEAK.exe` with
`WAYLAND_DISPLAY=wayland-1` and no `PROTON_ENABLE_WAYLAND`, so that prefix was reverted. It was not
left in place to look like a fix. `ExecTemplate` has no environment field, and the host reads the
manifest before the plugin runs, so a console toggle could not reach the game either. Nothing before
the game's own launch can set a variable that the game does not already have. The correction is
therefore the launcher's own setting, not a plugin, a hook or a prefix.
