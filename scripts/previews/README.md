# Local previews

Serve the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open a preview:

- Manager: `/tests/fixtures/browser/options-harness.html?campaign=1`
- Popup: `/tests/fixtures/browser/popup-harness.html?campaign=1`
- Artwork: `/scripts/previews/store-screenshot.html?view=manager`

Artwork views: `popup`, `manager`, `scope`, `access`, `profiles`, `promo`, `marquee`, `social`.

Use harnesses for UI review and artwork. Expect Chrome API stubs and fictional data. Verify real permissions and worker behavior in the unpacked extension.

Keep harnesses/data in `tests/fixtures/browser/`. Keep artwork composition here. Exclude both from upload archives.
