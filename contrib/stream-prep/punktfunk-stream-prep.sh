#!/bin/sh
# punktfunk hook: "on": "game.launching", "hold": true.
#
# Runs before the entry's command starts, and the launch waits for it. A gamescope session starts
# its game from the session's own Heronite, which hands the launch to Steam; an instance left on the
# desktop answers those hand-offs with the desktop environment, so the game opens on the host's
# screen instead of the stream, and the gamescope WSI layer reports "CreateSwapchainKHR: Creating
# swapchain for non-Gamescope swapchain".
#
# Only processes without GAMESCOPE_WAYLAND_DISPLAY in their environment are stopped: those are the
# desktop's. A local (desk) launch never runs this.
set -u

heronite_dir="${HERONITE_PROGRAM_DIR:-$HOME/Applications}"
marker="${XDG_RUNTIME_DIR:-/tmp}/punktfunk-stream-prep.stopped"

[ "${PF_EVENT_GAME_PLANE:-native}" = local ] && exit 0

# Turning the prep off is a supported choice: with it off, a Heronite or Steam already running on the
# desktop keeps the launch, so the stream only works if you closed them yourself.
[ "${PUNKTFUNK_PREP:-1}" = 0 ] && exit 0

# A game running at the desk blocks the launch: the session's Heronite hands the request to the
# desktop instance and exits, which tears the display down and reconnects in a loop. Stop it, but only
# when it is the same title this launch is for — killing somebody's unrelated, unsaved session is
# worse than a stream that cannot start.
desk_appid() {
    # Match the wrapper's own name, not the command line: a shell that merely mentions this string
    # (the hook run by hand, an editor, a grep) is not a running game.
    for p in $(pgrep -x reaper 2>/dev/null); do
        cmd=$(tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null) || continue
        case "$cmd" in *"SteamLaunch AppId="*) ;; *) continue ;; esac
        printf '%s\n' "$cmd" | sed -n 's/.*AppId=\([0-9][0-9]*\).*/\1/p'
        return 0
    done
    return 1
}

launch_appid=$(printf '%s' "${PF_EVENT_GAME_APP:-}" | sed -n 's/.*steam_\([0-9][0-9]*\)$/\1/p')
if running=$(desk_appid); then
    if [ -z "$launch_appid" ] || [ "$running" != "$launch_appid" ]; then
        logger -t punktfunk-stream-prep \
            "a different Steam game is running at the desk (AppId=$running, launching=${launch_appid:-unknown}); left everything alone — quit it and reconnect"
        exit 0
    fi
    logger -t punktfunk-stream-prep "the streamed title is running at the desk (AppId=$running); stopping it"
fi
if pgrep -f 'reaper SteamLaunch AppId=' >/dev/null 2>&1; then
    logger -t punktfunk-stream-prep "a Steam game is running at the desk; left everything alone"
    exit 0
fi

in_session() {
    tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | grep -q '^GAMESCOPE_WAYLAND_DISPLAY='
}

# Anchored on argv[0] or the executable name: a shell whose command line merely mentions the path
# is not an instance, and killing it would take a terminal or this hook down with it.
heronite_pids() {
    {
        pgrep -f "^$heronite_dir/Heronite-[^ ]*\.(appimage|AppImage)($| )" 2>/dev/null
        pgrep -x Heronite-x86_64 2>/dev/null
        pgrep -x heronite-rs 2>/dev/null
    } | sort -u
}

stopped=""

# Heronite: the desktop instance takes heronite:// and exits, so the launch never enters the session.
for p in $(heronite_pids); do
    if ! in_session "$p"; then
        kill "$p" 2>/dev/null && stopped="$stopped heronite"
    fi
done

# Steam: the game inherits its environment, so a desktop Steam leaks the desktop display.
if pgrep -x steam >/dev/null 2>&1; then
    command -v steam >/dev/null 2>&1 && steam -shutdown >/dev/null 2>&1
    for p in $(pgrep -x steam 2>/dev/null); do
        if ! in_session "$p"; then
            kill "$p" 2>/dev/null && stopped="$stopped steam"
        fi
    done
fi

# Bounded: a client that will not die must not hang the launch it is holding.
i=0
while [ "$i" -lt 60 ]; do
    alive=0
    for p in $(heronite_pids); do
        in_session "$p" || alive=1
    done
    for p in $(pgrep -x steam 2>/dev/null); do
        in_session "$p" || alive=1
    done
    [ "$alive" = 0 ] && break
    sleep 0.25
    i=$((i + 1))
done

# A terminated Heronite leaves its single-instance socket behind, and the next start reads
# ECONNRESET from it and reports "already running but stopped responding" instead of starting.
# Only when no instance is alive: a live one owns its socket.
if [ -z "$(heronite_pids)" ]; then
    rm -f "${XDG_RUNTIME_DIR:-/tmp}"/heronite-rs-*.sock
fi

if [ -n "$stopped" ]; then
    printf '%s\n' "$stopped" >"$marker"
    logger -t punktfunk-stream-prep "stopped:$stopped"
fi
exit 0
