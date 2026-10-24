# TabDoze

<img src="icons/icon128.png" alt="TabDoze icon" width="96">

Let idle tabs sleep. Keep your place.

TabDoze is a Manifest V3 extension for Chromium browsers. It uses Chromium's native tab discard API to unload eligible background tabs while preserving their URL, title, favicon, order, and browser history.

## Features

- Sleep inactive tabs after a configurable 1-120 minute delay
- Keep the active tab and selected domains awake
- Sleep other tabs or wake all sleeping tabs on demand
- Add a `💤` title marker before a tab is discarded
- Keep settings and estimated usage statistics on the local device
- Run without analytics, accounts, telemetry, or background network requests

TabDoze reports **estimated memory relief**, calculated at 50 MB per successful discard. This is a consistent indicator, not a measurement of Chrome's process memory. Use Chrome's task manager to inspect actual memory behavior.

## Install

Download the latest `tabdoze-*-extension.zip` from [GitHub Releases](https://github.com/mrdear/tabdoze/releases/latest), then:

1. Extract the archive to a stable folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.

## Update Without Losing Settings

Keep using the same unpacked extension folder. Replace its files with the new release and click **Reload** on `chrome://extensions`.

The checked-in `manifest.key` keeps the extension ID stable:

```text
dhipcaijoipciglemoefjdlidjmjpnki
```

Do not remove or replace that key. TabDoze also keeps the historical `tabSuspenderSettings` storage key so existing installations retain their configuration.

## Development

Requirements: Node.js 20 or newer, plus `zip` for release packaging.

```bash
npm test
npm run check
npm run package
```

`npm run package` creates a release archive in `dist/` with `manifest.json` at the archive root.

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Identify eligible tabs, discard them, and wake them |
| `storage` | Store settings and estimated usage statistics locally |
| `alarms` | Wake the Manifest V3 service worker at the next inactivity deadline |
| `scripting` | Add the sleep marker to a page title before discard |
| `contextMenus` | Provide sleep, wake, and keep-awake actions |

See [PRIVACY.md](PRIVACY.md) for the data policy and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation details.

## Support

Bug reports and feature requests belong in [GitHub Issues](https://github.com/mrdear/tabdoze/issues).
