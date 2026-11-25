#!/bin/sh
# Installs the streaming hooks: both scripts into ~/.local/bin, three entries into
# ~/.config/punktfunk/hooks.json, then restarts the host so it reloads host.env.
#
#   curl -fsSL https://raw.githubusercontent.com/rafifos/punktfunk-plugin-heronite/main/contrib/stream-prep/install.sh | sh
#
# Idempotent: entries this script owns are replaced, every other hook is kept. Run from a checkout
# it installs the files beside it; piped from curl it downloads them from the same ref.
# PLUGIN_REF pins the ref to download (default main), HERONITE_PROGRAM_DIR the app folder.
set -eu

repo="rafifos/punktfunk-plugin-heronite"
ref="${PLUGIN_REF:-main}"
raw="https://raw.githubusercontent.com/$repo/$ref/contrib/stream-prep"

bin="${HOME}/.local/bin"
conf="${XDG_CONFIG_HOME:-$HOME/.config}/punktfunk"
hooks="$conf/hooks.json"

# Piped to `sh`, $0 is the shell, not a path: there are no siblings to copy.
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
    {"on": "session.ended", "run": restore, "timeout_s": 60},
    {"on": "host.started", "run": restore, "timeout_s": 60},
]

try:
    with open(path) as f:
        config = json.load(f)
except FileNotFoundError:
    config = {}

owned = (prep, restore, capture)
kept = [h for h in config.get("hooks", []) if not (isinstance(h, dict) and h.get("run") in owned)]
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
