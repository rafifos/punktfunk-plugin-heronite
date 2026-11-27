#!/bin/sh
# punktfunk hook: "on": "game.running". Records where the launched game renders. If the screen stays
# black, the log gives the answer without a terminal on the host.
#
# The hook answers one question. Does the game use the session's gamescope as an X11 client
# (DISPLAY=:N, no WAYLAND_DISPLAY)? Or does it render on the desktop (DISPLAY=:0, or
# WAYLAND_DISPLAY=wayland-1)? In the second case, the gamescope WSI layer writes "Creating swapchain
# for non-Gamescope swapchain". The log then shows the cause.
set -u

# You can turn the diagnostics off. PUNKTFUNK_CAPTURE=0 writes nothing to disk.
[ "${PUNKTFUNK_CAPTURE:-1}" = 0 ] && exit 0

# `game.running` occurs when the host sees the launcher's process. Proton and the game can start a
# minute later. A delayed sample records the game itself.
delay="${PUNKTFUNK_CAPTURE_DELAY:-0}"
case "$delay" in '' | *[!0-9]*) delay=0 ;; esac
[ "$delay" -gt 0 ] && sleep "$delay"

out="${XDG_STATE_HOME:-$HOME/.local/state}/punktfunk/stream-diagnostics.log"
mkdir -p "$(dirname "$out")"

# The host writes to one file on each stream, and the file has no natural limit. Trim it before each
# write, so a host that runs for a long time does not grow it without bound. The newest samples
# matter most.
if [ -f "$out" ] && [ "$(wc -c <"$out" 2>/dev/null || echo 0)" -gt 524288 ]; then
	tail -n 2000 "$out" >"$out.tmp" && mv "$out.tmp" "$out"
fi

# The session's own compositor. Compare what the process runs, not a command line that contains the
# name. `pgrep -f punktfunk-gamescope` also finds the terminal that runs this script.
session_pids() {
	for dir in /proc/[0-9]*; do
		exe=$(readlink "$dir/exe" 2>/dev/null) || continue
		case "${exe##*/}" in
		punktfunk-gamescope*) printf '%s\n' "${dir#/proc/}" ;;
		esac
	done
}

{
	echo "=== $(date -Is) game.running title=${PF_EVENT_GAME_TITLE:-?} app=${PF_EVENT_GAME_APP:-?} delay=${delay}s"

	session=$(session_pids | head -1)
	if [ -z "$session" ]; then
		# The delayed sample can outlive a session that ends early. If the desktop is recorded here, the
		# log shows a stream that rendered to wayland-1. This caused a wrong diagnosis before.
		echo "--- no session: the stream ended before this sample; nothing about it to record"
		echo
		exit 0
	fi
	echo "session pid $session: $(tr '\0' ' ' <"/proc/$session/cmdline" 2>/dev/null | cut -c1-140)"

	# Compare `comm`, the executable's own name. A shell that only contains "wine" in its command
	# line (this hook, a terminal, an editor) is not a game process.
	found=0
	for dir in /proc/[0-9]*; do
		p=${dir#/proc/}
		[ "$p" = "$$" ] && continue
		comm=$(cat "$dir/comm" 2>/dev/null) || continue
		case "$comm" in
		*.exe | wine | wine64 | wine64-preloader | wineserver | pressure-vessel* | Proton* | reaper | steam) ;;
		*) continue ;;
		esac
		found=1
		echo "--- pid $p ($comm): $(tr '\0' ' ' <"$dir/cmdline" 2>/dev/null | cut -c1-100)"
		tr '\0' '\n' <"$dir/environ" 2>/dev/null |
			grep -E '^(DISPLAY|WAYLAND_DISPLAY|GAMESCOPE_WAYLAND_DISPLAY|ENABLE_GAMESCOPE_WSI|PUNKTFUNK_GAMESCOPE_WSI|DXVK_HDR|PROTON_ENABLE_WAYLAND|PROTON_USE_WAYLAND|SDL_VIDEODRIVER|PULSE_SINK|PULSE_SERVER)=' |
			sed 's/^/    /' || echo "    (display env unreadable)"
	done
	[ "$found" = 0 ] && echo "--- no game process found yet"

	# A surround stream leaves two traces. The host makes a null sink that advertises the channel
	# count that the client requested (pf-audio: "advertising `channels` so apps can produce real
	# surround"). A `2ch` sink therefore shows that the session selected stereo before a game had an
	# opinion. The spec of the stream then shows what the game sent to it.
	if command -v pactl >/dev/null 2>&1; then
		echo "--- audio sink: $(pactl get-default-sink 2>/dev/null || echo '?')"
		echo "--- audio sinks (id name driver spec state):"
		pactl list short sinks 2>/dev/null | sed 's/^/    /'
		echo "--- audio streams (id sink client spec):"
		pactl list short sink-inputs 2>/dev/null | sed 's/^/    /'
	else
		echo "--- audio: pactl not found"
	fi

	# Audio settings of the host: hires (uncompressed PCM) and the sink mode that it records.
	for dir in /proc/[0-9]*; do
		p=${dir#/proc/}
		[ "$p" = "$$" ] && continue
		[ "$(cat "$dir/comm" 2>/dev/null)" = "punktfunk-host" ] || continue
		tr '\0' '\n' <"$dir/environ" 2>/dev/null |
			grep -E '^PUNKTFUNK_(AUDIO_HIRES|STREAM_SINK|AUDIO_GAIN)=' |
			sed 's/^/    host: /'
		break
	done

	log=$(ls -t /run/user/"$(id -u)"/punktfunk-gamescope-*.log 2>/dev/null | head -1)
	[ -n "$log" ] && echo "session log: $log"
	echo
} >>"$out" 2>&1
exit 0
