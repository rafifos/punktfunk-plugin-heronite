#!/bin/sh
# punktfunk hook: "on": "game.running". Writes where the launched game renders, so a black screen
# leaves evidence instead of needing somebody at a terminal while it happens.
#
# The question it answers: is the game an X11 client of the session's gamescope (DISPLAY=:N, no
# WAYLAND_DISPLAY) or has it escaped to the desktop (DISPLAY=:0, or WAYLAND_DISPLAY=wayland-1)?
# The gamescope WSI layer reports "Creating swapchain for non-Gamescope swapchain" exactly when the
# second happens, so the log names the cause rather than a symptom.
set -u

# `game.running` fires when the host sees the launcher's process, which can be a minute before
# Proton and the game exist. A delayed sample catches the game itself.
delay="${PUNKTFUNK_CAPTURE_DELAY:-0}"
case "$delay" in '' | *[!0-9]*) delay=0 ;; esac
[ "$delay" -gt 0 ] && sleep "$delay"

out="${XDG_STATE_HOME:-$HOME/.local/state}/punktfunk/stream-diagnostics.log"
mkdir -p "$(dirname "$out")"

{
    echo "=== $(date -Is) game.running title=${PF_EVENT_GAME_TITLE:-?} app=${PF_EVENT_GAME_APP:-?} delay=${delay}s"

    for p in $(pgrep -f 'punktfunk-gamescope' 2>/dev/null); do
        echo "session pid $p: $(tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null | cut -c1-140)"
        break
    done

    # Match on `comm`, the executable's own name: a shell whose command line merely mentions
    # wine (this hook, a terminal, an editor) is not a game process.
    found=0
    for dir in /proc/[0-9]*; do
        p=${dir#/proc/}
        [ "$p" = "$$" ] && continue
        comm=$(cat "$dir/comm" 2>/dev/null) || continue
        case "$comm" in
        *.exe | wine | wine64 | wine64-preloader | wineserver | pressure-vessel* | Proton* |             reaper | steam) ;;
        *) continue ;;
        esac
        found=1
        echo "--- pid $p ($comm): $(tr '\0' ' ' <"$dir/cmdline" 2>/dev/null | cut -c1-100)"
        tr '\0' '\n' <"$dir/environ" 2>/dev/null |
            grep -E '^(DISPLAY|WAYLAND_DISPLAY|GAMESCOPE_WAYLAND_DISPLAY|ENABLE_GAMESCOPE_WSI|PUNKTFUNK_GAMESCOPE_WSI|DXVK_HDR|PROTON_ENABLE_WAYLAND|PROTON_USE_WAYLAND|SDL_VIDEODRIVER)=' |
            sed 's/^/    /' || echo "    (display env unreadable)"
    done
    [ "$found" = 0 ] && echo "--- no game process found yet"

    log=$(ls -t /run/user/"$(id -u)"/punktfunk-gamescope-*.log 2>/dev/null | head -1)
    [ -n "$log" ] && echo "session log: $log"
    echo
} >>"$out" 2>&1
exit 0
