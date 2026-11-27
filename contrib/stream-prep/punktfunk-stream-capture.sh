#!/bin/sh
# punktfunk hook: "on": "game.running". Writes where the launched game renders, so a black screen
# leaves evidence instead of needing somebody at a terminal while it happens.
#
# The question it answers: is the game an X11 client of the session's gamescope (DISPLAY=:N, no
# WAYLAND_DISPLAY) or has it escaped to the desktop (DISPLAY=:0, or WAYLAND_DISPLAY=wayland-1)?
# The gamescope WSI layer reports "Creating swapchain for non-Gamescope swapchain" exactly when the
# second happens, so the log names the cause rather than a symptom.
set -u

# Diagnostics are opt-out: PUNKTFUNK_CAPTURE=0 leaves no trace on disk.
[ "${PUNKTFUNK_CAPTURE:-1}" = 0 ] && exit 0

# `game.running` fires when the host sees the launcher's process, which can be a minute before
# Proton and the game exist. A delayed sample catches the game itself.
delay="${PUNKTFUNK_CAPTURE_DELAY:-0}"
case "$delay" in '' | *[!0-9]*) delay=0 ;; esac
[ "$delay" -gt 0 ] && sleep "$delay"

out="${XDG_STATE_HOME:-$HOME/.local/state}/punktfunk/stream-diagnostics.log"
mkdir -p "$(dirname "$out")"

# One file, appended to on every stream, forever. Trim before writing so a long-lived host does not
# grow it without bound; the newest samples are the ones worth keeping.
if [ -f "$out" ] && [ "$(wc -c <"$out" 2>/dev/null || echo 0)" -gt 524288 ]; then
	tail -n 2000 "$out" >"$out.tmp" && mv "$out.tmp" "$out"
fi

# The session's own compositor, found by what the process *is*, not by a command line that mentions
# it: `pgrep -f punktfunk-gamescope` also matches the terminal running this script.
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
		# The delayed sample outlives a session that ended early. Recording the desktop here reads
		# as a stream that rendered to wayland-1, which is how it was misdiagnosed once already.
		echo "--- no session: the stream ended before this sample; nothing about it to record"
		echo
		exit 0
	fi
	echo "session pid $session: $(tr '\0' ' ' <"/proc/$session/cmdline" 2>/dev/null | cut -c1-140)"

	# Match on `comm`, the executable's own name: a shell whose command line merely mentions
	# wine (this hook, a terminal, an editor) is not a game process.
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

	# Surround leaves two traces. The host mints a null sink advertising the channel count the
	# client asked for (pf-audio: "advertising `channels` so apps can produce real surround"), so a
	# `2ch` sink means the session negotiated stereo before any game had an opinion. The stream's
	# own spec then says what the game actually produced into it.
	if command -v pactl >/dev/null 2>&1; then
		echo "--- audio sink: $(pactl get-default-sink 2>/dev/null || echo '?')"
		echo "--- audio sinks (id name driver spec state):"
		pactl list short sinks 2>/dev/null | sed 's/^/    /'
		echo "--- audio streams (id sink client spec):"
		pactl list short sink-inputs 2>/dev/null | sed 's/^/    /'
	else
		echo "--- audio: pactl not found"
	fi

	# The host's own audio levers: hires (uncompressed PCM) and which sink mode it captures.
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
