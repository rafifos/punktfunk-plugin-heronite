#!/bin/sh
# punktfunk hook: "on": "session.ended", and "host.started" for a host that stopped during a
# session.
#
# Starts the programs that punktfunk-stream-prep.sh stopped. The hook uses the environment of the
# user manager. That environment belongs to the desktop session, not to the gamescope session. The
# marker file records what the prep stopped, so a stream that stopped only Heronite does not start
# Steam.
#
# Use systemd-run, not a direct fork. The hook stops with its process group when it returns, and a
# plain setsid child also lost that race here. A transient user unit continues after the hook.
set -u

heronite_dir="${HERONITE_PROGRAM_DIR:-$HOME/Applications}"
marker="${XDG_RUNTIME_DIR:-/tmp}/punktfunk-stream-prep.stopped"

# You can also turn the restore off. PUNKTFUNK_RESTORE=0 keeps the desktop in the condition that
# the stream left it in, instead of starting what the prep stopped.
[ "${PUNKTFUNK_RESTORE:-1}" = 0 ] && exit 0

[ -f "$marker" ] || exit 0

# The session's own compositor. Compare what the process runs, not a command line that contains the
# name. `pgrep -f punktfunk-gamescope` also finds the terminal that ran this script. A wrong match
# here means the desktop never comes back.
session_alive() {
	for dir in /proc/[0-9]*; do
		exe=$(readlink "$dir/exe" 2>/dev/null) || continue
		case "${exe##*/}" in
		punktfunk-gamescope*) return 0 ;;
		esac
	done
	return 1
}

# The session stops before and after the event. Wait until it stops, because a reconnecting client
# still streams.
i=0
while [ "$i" -lt 32 ]; do
	session_alive || break
	sleep 0.25
	i=$((i + 1))
done
session_alive && exit 0

stopped=$(cat "$marker" 2>/dev/null)
rm -f "$marker"

start_desktop() {
	if command -v systemd-run >/dev/null 2>&1 &&
		systemd-run --user --collect --quiet "$@" >/dev/null 2>&1; then
		return 0
	fi
	if setsid -f "$@" </dev/null >/dev/null 2>&1; then
		return 0
	fi
	# If the start fails here, nobody knows. Record it.
	logger -t punktfunk-stream-restore "could not start $1; start it yourself"
	return 1
}

heronite_program() {
	command -v heronite-rs 2>/dev/null && return 0
	for f in "$heronite_dir"/Heronite-*.appimage "$heronite_dir"/Heronite-*.AppImage; do
		[ -x "$f" ] && {
			printf '%s\n' "$f"
			return 0
		}
	done
}

case " $stopped " in
*" steam "*)
	if command -v steam >/dev/null 2>&1 && ! pgrep -x steam >/dev/null 2>&1; then
		start_desktop steam
	fi
	;;
esac

case " $stopped " in
*" heronite "*)
	if ! pgrep -x Heronite-x86_64 >/dev/null 2>&1 && ! pgrep -x heronite-rs >/dev/null 2>&1; then
		rm -f "${XDG_RUNTIME_DIR:-/tmp}"/heronite-rs-*.sock
		program=$(heronite_program)
		[ -n "$program" ] && start_desktop "$program"
	fi
	;;
esac

logger -t punktfunk-stream-restore "restored:${stopped:-nothing}"
exit 0
