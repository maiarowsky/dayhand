# Dayhand app icon

`dayhand-icon.svg` is the source of truth: a flat vector redrawing of variant 17
("piasta-kanciasta") from the icon variant gallery, chosen by the owner. The generated
PNG was measured and redrawn with exact symmetry, smooth edges and no generator noise.

| File | Use |
|---|---|
| `dayhand-icon.svg` | Master artwork, 1024 x 1024, full-bleed square (platforms apply their own mask). |
| `play-store-512.png` | Google Play listing icon, 512 x 512, no alpha, no rounding. |
| `ios-1024.png` | iOS App Store master, 1024 x 1024, no alpha. Not wired into `ios/` yet. |

Android uses an adaptive icon built from the same geometry
(`android/app/src/main/res/`): `mipmap-anydpi-v26/ic_launcher*.xml`, the foreground and
monochrome vector drawables in `drawable/`, and the `ic_launcher_background` color.
The mark sits inside the 66 dp safe zone of the 108 dp layers. The app's `minSdk` is 26,
so no raster launcher fallbacks are needed.

Palette: espresso `#3B2417`, caramel `#D9A66B`, cream `#F3E3C8` (walnut `#8B5A2B` is
part of the palette but not used by this icon).
