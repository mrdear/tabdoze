# TabDoze Store Listing

## Title

```text
TabDoze - Let Idle Tabs Sleep
```

## Short Description

```text
Put inactive tabs to sleep with Chromium's native discard. Keep active and selected sites awake. No tracking.
```

## Full Description

```text
LET IDLE TABS SLEEP

TabDoze uses Chromium's native tab discard feature to unload eligible background tabs. The original tab stays in place with its URL, title, favicon, order, and history. Select it again and Chromium reloads the page.

CONTROL THE SCHEDULE

Choose an inactivity delay from 1 to 120 minutes. TabDoze tracks when a tab leaves the active state and schedules the next eligible deadline with the browser alarms API.

STAY IN CONTROL

- Sleep other tabs while keeping the current tab active
- Wake every sleeping tab on demand
- Keep important domains awake
- Use context-menu actions and keyboard shortcuts
- See sleep history and an explicitly labeled memory-relief estimate

CAREFUL EXCLUSIONS

TabDoze does not automatically discard:

- The currently active tab
- A domain on your keep-awake list
- Browser and extension pages that Chromium does not allow extensions to discard
- Tabs Chromium has already discarded

LOCAL BY DEFAULT

No account, analytics, telemetry, advertising, or background network requests. Settings and estimated usage statistics stay in browser storage on your device.

PERMISSIONS

Tabs: identify eligible tabs, discard them, and wake them.
Storage: keep your schedule, domain list, and estimated statistics locally.
Alarms: wake the Manifest V3 service worker at the next inactivity deadline.
Scripting: add a sleep marker to a page title before discard.
Context menus: expose sleep, wake, and keep-awake actions.

TRANSPARENT ESTIMATES

The statistics page uses a fixed 50 MB estimate per successful discard. It does not claim to measure actual process memory. Actual results depend on each page and Chromium's process model.

Source and project information:
github.com/mrdear/tabdoze
```

## Category

Productivity

## Search Terms

- tab sleep
- tab discard
- inactive tabs
- browser memory
- chromium tab manager

## Screenshot Plan

1. Popup: "Sleep other tabs, keep the current tab awake"
2. Sleeping tabs: "Native discard keeps every tab in place"
3. Settings: "Choose a 1-120 minute sleep schedule"
4. Keep Awake: "Protect the sites that must stay active"
5. Statistics: "Transparent, clearly labeled estimates"

## Required Store Assets

- Extension icon: `icons/icon128.png`
- Small promo tile: 440 x 280
- Marquee promo tile: 1400 x 560
- At least one 1280 x 800 or 640 x 400 screenshot

Promo tiles and screenshots are intentionally not generated from mock data. Capture them from a verified release build before store submission.
