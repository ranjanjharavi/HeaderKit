# Local previews

Start the local preview server:

```sh
node scripts/previews/server.mjs
```

Open `http://127.0.0.1:4173` with a preview path:

- Manager: `/extension/options/index.html`
- Popup: `/extension/popup/index.html`
- Artwork: `/scripts/previews/store-screenshot.html?view=manager`

Artwork views: `popup`, `manager`, `scope`, `access`, `profiles`, `promo`, `marquee`, `social`.

Use read-only Chrome API stubs and fictional data from `fixture.js`. Render the real extension pages. Keep test fixtures separate. Verify permissions and worker behavior in the unpacked extension.

Set `PORT` to change the local port. Exclude preview sources and artwork from upload archives.
