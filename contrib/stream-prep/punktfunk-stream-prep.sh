#!/bin/sh
# punktfunk hook: "on": "game.launching", "hold": true.
#
# The hook runs before the entry's command starts. The launch waits for the hook to finish.
#
# Heronite permits one instance for each data folder. If an instance stays open on the desktop, it
# answers the session's launch and then exits. The game then opens on the host's screen, and the
# stream's display stops. This hook closes the desktop's Heronite and Steam.
# punktfunk-stream-restore.sh starts them again.
#
# A hook cannot correct where the game renders. The host starts the game with an environment that
# the hook cannot change. If a game appears on the desktop, the launcher set `WAYLAND_DISPLAY`. Look
# in the launcher's own settings.
#
# The hook stops only processes that have no GAMESCOPE_WAYLAND_DISPLAY in their environment. These
# processes belong to the desktop. A local (desk) launch does not run this hook.
set -u

heronite_dir="${HERONITE_PROGRAM_DIR:-$HOME/Applications}"
marker="${XDG_RUNTIME_DIR:-/tmp}/punktfunk-stream-prep.stopped"

[ "${PF_EVENT_GAME_PLANE:-native}" = local ] && exit 0

# You can turn the prep off. If it is off, a Heronite or Steam process that already runs on the
# desktop keeps the launch. The stream then operates only if you closed these processes yourself.
# `PUNKTFUNK_PREP=0` in the hook's run string wins over the plugin setting.

# The plugin writes this file from its two streaming settings. A hook cannot read settings, so the
# file carries them: `stop_desktop=1` or `0`, and `capture=1` or `0`.
flags="${XDG_CONFIG_HOME:-$HOME/.config}/punktfunk/plugin-state/heronite/stream-flags"
flag() {
	[ -r "$flags" ] && grep -qx "$1=0" "$flags"
}

[ "${PUNKTFUNK_PREP:-1}" = 0 ] && exit 0
flag stop_desktop && exit 0

# A game on the desktop blocks the launch. The session's Heronite gives the request to the desktop
# instance and exits. The display stops and reconnects in a loop. The hook stops the game, but only
# if it is the same title as the launch. It is worse to stop an unrelated session with unsaved data
# than to have a stream that does not start.
desk_appid() {
	# Compare the wrapper's own name, not the command line. A shell, an editor, or a grep command
	# that contains this string is not a running game.
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
			"a different Steam game is running at the desk (AppId=$running, launching=${launch_appid:-unknown}); left everything alone; quit it and reconnect"
		exit 0
	fi
	logger -t punktfunk-stream-prep "the streamed title is running at the desk (AppId=$running); stopping it"
fi

in_session() {
	tr '\0' '\n' <"/proc/$1/environ" 2>/dev/null | grep -q '^GAMESCOPE_WAYLAND_DISPLAY='
}

# Match the executable name, not the command line. A shell that only contains the path is not an
# instance. Do not stop it: it can be a terminal or this hook.
heronite_pids() {
	{
		pgrep -f "^$heronite_dir/Heronite-[^ ]*\.(appimage|AppImage)($| )" 2>/dev/null
		pgrep -x Heronite-x86_64 2>/dev/null
		pgrep -x heronite-rs 2>/dev/null
	} | sort -u
}

stopped=""

# Heronite: the desktop instance accepts heronite:// and exits. The launch then never starts in the
# session.
for p in $(heronite_pids); do
	if ! in_session "$p"; then
		kill "$p" 2>/dev/null && stopped="$stopped heronite"
	fi
done

# Steam: the game gets its environment from Steam. A Steam process on the desktop gives the game
# the display of the desktop. The `steam` command is a wrapper script that waits for the client.
# Limit the time that it can take. Without a limit, it holds the launch until the hook times out.
if pgrep -x steam >/dev/null 2>&1 && command -v steam >/dev/null 2>&1; then
	if command -v timeout >/dev/null 2>&1; then
		timeout --signal=TERM --kill-after=5 10 steam -shutdown >/dev/null 2>&1
	else
		steam -shutdown >/dev/null 2>&1
	fi
	for p in $(pgrep -x steam 2>/dev/null); do
		if ! in_session "$p"; then
			kill "$p" 2>/dev/null && stopped="$stopped steam"
		fi
	done
fi

# The wait is limited. A client that does not stop must not hold the launch.
desk_alive() {
	for p in $(heronite_pids) $(pgrep -x steam 2>/dev/null); do
		in_session "$p" || return 0
	done
	return 1
}

i=0
while [ "$i" -lt 60 ] && desk_alive; do
	sleep 0.25
	i=$((i + 1))
done

if desk_alive; then
	logger -t punktfunk-stream-prep \
		"a desktop client is still alive after 15s; the launch may be answered by the desk instance"
fi

# A stopped Heronite keeps its single-instance socket. The next start reads ECONNRESET from the
# socket and reports "already running but stopped responding". Remove the socket only when no
# instance is active. An active instance owns its socket.
if [ -z "$(heronite_pids)" ]; then
	rm -f "${XDG_RUNTIME_DIR:-/tmp}"/heronite-rs-*.sock
fi

if [ -n "$stopped" ]; then
	# Two instances of one client write two entries. Keep one.
	stopped=$(printf '%s\n' $stopped | sort -u | tr '\n' ' ')
	printf '%s\n' "$stopped" >"$marker"
	logger -t punktfunk-stream-prep "stopped:$stopped"
fi
exit 0
