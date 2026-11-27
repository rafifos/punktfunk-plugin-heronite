#!/bin/sh
# punktfunk hook: "on": "session.ended" (and "host.started", for a host that died mid-session).
#
# Starts what punktfunk-stream-prep.sh stopped, from the user manager's environment — the desktop
# session's, not a gamescope session's. The marker names what that was, so a stream that only
# stopped Heronite does not open Steam.
#
# Through systemd-run, not a bare fork: a hook is killed with its process group when it returns, and
# a plain setsid child still lost that race here. A transient user unit outlives it.
set -u

heronite_dir="${HERONITE_PROGRAM_DIR:-$HOME/Applications}"
marker="${XDG_RUNTIME_DIR:-/tmp}/punktfunk-stream-prep.stopped"

# Starting them again is a choice too: PUNKTFUNK_RESTORE=0 leaves the desktop exactly as the stream
# left it, instead of restoring what the prep stopped.
[ "${PUNKTFUNK_RESTORE:-1}" = 0 ] && exit 0

[ -f "$marker" ] || exit 0

# The session is torn down around the event: wait it out, or a reconnect is still streaming.
i=0
while [ "$i" -lt 32 ]; do
	pgrep -f 'punktfunk-gamescope' >/dev/null 2>&1 || break
	sleep 0.25
	i=$((i + 1))
done
pgrep -f 'punktfunk-gamescope' >/dev/null 2>&1 && exit 0

stopped=$(cat "$marker" 2>/dev/null)
rm -f "$marker"

start_desktop() {
	if command -v systemd-run >/dev/null 2>&1 &&
		systemd-run --user --collect --quiet "$@" >/dev/null 2>&1; then
		return 0
	fi
	setsid -f "$@" </dev/null >/dev/null 2>&1
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
