# Store artwork

| Directory | Contents |
| --- | --- |
| `screenshots/` | Five 1280×800 product screenshots |
| `icons/` | The 128px store icon and 1024px artwork |
| `promotional/` | 440×280 promo, 1400×560 marquee, and 1200×630 social artwork |

Composition sources are in [`scripts/previews/`](../scripts/previews/README.md).
These files are release artwork and are excluded from the extension ZIP.

## Asset ownership

- `extension/icons/` contains runtime icons referenced by the manifest.
- `store-assets/` contains store submission and promotional exports.
- `docs/assets/` contains the public website's images at stable URLs.

The five screenshot files and social artwork currently have identical website
copies. After regenerating a screenshot, copy its final export into
`docs/assets/`, removing the `-1280x800` suffix from its filename. Copy social
artwork with its existing filename. Review both destinations together.

The 128px icon also has intentional copies in the runtime, store, and website
directories. Keep those copies synchronized when the icon changes. Other icon
sizes serve their existing runtime or release purposes.

Avoid replacing website copies with links to this directory: GitHub Pages
publishes `docs/`, while the extension package publishes `extension/`.
