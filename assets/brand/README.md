# Brand art

The images that introduce the plugin outside its own UI, and the art the two launcher tiles carry
into Punktfunk.

## Repository banners

| File                          | Size       | Where it goes                                                                                                        |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `banner-heronite.png`         | 1200 × 320 | the strip at the top of the README, for the desktop tile                                                             |
| `banner-heronite-console.png` | 1200 × 320 | a console mode page or release note                                                                                  |
| `social-card.png`             | 1280 × 640 | the repository's social preview: **Settings**, then **Social preview**, then upload. GitHub has no API for this one. |

Each `.png` has an `.svg` source of the same name beside it. Use the `.png` where the image must
show its words: some viewers draw an SVG through a sanitiser that removes `<text>`, which leaves the
mark alone on the plate.

## Tile art

One set per tile, in the four slots a normal game entry receives: `portrait`, `hero`, `logo` and
`header`. `launcherTiles` points each slot at the PNG's raw URL, and the host's art proxy fetches
the file once and serves it from its own store.

| Slot     | Size       | Desktop file            | Console file                    |
| -------- | ---------- | ----------------------- | ------------------------------- |
| portrait | 600 × 900  | `portrait-heronite.png` | `portrait-heronite-console.png` |
| hero     | 1920 × 620 | `hero-heronite.png`     | `hero-heronite-console.png`     |
| logo     | 800 × 240  | `logo-heronite.png`     | `logo-heronite-console.png`     |
| header   | 460 × 215  | `header-heronite.png`   | `header-heronite-console.png`   |

Each `.png` again has an `.svg` source of the same name. The logos are the only transparent files:
the rest carry the plate.

## How they are made

The colours are the custom properties of heronite.app: `--text` `#eef2f6` for the mark and the
name, `--muted` `#a7b2be` for the tagline, and a plate that runs from `--surface-2` `#141921` to
`#0a0d11`. The type is Rubik, the face heronite.app itself uses, with the system sans as the
fallback.

The desktop art draws the `H` from
[../heronite-marks/graphite-small.svg](../heronite-marks/graphite-small.svg). The console art draws
the same `H` plus the controller buttons of the application icon in
[../heronite-marks/graphite.svg](../heronite-marks/graphite.svg): a d-pad and four dots, one of
them red.

Every file that shows words shows its tile's title and description, the same strings
`launcherTiles` publishes: `Heronite`, "The game launcher's desktop window.", and `Heronite
Console`, "A controller-first layout for a TV or Steam Deck." The headers stop at the title, and
the logos carry the title beside the mark on a transparent field.

The card holds the same mark on the same plate, and names the plugin in two lines: "The Punktfunk
plugin for Heronite." and "Each game gets an entry in the host library, and Heronite itself launches
it."

To remake a raster:

```sh
for svg in assets/brand/*.svg; do
  rsvg-convert "$svg" -o "${svg%.svg}.png"
done
```

## Licence

The banners and the tile art are made from Heronite's icons, so they carry the icons' licence,
GPL-3.0-only. The licence text is at [../heronite-marks/LICENSE](../heronite-marks/LICENSE), and
the icons' provenance is in [../heronite-marks/README.md](../heronite-marks/README.md).
