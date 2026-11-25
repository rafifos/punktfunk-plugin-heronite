# Heronite's marks

The launcher tiles name `heronite`, and this is the art behind that token: Heronite's `H`, the same
mark its tray icons draw.

| File                  | What it is                                                         |
| --------------------- | ------------------------------------------------------------------ |
| `graphite.svg`        | Heronite's full application icon, verbatim from `packaging/icons`   |
| `graphite-small.svg`  | Heronite's small application icon, verbatim                         |
| `heronite.svg`        | The mark: the `H` from `graphite-small.svg`, as `currentColor`      |

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

## Provenance, and no licence claimed here

The marks are Heronite's, © Rafael Goulart B — the application icons and the tray art they come from:

- <https://github.com/RafaelGoulartB/Heronite> — `packaging/icons`, `app/assets/tray`

This file deliberately states no licence. The terms are the Heronite project's to set, and a file
here cannot grant what it does not hold: restating a licence that the project has not chosen would
be a claim, not a grant. Nothing in this repository publishes them either — neither the art nor this
README is in the npm tarball, and no build step compiles the SVGs into `dist`.

**What that means for step 1 above.** Before the mark goes into punktfunk it needs explicit,
permissive terms, because the destination is where an unstated licence stops being harmless:
punktfunk and its clients are MIT OR Apache-2.0, every mark already in
`assets/launcher-icons/LICENSES` is permissive (Simple Icons CC0, Font Awesome CC BY 4.0, Playnite
and Hydra MIT), and `gen-launcher-icons.sh` compiles each mark into the GTK, Windows and Apple
clients and inlines its path data into three more. A copyleft or unstated mark would be built into
binaries shipped under a permissive licence.

The permissive choices already have precedent in that folder: **CC0 1.0** (no conditions, like
Simple Icons) or **CC BY 4.0** (attribution only, like Font Awesome). Either is a one-line statement
by the copyright holder and unblocks the contribution; nothing about the files themselves changes.
