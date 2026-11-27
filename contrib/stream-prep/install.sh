#!/bin/sh
# Installs the streaming hooks. The script copies three scripts to ~/.local/bin and adds five
# entries to ~/.config/punktfunk/hooks.json. It then restarts the host to reload host.env.
#
#   curl -fsSL https://raw.githubusercontent.com/rafifos/punktfunk-plugin-heronite/main/contrib/stream-prep/install.sh | sh
#
# The script is idempotent. It replaces the entries that it owns and keeps every other hook. If you
# run it from a checkout, it installs the files next to it. If you pipe it from curl, it downloads
# the files from the same ref. PLUGIN_REF sets the ref to download (default main).
# HERONITE_PROGRAM_DIR sets the app folder.
set -eu

repo="rafifos/punktfunk-plugin-heronite"
ref="${PLUGIN_REF:-main}"
raw="https://raw.githubusercontent.com/$repo/$ref/contrib/stream-prep"

bin="${HOME}/.local/bin"
conf="${XDG_CONFIG_HOME:-$HOME/.config}/punktfunk"
hooks="$conf/hooks.json"

# When the script is piped to `sh`, $0 is the shell name, not a path. There are no files next to it
# to copy.
here=""
case "$0" in
sh | bash | dash | -sh | */sh | */bash) ;;
*) here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) ;;
esac

fetch() {
    if [ -n "$here" ] && [ -f "$here/$1" ]; then
        install -m 755 "$here/$1" "$2"
        return 0
    fi
    tmp=$(mktemp)
    if curl -fsSL "$raw/$1" -o "$tmp" 2>/dev/null; then
        install -m 755 "$tmp" "$2"
        rm -f "$tmp"
    else
        rm -f "$tmp"
        printf 'install: cannot fetch %s from %s\n' "$1" "$raw/$1" >&2
        exit 1
    fi
}

mkdir -p "$bin" "$conf"
fetch punktfunk-stream-prep.sh "$bin/punktfunk-stream-prep.sh"
fetch punktfunk-stream-restore.sh "$bin/punktfunk-stream-restore.sh"
fetch punktfunk-stream-capture.sh "$bin/punktfunk-stream-capture.sh"

python3 - "$hooks" "$bin" <<'PY'
import json
import os
import sys

path, bin_dir = sys.argv[1], sys.argv[2]
prep = os.path.join(bin_dir, "punktfunk-stream-prep.sh")
restore = os.path.join(bin_dir, "punktfunk-stream-restore.sh")
capture = os.path.join(bin_dir, "punktfunk-stream-capture.sh")
ours = [
    {
        "on": "game.launching",
        "filter": {"plane": "native"},
        "run": prep,
        "hold": True,
        "timeout_s": 60,
    },
    {"on": "game.running", "run": capture, "timeout_s": 60},
    # The same sample later, after the Proton prefix of Steam and the game start. `game.running` can
    # occur a minute before the game has a window, and the important processes start later.
    {"on": "game.running", "run": f"PUNKTFUNK_CAPTURE_DELAY=25 {capture}", "timeout_s": 60},
    {"on": "session.ended", "run": restore, "timeout_s": 60},
    {"on": "host.started", "run": restore, "timeout_s": 60},
]

try:
    with open(path) as f:
        config = json.load(f)
except FileNotFoundError:
    config = {}

owned = (prep, restore, capture)
kept = [
    h
    for h in config.get("hooks", [])
    if not (isinstance(h, dict) and any(o in (h.get("run") or "") for o in owned))
]
config["hooks"] = kept + ours

with open(path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")

print(f"{path}: {len(config['hooks'])} hook(s)")
PY

systemctl --user restart punktfunk-host 2>/dev/null ||
    systemctl restart punktfunk-host 2>/dev/null ||
    echo "restart the host yourself; hooks apply from the next event"
echo "installed: $bin/punktfunk-stream-{prep,restore,capture}.sh + $hooks"
