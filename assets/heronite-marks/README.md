# Heronite's marks

The launcher tiles name `heronite`, and this is the art behind that token: Heronite's `H`, the same
mark its tray icons draw.

| File                  | What it is                                                         |
| --------------------- | ------------------------------------------------------------------ |
| `graphite.svg`        | Heronite's full application icon, verbatim from `packaging/icons`   |
| `graphite-small.svg`  | Heronite's small application icon, verbatim                         |
| `heronite.svg`        | The mark: the `H` from `graphite-small.svg`, as `currentColor`      |
| `LICENSE-GPL-3.0.txt` | The licence the four files above are under                          |

Heronite's tray folder (`app/assets/tray`) holds the same `H` as `icon-dark.png` and
`icon-light.png`, but only as 64 px rasters, in two colours. `heronite.svg` is that mark as vector:
the glyph path from the application icon, in `currentColor` so one file serves both themes, framed
square with the margin the tray art leaves so it fills a tile the way the tray mark does.

Both launcher tiles name the same mark, because Heronite has one.

## Why the application icons are not what a tile draws

`icon` takes a **token** matching `[a-z][a-z0-9-]{0,31}`, never bytes and never a URL, and each
client resolves it against the marks it bundles. punktfunk's bundled marks are all monochrome
(`fill="currentColor"`), so a tile draws them in its own ink; the application icons are a gradient
plate with a red button, which no tile could take. The `H` is the part that survives that treatment,
and it is the part Heronite itself uses where the application icon would not fit.

## What still has to happen for a tile to draw it

Nothing here changes what a tile renders. The mark reaches a tile through punktfunk's
`assets/launcher-icons`, not through this plugin:

1. Copy `heronite.svg` to `assets/launcher-icons/heronite.svg`.
2. Add a row for it to the table in `assets/launcher-icons/README.md`.
3. Add `heronite` to `LAUNCHER_ICONS` in the plugin kit's `wire.ts`.
4. Run `bash scripts/gen-launcher-icons.sh heronite` and follow the checklist it prints — the
   per-client derivatives plus each client's shipped-token list.
5. Record the attribution in `assets/launcher-icons/LICENSES/` and fold it into
   `THIRD-PARTY-NOTICES.txt`.

This plugin needs no change afterwards: it already names the token, so its tiles light up on clients
that ship the mark and keep falling back to the tile name on those that do not.

These files are not in the published package — `files` in `package.json` lists only `dist` and the
two code licences.

## Licence

The marks are **GNU GPL v3.0**, © Rafael Goulart B, kept separate from this package's
MIT OR Apache-2.0 code. The full text is beside them in `LICENSE-GPL-3.0.txt`.

- Source: <https://github.com/RafaelGoulartB/Heronite> — `packaging/icons` and `app/assets/tray`
- Licence: GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>

GPL-3.0 settles what these files' terms are. Heronite's repository is GPL-3.0, its `licenses/`
folder only records third-party components (the CC BY 3.0 entry there is Zacksly's controller
drawings, not these), and no icon-specific licence existed — so this states the repository's own
default rather than changing it.

### Before step 1 above, the licence has to change again

The destination is permissive, and this is the one place it matters: punktfunk and its clients are
MIT OR Apache-2.0, and every mark already in `assets/launcher-icons/LICENSES` is permissive —
Simple Icons CC0, Font Awesome CC BY 4.0, Playnite and Hydra MIT. Those marks do not stay separate
files at build time: `gen-launcher-icons.sh` bakes each one into the GTK, Windows and Apple clients
and inlines its path data into three more, so a copyleft mark would be compiled into binaries
shipped under a permissive licence.

That is the case copyleft is designed to catch, and it would make the mark unusable upstream. The
copy in this repository is unaffected: these files are neither compiled into `dist` nor published.

The copyright holder can settle it in one sentence, and the permissive choices already have
precedent in that folder: **CC0 1.0** (no conditions, like Simple Icons) or **CC BY 4.0**
(attribution only, like Font Awesome). Either replaces GPL-3.0 for these four files and unblocks the
contribution; nothing else about them changes.
