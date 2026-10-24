# TabDoze Architecture

## Runtime

TabDoze is a Manifest V3 Chromium extension. `background.js` is the service worker and owns settings, inactivity state, discard decisions, context menus, keyboard commands, and statistics.

The user interfaces are static extension pages:

- `popup.*`: current tabs and immediate sleep/wake actions
- `settings.*`: schedule, keep-awake domains, import/export, and statistics entry point
- `stats-dashboard.*`: local estimated usage statistics
- `onboarding.*`: first-install setup

## Native Sleep Model

Sleeping a tab means calling `chrome.tabs.discard(tabId)`. TabDoze does not navigate the tab to a placeholder page. Chromium owns the unload and reload lifecycle, so the original tab remains in the tab strip and wakes when selected.

Before discard, `chrome.scripting.executeScript` prefixes the document title with `💤 `. A short mutation observer and interval guard prevent SPA title updates from winning the race before Chromium snapshots the tab metadata. Restricted pages still cannot be scripted, so the marker remains best-effort. The favicon is never replaced.

## Scheduler

The scheduler records one absolute timestamp per eligible inactive tab in `chrome.storage.session.tabInactiveSince`.

1. When a tab becomes inactive, reconciliation records `Date.now()` once.
2. Page loads and service-worker restarts preserve that timestamp.
3. One alarm, `tabdoze-next-deadline`, targets the earliest timestamp plus the configured timeout.
4. When the alarm fires, a sweep rechecks every candidate before discard.
5. Active, discarded, internal, and keep-awake tabs are removed from scheduler state.

The `tabs.onActivated` payload is authoritative for the affected window, and the complete tab snapshot from `tabs.onUpdated` is authoritative for wake events. This avoids assigning inactivity to the wrong tab if a full `tabs.query` snapshot briefly trails a wake or tab switch. A discard is successful only after Chromium reports `discarded: true`; a no-effect result keeps the original timestamp and retries later.

All scheduler mutations run through one promise queue. This prevents concurrent tab events from racing storage writes. Browser alarms are not real-time timers; late wakeups are expected when Chromium throttles or suspends extension work, but a late sweep uses the original absolute deadline rather than restarting the wait.

## Eligibility

Automatic and manual bulk sleep exclude:

- active tabs
- already discarded tabs
- browser and extension pages
- domains in `whitelistedDomains`

The keep-awake list uses hostname suffix matching, so `example.com` also covers its subdomains.

## Storage

`chrome.storage.sync`:

- `tabSuspenderSettings`: timeout and keep-awake domains. The historical key is retained for upgrade compatibility.

`chrome.storage.session`:

- `tabInactiveSince`: inactivity timestamps scoped to the current browser session.

`chrome.storage.local`:

- `memoryStats`: successful-discard history and a fixed 50 MB estimate per event
- `installDate`: first-install timestamp
- `schedulerStateVersion`: timer-state migration version
- `onboardingCompleted`: first-run state

## Message Contract

The UI and service worker communicate with these existing message names:

- `SUSPEND_TAB`, `SUSPEND_ALL`: sleep one or multiple eligible tabs
- `RESTORE_TAB`, `RESTORE_ALL`: wake one or all discarded tabs
- `GET_TAB_LIST`, `GET_STATS`, `GET_SETTINGS`: read current state
- `SAVE_SETTINGS`: persist normalized settings
- `WHITELIST_DOMAIN`, `REMOVE_WHITELIST`: update the keep-awake list

The internal `SUSPEND` and `RESTORE` terminology remains stable to avoid unnecessary migration risk; user-facing UI uses Sleep and Wake.

## Identity Compatibility

The `manifest.key` is intentionally committed and must remain unchanged. It produces extension ID `dhipcaijoipciglemoefjdlidjmjpnki`, allowing unpacked release updates to retain browser storage and configuration.
