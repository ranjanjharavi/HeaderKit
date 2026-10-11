# ReqKit Privacy Policy

Last updated: October 10, 2026

ReqKit is a Chrome extension for creating, organizing, and temporarily applying user-created request-header rules to exact HTTPS hosts. It is built for API and web-environment testing. ReqKit has no analytics, advertising, telemetry, remote code, developer-operated API, or account system.

## Data ReqKit handles

- **Active tab URL:** when you open the popup, ReqKit reads the active tab URL locally to identify the current host.
- **Toolbar badge URLs:** the background worker reads available URLs of open tabs when pages navigate, tabs are selected, or rules, activation settings, or site access change. Chrome makes tab URLs available for sites covered by your site access grants and for tabs temporarily accessible through `activeTab`. ReqKit compares these URLs locally with rule hosts to update toolbar badges. URLs are not stored or sent to the developer. ReqKit does not read page content or retain browsing history.
- **Profiles and activation settings:** profile names, the selected profile, pause state, and optional activation timing are stored in `chrome.storage.local` in your Chrome profile.
- **Header rules:** exact HTTPS hosts, header names, header values, optional path prefixes and request-type scopes, profile assignments, and enabled states are stored in `chrome.storage.local` in your Chrome profile.
- **Privacy choice:** acceptance of the privacy disclosure and its version are stored locally. A revised disclosure may require acceptance again before you can use the popup or rule manager controls. This does not pause existing rules or revoke site access.

## How data is used and transmitted

ReqKit sends no data to its developer. While an enabled header rule is active, Chrome sends its configured value only to that rule's exact HTTPS host, and only when a site access grant covers the host. The value is added only to requests matching the rule's optional path and request-type scope. With no scope selected, the rule matches all request types on that host. Destination services process request headers under their own policies, and those values may appear in destination or intermediary logs.

The toolbar badge reflects header-rule and activation state. The default keyboard shortcut `Alt+Shift+X` pauses or resumes all rules without opening the popup; it does not delete saved rules or site access grants.

## Retention and deletion

Profiles, activation settings, header rules, and the privacy choice remain in this Chrome profile until you change or delete them, clear extension data, or uninstall ReqKit. Deleting a profile also deletes the header rules assigned to it.

ReqKit attempts to remove unused host-specific site access grants when you delete the last rule for a host, edit its last rule to use another host, or delete a profile whose rules were the last ones for that host. Removing a host-specific grant does not remove broader grants that may still cover that host. You can review and revoke remaining grants from the rule manager; revoking a grant keeps affected rules saved but stops them from applying unless another grant still covers the host.

## Permissions

Chrome uses technical permission names. In ReqKit, **site access** means permission for rules to run on HTTPS hosts you choose. ReqKit requests it on saving and resuming a rule, grant it access, or select a profile that needs access.

- `activeTab` gives ReqKit temporary access to the active tab URL when you invoke the extension. The popup uses it to identify the current hostname and show matching rules. The background worker also uses available tab URLs for toolbar badges as described above. ReqKit does not read page content or retain browsing history.
- `alarms` runs the user-selected automatic expiry so active request-header rules stop applying even when no ReqKit page is open.
- `storage` retains privacy consent, profiles, activation settings, and request-header rules locally in the current Chrome profile.
- `declarativeNetRequestWithHostAccess` applies user-created request-header rules to HTTPS hosts where you grant ReqKit site access, without injecting scripts or reading response bodies.
- Chrome's optional `https://*/*` host permission lets ReqKit request site access for the exact HTTPS hosts in your rules when you save or resume a rule, grant it access, or select a profile that needs access. Granted site access also makes matching tab URLs available to the background worker for toolbar badges. It enables on-demand prompts; it does not give ReqKit access to every website by default. The **Site access** overview shows active site access grants and lets you revoke them.

## Security and responsible use

ReqKit limits rules to exact HTTPS hosts, supports optional path and fetch/XHR request scoping, and detects conflicting active rules whose scopes overlap. Values of headers whose names look sensitive, such as Authorization, Cookie, tokens, and API keys, are hidden in rule lists in both the popup and rule manager until you reveal them. Header values are visible while you edit a rule. Masking is visual only; it does not encrypt stored values.

ReqKit does not encrypt header values stored in `chrome.storage.local`. Anyone with access to this Chrome profile's files may be able to read them. The same unencrypted local storage holds profiles, activation settings, and your privacy choice.

These safeguards do not authorize access to systems or data. Use ReqKit only with systems and data you are authorized to access. Avoid using long-lived production credentials as test header values.

## Data sharing and sale

ReqKit does not sell or rent user data, and it does not send data to the developer, advertisers, or data brokers. It transmits configured header values only to destinations selected by the user as described above. It does not use data for advertising, creditworthiness, or any purpose unrelated to its user-facing features.

The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

For questions or support, open an issue at [github.com/ranjanjharavi/ReqKit](https://github.com/ranjanjharavi/ReqKit/issues).
