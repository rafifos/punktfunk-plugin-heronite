#!/bin/sh
# Installs the streaming hooks: both scripts into ~/.local/bin, three entries into
# ~/.config/punktfunk/hooks.json, then restarts the host so it reloads host.env.
#
# Idempotent: entries this script owns are replaced, every other hook is kept.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bin="${HOME}/.local/bin"
conf="${XDG_CONFIG_HOME:-$HOME/.config}/punktfunk"
hooks="$conf/hooks.json"

mkdir -p "$bin" "$conf"
install -m 755 "$here/punktfunk-stream-prep.sh" "$bin/punktfunk-stream-prep.sh"
install -m 755 "$here/punktfunk-stream-restore.sh" "$bin/punktfunk-stream-restore.sh"

python3 - "$hooks" "$bin" <<'PY'
import json
import os
import sys

path, bin_dir = sys.argv[1], sys.argv[2]
prep = os.path.join(bin_dir, "punktfunk-stream-prep.sh")
restore = os.path.join(bin_dir, "punktfunk-stream-restore.sh")
ours = [
    {
        "on": "game.launching",
        "filter": {"plane": "native"},
        "run": prep,
        "hold": True,
        "timeout_s": 60,
    },
    {"on": "session.ended", "run": restore, "timeout_s": 60},
    {"on": "host.started", "run": restore, "timeout_s": 60},
]

try:
    with open(path) as f:
        config = json.load(f)
except FileNotFoundError:
    config = {}

kept = [h for h in config.get("hooks", []) if not (isinstance(h, dict) and h.get("run") in (prep, restore))]
config["hooks"] = kept + ours

with open(path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")

print(f"{path}: {len(config['hooks'])} hook(s)")
PY

systemctl --user restart punktfunk-host 2>/dev/null ||
    systemctl restart punktfunk-host 2>/dev/null ||
    echo "restart the host yourself; hooks apply from the next event"
echo "installed: $bin/punktfunk-stream-{prep,restore}.sh + $hooks"
