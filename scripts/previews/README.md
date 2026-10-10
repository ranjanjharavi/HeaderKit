# Local UI and artwork previews

Serve the repository root with a static HTTP server, for example:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

- Options UI: `/tests/fixtures/browser/options-harness.html?campaign=1`
- Popup UI: `/tests/fixtures/browser/popup-harness.html?campaign=1`
- Store artwork: `/scripts/previews/store-screenshot.html?view=manager`

Artwork views: `popup`, `manager`, `scope`, `access`, `profiles`, `promo`,
`marquee`, and `social`.

The browser harnesses load the actual extension markup and modules with a local
Chrome API stub and fictional sample data. They are useful for UI review and
artwork capture; actual extension permissions and service-worker behavior still
require testing the unpacked extension in Chrome.

Browser harnesses and their sample data belong in `tests/fixtures/browser/`.
Artwork composition sources belong here. Neither directory is packaged into
the extension upload archive.
