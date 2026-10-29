# ReqKit Privacy Policy

Last updated: October 29, 2026

ReqKit modifies request headers on exact HTTPS hosts for API and web testing. No analytics, ads, telemetry, remote code, developer-operated API/server, or accounts.

## Data ReqKit handles

- **Active tab URL:** read locally when the popup opens. Match the current host.
- **Toolbar badge URLs:** compare available tab URLs with rule hosts on navigation, tab selection, and rule, activation, or site-access changes. Access depends on site grants or temporary `activeTab` access. Never store URLs or send them to the developer.
- **Profiles and activation:** store names, selected profile, pause state, and timing in `chrome.storage.local` in the current Chrome profile.
- **Header rules:** store HTTPS hosts, names, values, path/request-type scopes, profile assignments, and enabled states locally.
- **Privacy choice:** store disclosure acceptance and version locally. Revised disclosures may require acceptance again. Existing rules and grants stay unchanged.

No page-content reads or retained browsing history.

## How data is used and transmitted

Chrome sends active header values only to the rule's exact HTTPS host with site access. Match configured path/request-type scopes. Without optional scoping, match all paths and request types on that host.

Destination services follow separate policies. Destination or intermediary logs may retain header values. ReqKit sends no data to its developer.

Export/import behavior:

- Export saved profiles and rules to local JSON. Include full, unencrypted values, even when masked in the interface.
- Exclude activation, timers, site access grants, and privacy consent.
- Import locally as new profiles with paused rules. Preserve existing profiles. Request no new site access. Repeated imports add copies.
- Never send backup contents to the developer.

The badge reflects rule and activation state. Use `Alt+Shift+X` to pause or resume all rules without opening the popup. Keep saved rules and grants unchanged.

## Retention and deletion

- Retain profiles, rules, activation, and consent until changed, deleted, extension data is cleared, or ReqKit is uninstalled.
- Delete a profile to remove its rules.
- Delete downloaded backups separately. Clearing extension data or uninstalling ReqKit does not remove those files.
- Attempt to release unused host-specific grants after the final rule is deleted, moved to another host, or removed with a profile. Broader grants may remain.
- Review or revoke grants through **Site access**. Keep affected rules saved. Stop applying them unless another grant still covers the host.

## Permissions

**Site access** means permission to apply rules on selected HTTPS hosts.

- `activeTab`: read the active tab URL after invoking ReqKit. Identify the current host and support badge updates.
- `alarms`: stop timed activations with ReqKit pages closed.
- `storage`: save profiles, rules, activation settings, and consent in the current Chrome profile.
- `declarativeNetRequestWithHostAccess`: apply request headers on approved HTTPS hosts. No script injection or response-body reads.
- Optional `https://*/*`: request exact-host access on save, resume, **Grant**, or profile switch. No all-site access by default. Review or revoke grants through **Site access**.

## Security and responsible use

Use exact HTTPS hosts, optional path/fetch/XHR scopes, and conflict checks for overlapping active rules.

Mask sensitive-looking values in popup and manager lists and forms. Detection uses header names suggesting authentication, sessions, passwords, signatures, CSRF/XSRF, bearer/JWT, credentials, private data, API keys, tokens, secrets, or cookies. Other names may be missed. Reveal values as needed.

Masking is visual only. Local extension storage and backups remain unencrypted. Access to Chrome profile files may expose stored values, settings, and consent.

Use authorized systems and data only. Avoid long-lived production credentials.

## Data sharing and sale

No data sale or rental. No transfers to the developer, advertisers, or data brokers. Send configured header values only to selected destinations as described above. No advertising, creditworthiness, or unrelated uses.

Information received from Google APIs follows the Chrome Web Store User Data Policy, including Limited Use requirements.

## Contact

[Report a privacy concern or request support](https://github.com/ranjanjharavi/ReqKit/issues).
