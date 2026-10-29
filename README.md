# ReqKit

Modify request headers on exact HTTPS hosts. Group rules into profiles. Scope requests. Set automatic expiry.

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/reqkit/lobcjikkmbbfkjifaknfnandpapbbfkj) · [Website and guides](https://ranjanjharavi.github.io/ReqKit/)

## Features

### Request headers

- Create, edit, pause, resume, or delete exact-host rules.
- Match all paths and request types by default. Narrow to a path prefix or fetch/XHR calls.
- Detect overlapping active rules with conflicting header values.
- Mask sensitive-looking values in popup and manager lists/forms. Reveal as needed.
- Reuse existing site access, including broader grants. Request missing access through Chrome.
- Remove the final rule for a host to release its host-specific grant. Broader grants may remain.
- Open **Site access** to review or revoke grants without deleting rules.

Use authorized systems only.

### Profiles

- Create, rename, duplicate, or delete profiles in the rule manager.
- Apply one profile at a time. Keep other profiles and their On/Paused states saved.
- Move rules between profiles through the edit form.
- Duplicate profiles with all copied rules paused.
- Delete a profile to delete its rules.
- Switch profiles to request missing site access in one prompt. Declined rules stay saved. Use **Grant** to allow them later.

### Export / import

Open **Export / import** in the rule manager.

- Select **Download JSON backup** to export saved profiles, rules, full values, scopes, and On/Paused states. Exclude unsaved drafts.
- Choose a ReqKit JSON file. Review the counts. Select **Import profiles**. Limit backups to **5 MiB**.
- Add copies with fresh IDs and unique names. Existing data stays unchanged. Repeated imports add more copies.
- Start every imported rule paused. Review a copied profile before enabling rules or granting site access.
- Exclude activation, timers, site access grants, and privacy consent.
- Retry failed imports with the validated file still selected. Reselect invalid or unreadable files. Follow reload guidance before another import.

Format: `format: "reqkit"`, `version: 1`, `exportedAt`, `profiles`, `rules`. Reject invalid files before saving import changes.

**Backups contain unencrypted values, including masked secrets.** Store and share carefully. Delete backups separately. Clearing extension data or uninstalling ReqKit does not remove downloaded files.

### Auto-off timer

- Choose **1 hour**, **8 hours**, **Chrome closes**, or manual shutoff.
- Expire the activation without deleting rules or changing their On/Paused states.
- Switch profiles to clear the timer. Choose a duration to arm a fresh timer.
- Enforce timed expiry through Chrome alarms, even with ReqKit pages closed.

Timed activations survive restarts. Browser-close activations use session rules, cleared on shutdown. If a timer expires while Chrome is closed, restored tabs may briefly receive headers before startup handling runs.

### Pausing everything

Pause all rules with the master switch. Keep individual On/Paused states unchanged. Resume the previous setup.

Badge meanings:

- `off`: rules held back by pause or expiry.
- Number: enabled rules configured for the readable destination host.
- `on`: active rules exist, but the tab URL is unavailable.
- Blank: nothing applicable.

Counts describe configured scope, not observed requests or cross-origin fetch/XHR traffic.

### Popup and rule manager

- Use the popup for current-host rules, active profile, and timing.
- Select **Change** to open the active setup in the manager.
- Open the manager from the popup or **Extension options** at `chrome://extensions`.
- Manage all profiles, rules, timers, and site access there. Chrome controls new access approvals.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+R` | Open the popup. |
| `Alt+Shift+X` | Pause or resume all rules. |

Edit shortcuts at `chrome://extensions/shortcuts`.

## Install locally

Require Chrome 120 or later.

1. Clone or download the repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**, then choose `extension/`.
4. Pin ReqKit if needed.

After extension edits, click **Reload** on the ReqKit card.

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Read the active tab URL after opening ReqKit. Identify the current host. |
| `alarms` | Stop timed activations with ReqKit pages closed. |
| `storage` | Save profiles, rules, activation settings, and consent locally. |
| `declarativeNetRequestWithHostAccess` | Apply request headers on approved HTTPS hosts. No injected scripts or response-body reads. |
| Optional `https://*/*` | Request exact-host access on demand. No all-site access by default. Review or revoke through **Site access**. |

## Privacy and security

Keep production credentials out of test rules. Local storage and backups remain unencrypted. Masking hides values visually only.

Read the [privacy policy](privacy/policy.md).

## Development

Use browser-native JavaScript modules. No runtime dependencies.

```text
extension/
  background.js       Worker entry point
  background/         Commits, migrations, badges
  options/            Rule manager
  popup/              Current-host controls
  shared/domain/      Pure data logic
  shared/runtime/     Chrome adapters and workflows
  shared/ui/          Shared controls and rendering
  shared/styles/      Tokens and components
tests/                Automated checks
docs/                 Published website and guides
privacy/              Canonical privacy policy
scripts/              Generation, packaging, previews
store-assets/         Release artwork
```

Keep domain logic pure. Bridge Chrome through runtime adapters. Commit applied state through the worker. Preserve stylesheet import order, with responsive overrides last.

- Run checks: `npm test`.
- Regenerate privacy pages: `npm run build:privacy`.
- Build and verify the upload ZIP: `npm run package`.

Output: `reqkit-v<version>.zip`, with `manifest.json` at the root. Include runtime files only.

See [preview instructions](scripts/previews/README.md) and [artwork ownership](store-assets/README.md).

## Support

[Report an issue](https://github.com/ranjanjharavi/ReqKit/issues).

## License

[MIT](LICENSE).
