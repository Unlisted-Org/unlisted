# Unlisted brand assets

The logo is the U mark with the UNLISTED wordmark. The originals are the stacked files below; every other file is cut from them with the geometry unchanged.

| File | Use |
|---|---|
| `svg/unlisted-logo-stacked-{black,white}.svg`, `png/unlisted-logo-stacked-{black,white}-2000.png` | The logo as delivered: mark above wordmark. |
| `svg/unlisted-lockup-{black,white}.svg` | Mark and wordmark side by side, for headers and banners. |
| `svg/unlisted-mark-{black,white}.svg` | The U mark alone, for small places. |
| `svg/unlisted-wordmark-{black,white}.svg` | The wordmark alone. |
| `svg/unlisted-app-icon.svg`, `png/unlisted-app-icon-512.png` | The mark on a white rounded square: favicon and app icon. |
| `png/unlisted-banner-{light,dark}.png` | The README banner (1280×400 at 2×). |

- Use black on light grounds and white on dark ones.
- In the web app, the logo is inline SVG in `currentColor` (`web/components/logo.tsx`, paths in `web/components/brand-paths.ts`), so it follows the theme.
- `web/app/icon.svg`, `favicon.ico`, `apple-icon.png` and `opengraph-image.png` come from these files.
