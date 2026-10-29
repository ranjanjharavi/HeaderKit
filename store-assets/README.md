# Store artwork

| Directory | Contents |
|---|---|
| `screenshots/` | Five 1280×800 screenshots |
| `icons/` | 128px store icon and 1024px artwork |
| `promotional/` | 440×280 promo, 1400×560 marquee, 1200×630 social image |

Build HeaderKit artwork from [preview sources](../scripts/previews/README.md). Use `headerkit-` filenames. Exclude store assets from the extension ZIP.

## Asset ownership

- Keep runtime icons in `extension/icons/`.
- Keep store exports in `store-assets/`.
- Keep website images in `docs/assets/` at stable URLs.

After regenerating artwork:

1. Copy final screenshots to `docs/assets/`. Remove the `-1280x800` filename suffix.
2. Copy the social image with its existing filename.
3. Sync the 128px icon across runtime, store, and website directories. Keep other icon sizes for their existing purposes.
4. Review store and website copies together.

Keep website copies as files, not links into `store-assets/`. GitHub Pages publishes `docs/`. Package the extension from `extension/`.
