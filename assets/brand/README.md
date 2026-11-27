# Brand art

The images that introduce the plugin outside its own UI.

| File              | Size       | Where it goes                                                                                                        |
| ----------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `social-card.png` | 1280 × 640 | the repository's social preview: **Settings**, then **Social preview**, then upload. GitHub has no API for this one. |
| `banner.png`      | 1200 × 320 | the strip at the top of the README                                                                                   |
| `banner.svg`      | 1200 × 320 | the source of the strip, for editing                                                                                 |
| `social-card.svg` | 1280 × 640 | the source of the card, for editing                                                                                  |

Use the `.png` file where the image must show its words. Some viewers draw an SVG through a
sanitiser that removes `<text>`, which leaves the mark alone on the plate. The `.svg` files are the
sources.

## How they are made

The colours are the custom properties of heronite.app: `--text` `#eef2f6` for the mark and the name,
`--muted` `#a7b2be` for the tagline, and a plate that runs from `--surface-2` `#141921` to `--bg`
`#0a0d11`.

Both are SVG. Each draws Heronite's `H` from
[../heronite-marks/heronite.svg](../heronite-marks/heronite.svg) with a `translate`/`scale` pair and
sets the type in whatever sans the renderer has. To remake a raster:

```sh
rsvg-convert -w 1280 -h 640 assets/brand/social-card.svg -o assets/brand/social-card.png
```

The mark's own provenance, and what still has to happen before a launcher tile can draw it, are in
[../heronite-marks/README.md](../heronite-marks/README.md). These files add a plate, a wordmark and a
tagline; they claim nothing about the mark itself.
