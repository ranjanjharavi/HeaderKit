# ReqKit

ReqKit is a lightweight Chrome extension for modifying request headers on exact HTTPS hosts. API developers and QA testers can organize rules into profiles, scope them to API paths or fetch/XHR requests, and stop applying them automatically after a chosen time.

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/reqkit/lobcjikkmbbfkjifaknfnandpapbbfkj) · [Website and guides](https://ranjanjharavi.github.io/ReqKit/)

## Features

### Request headers

- Creates request-header rules for exact HTTPS hostnames, with optional path-prefix and API (fetch/XHR) scoping.
- Requests optional site access only when a rule is created or resumed.
- Supports turning individual rules on or pausing them, as well as editing and deleting them.
- Applies enabled rules through Chrome's `declarativeNetRequest` API. By default, a rule matches all request types for that host; optional scopes can limit it to a path and nested paths, and/or fetch/XHR requests.
- Detects conflicting active rules for the same host and header when their request scopes overlap.
- Masks sensitive-looking header values in the popup until explicitly revealed.
- Removes a site's access grant after the final rule for a hostname is deleted.
- Includes a **Site access** overview for reviewing active site access grants, seeing which saved rules each grant covers, and revoking a grant without deleting those rules.

Use header modification only with systems you are authorized to test.

### Profiles

Rules are grouped into profiles, and one profile is active at a time. Rules in the other
profiles keep their own On/Paused state and are simply not applied, so the same header can hold
a different value in each environment without the two ever colliding.

- The popup shows the selected profile and how long it will apply. The adjacent **Change**
  action opens the active setup in the rule manager.
- The rule manager creates, renames, duplicates, and deletes profiles, and its edit form moves
  a rule between them.
- Duplicating a profile copies its rules paused, so nothing goes live by accident.
- Deleting a profile also deletes every request-header rule assigned to it.
- Switching to a profile asks for any site access it still needs in one prompt. If you
  decline, the profile still switches; rules without site access stay saved and show a **Grant** button.

### Auto-off timer

Rules can be set to apply for **1 hour**, **8 hours**, **until Chrome closes**, or until you
turn them off. When the time is up ReqKit parks the active profile: every rule stops being
applied, but nothing is edited or deleted, so resuming is one click.

The timer belongs to the activation rather than to a profile. Switching profiles disarms it,
and choosing a duration arms a fresh one. The remaining time is rounded, and a Chrome alarm
stops the rules even when no ReqKit page is open.

### Pausing everything

A single switch pauses every header rule without deleting anything or changing any rule's
own On/Paused state. Resuming restores exactly what was there before. Paused rules stay
saved and editable.

While rules are paused the toolbar badge reads `off`, and both the popup and the rule
manager show a banner. The badge stays blank when there was nothing to apply anyway.

The badge otherwise counts the rules active on the site you are looking at, falling back to
the profile-wide count on pages whose URL ReqKit cannot read.

### Popup and rule manager

The popup answers one question: what ReqKit is doing to the current site. It lists that
host's rules, adds new ones, and shows the selected profile and activation lifetime.

The rule manager is a full page, opened from the popup or from **Extension options** in
`chrome://extensions`. It manages profiles, activation timing, and all request-header rules.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+R` | Open the ReqKit popup. |
| `Alt+Shift+X` | Pause or resume every header rule without opening the popup. The badge shows `off` while rules are paused. |

Both are editable at `chrome://extensions/shortcuts`.

## Install locally

ReqKit requires Chrome 120 or later.

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository's `extension` directory.
6. Pin ReqKit from Chrome's Extensions menu if desired.

Changes to extension files require clicking **Reload** on the ReqKit card in `chrome://extensions`.

## Permissions

| Chrome permission | Why ReqKit needs it |
|---|---|
| `activeTab` | Reads the active tab URL locally only after you open ReqKit, so the popup can identify the current hostname and show matching rules. It does not read page content or general browsing history. |
| `alarms` | Runs the user-selected automatic expiry so active request-header rules stop applying even when no ReqKit page is open. |
| `storage` | Stores privacy consent, profiles, activation settings, and request-header rules locally in the current Chrome profile. |
| `declarativeNetRequestWithHostAccess` | Applies user-created request-header rules to HTTPS hosts where you grant ReqKit site access, without injecting scripts or reading response bodies. |
| Optional site access (`https://*/*`) | This optional Chrome host permission lets ReqKit ask for site access to the exact HTTPS host you choose when creating or resuming a rule. It does not give ReqKit access to every website by default. Review or revoke site access grants in the rule manager's **Site access** overview. |

## Privacy and security

Read the [privacy policy](privacy/policy.md).

## Development

The project uses browser-native JavaScript modules and has no runtime package dependencies.

The repository is organized by runtime responsibility:

```text
extension/
  background.js       Service-worker entry point
  background/        Rule commits, migrations, and badge calculation
  options/           Manager features, workspace coordination, and styles
  popup/             Popup features, page state, and layout
  shared/
    domain/          Pure rules, activation, profiles, site access, and URLs
    runtime/         Chrome adapters, message clients, and permission workflows
    ui/              Shared rendering, dialogs, consent, and DOM helpers
    styles/          Shared tokens and components
tests/
  background/        Worker helper and event checks
  domain/            Pure model tests
  runtime/           Chrome adapters, module graph, and save ordering
  ui/                Popup, manager, and shared UI tests
  fixtures/browser/  Browser harnesses and sample data
  helpers/           Test source loaders and UI stubs
docs/                Published website, guides, and site assets
privacy/             Canonical privacy policy Markdown
scripts/             Privacy generation, packaging, and preview sources
store-assets/        Screenshots, icons, and promotional artwork
```

Domain modules contain reusable data logic. Runtime modules bridge that logic to
Chrome, and the service worker owns applied rules and activation commits. Page
controllers wire events; composers, views, and actions handle their respective
feature responsibilities. The manager workspace coordinates the independent
features and refreshes their shared page state.

Stylesheet entry points import focused fragments in an explicit order. Keep
that order when editing shared components or responsive overrides.

For browser harnesses and artwork capture, see the [local preview instructions](scripts/previews/README.md).
For release image ownership, see the [store artwork notes](store-assets/README.md).

Run the tests:

```bash
npm test
```

Regenerate the extension and GitHub Pages privacy-policy HTML from the canonical Markdown source:

```bash
npm run build:privacy
```

Create and integrity-check the Chrome Web Store upload archive:

```bash
npm run package
```

The packaging script creates `reqkit-v<version>.zip` with `manifest.json` at the archive root. Tests, documentation, source artwork, and store assets are excluded from the upload.

## Support

Report problems or request enhancements through [Report an issue](https://github.com/ranjanjharavi/ReqKit/issues).

## License

ReqKit is available under the [MIT License](LICENSE). 

> **Note:** This repository was originally hosted under another account belonging to the same author.
