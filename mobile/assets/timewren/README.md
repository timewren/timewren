# TimeWren assets

The artwork is the TimeWren web mark (a wren seen from the side, the tail is the
clock hand). Mads decided on 2026-11-20 that the app uses this mark, not the
temporary TW monograms.

## Source

`source/mark.svg` is a copy of `public/brand/timewren/mark.svg` in the web repo
`mahope/timetrack` (main, commit `6927f7b33c`). It is the SVG master; there is no
need to fall back to a PNG. The brand rules (flat mark, no rotation, five colours)
are in that repo's `public/brand/timewren/README.md`.

Colours, also in `config/brands.ts`:

| Name    | Hex       | Used for                                           |
| ------- | --------- | -------------------------------------------------- |
| Wren    | `#8A5A2B` | The mark, notification colour (`primaryColor`)     |
| Lichen  | `#E8EDE3` | App icon, adaptive icon and light splash background |
| Thicket | `#3F5A3A` | Dark splash background (`darkColor`)               |

## Regenerate

```sh
pnpm exec node scripts/generate-timewren-assets.mjs            # the PNGs below
pnpm exec node scripts/generate-timewren-assets.mjs --previews # plus docs/screenshots/timewren/
pnpm check:assets
```

To swap in a new master, replace `source/mark.svg` (it must still use `#8A5A2B`
for the mark) and run the script. Do not edit the PNGs by hand.

| File                          | Size      | Notes                                                   |
| ----------------------------- | --------- | ------------------------------------------------------- |
| `icon.png`                    | 1024×1024 | Opaque Lichen square, for iOS                           |
| `adaptive-icon.png`           | 1024×1024 | Transparent foreground inside the 66 % safe zone        |
| `adaptive-icon-monochrome.png`| 1024×1024 | White silhouette for Android themed icons               |
| `notification-icon.png`       | 96×96     | White on transparent                                    |
| `splash-icon.png`             | 512×512   | Wren mark, transparent (Lichen comes from app.config.ts)|
| `splash-icon-dark.png`        | 512×512   | Lichen mark, transparent (Thicket from app.config.ts)   |
| `favicon.png`                 | 64×64     | Wren mark on transparent                                |

No TimeTrack assets are overwritten.
