/**
 * TabDoze - Background Service Worker
 */

console.log('[BG] TabDoze: Background starting...');

// ============================================================================
// SERVICE WORKER CONTEXT VALIDATION
// ============================================================================

/**
 * Check if the extension context is still valid.
 * In Manifest V3, service workers can be terminated at any time.
 * This helper ensures we don't try to use chrome APIs when the context is invalid.
 * @returns {boolean} True if the extension context is valid
 */
function isExtensionContextValid() {
    try {
        // chrome.runtime.id is undefined when the context is invalidated
        return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

/**
 * Safely execute a function that requires valid extension context.
 * If context is invalid, logs warning and returns default value.
 * @param {Function} fn - The async function to execute
 * @param {string} operationName - Name of the operation for logging
 * @param {*} defaultValue - Default value to return if context is invalid
 * @returns {Promise<*>} Result of fn or defaultValue
 */
async function safeExecute(fn, operationName, defaultValue = null) {
    if (!isExtensionContextValid()) {
        console.warn(`[BG][SW] Extension context invalid, skipping: ${operationName}`);
        return defaultValue;
    }
    try {
        return await fn();
    } catch (error) {
        // Check if error is due to context invalidation
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW') ||
            error.message.includes('context invalidated'))) {
            console.warn(`[BG][SW] Context invalidated during: ${operationName}`);
            return defaultValue;
        }
        throw error;
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
    suspensionTimeout: 30,
    suspendActiveTab: false,
    whitelistedDomains: []
};

const DISCARDED_TITLE_PREFIX = '💤 ';
const TITLE_GUARD_STATE_KEY = '__tabDozeTitleGuard';
const MARK_TITLE_HOLD_MS = 150;
const MARK_TITLE_GUARD_MS = 1200;
const MARK_TITLE_TIMEOUT_MS = 500;
const SUSPEND_ALARM_NAME = 'tabdoze-next-deadline';
const PREVIOUS_SUSPEND_ALARM_NAME = 'suspend-next-deadline';
const LEGACY_ALARM_PREFIX = 'suspend-tab-';
const INACTIVE_SINCE_KEY = 'tabInactiveSince';
const SCHEDULER_STATE_VERSION_KEY = 'schedulerStateVersion';
const SCHEDULER_STATE_VERSION = 2;
const MIN_ALARM_DELAY_MS = 30 * 1000;

let config = { ...DEFAULT_CONFIG };
let settingsReadyPromise = null;
let schedulerQueue = Promise.resolve();

// ============================================================================
// STATE
// ============================================================================

// Inactivity timestamps live in storage.session so they survive service worker restarts
// without leaking across browser sessions. A single alarm targets the earliest deadline.

// ============================================================================
// INITIALIZATION
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[BG] TabDoze installed:', details.reason);

    // Verify extension context is valid
    if (!isExtensionContextValid()) {
        console.warn('[BG][INSTALL] Extension context invalid');
        return;
    }

    try {
        // Clean up stale state from previous installs/updates
        if (details.reason === 'update' || details.reason === 'install') {
            console.log('[BG][INSTALL] Cleaning up stale state...');
            await migrateLegacyTimerState();
        }

        await ensureSettingsLoaded();
        createContextMenus();

        if (details.reason === 'install') {
            if (isExtensionContextValid()) {
                chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
                await chrome.storage.local.set({
                    memoryStats: { totalSaved: 0, tabsSuspended: 0, history: [] },
                    installDate: Date.now()
                });
            }
        }
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][INSTALL] Context invalidated during installation');
            return;
        }
        console.error('[BG][INSTALL] Error during installation:', error);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('[BG] TabDoze starting up');

    // Verify extension context is valid before proceeding
    if (!isExtensionContextValid()) {
        console.warn('[BG][STARTUP] Extension context invalid at startup');
        return;
    }

    try {
        await ensureSettingsLoaded();
        await migrateLegacyTimerState();
        await updateBadge();
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][STARTUP] Context invalidated during startup sequence');
            return;
        }
        console.error('[BG][STARTUP] Error during startup:', error);
    }
});

async function migrateLegacyTimerState() {
    try {
        const result = await chrome.storage.local.get(SCHEDULER_STATE_VERSION_KEY);
        if (result[SCHEDULER_STATE_VERSION_KEY] === SCHEDULER_STATE_VERSION) return;

        const alarms = await chrome.alarms.getAll();
        await Promise.all(
            alarms
                .filter(alarm =>
                    alarm.name.startsWith(LEGACY_ALARM_PREFIX) ||
                    alarm.name === PREVIOUS_SUSPEND_ALARM_NAME
                )
                .map(alarm => chrome.alarms.clear(alarm.name))
        );

        await chrome.storage.session.remove(['tabLastActivity', 'tabFormStatus']).catch(() => {});
        await chrome.storage.local.remove(['tabLastActivity', 'tabFormStatus']);
        await ensureSettingsLoaded();
        await saveSettings();
        await chrome.storage.local.set({
            [SCHEDULER_STATE_VERSION_KEY]: SCHEDULER_STATE_VERSION
        });
    } catch (error) {
        console.error('[BG][MIGRATION] Failed to clean up legacy timer state:', error);
    }
}

// ============================================================================
// CONNECTION ERROR HANDLING
// ============================================================================

/**
 * Handle connection errors from chrome.runtime connections.
 * This catches errors like "Extension context invalidated" when the service worker
 * is terminated while a connection is still open.
 */
chrome.runtime.onConnect.addListener((port) => {
    console.log('[BG] Port connected:', port.name);

    port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
            console.warn('[BG] Port disconnected with error:', error.message);
        } else {
            console.log('[BG] Port disconnected cleanly:', port.name);
        }
    });

    port.onMessage.addListener((message) => {
        try {
            console.log('[BG] Port message received:', message);
            // Handle port messages if needed
        } catch (error) {
            console.error('[BG] Error handling port message:', error);
        }
    });
});

// ============================================================================
// SETTINGS
// ============================================================================

function normalizeSettings(settings = {}) {
    const timeout = Number(settings.suspensionTimeout);
    const suspensionTimeout = Number.isFinite(timeout) && timeout >= 1 && timeout <= 120
        ? timeout
        : DEFAULT_CONFIG.suspensionTimeout;
    const whitelistedDomains = Array.isArray(settings.whitelistedDomains)
        ? settings.whitelistedDomains
            .filter(domain => typeof domain === 'string')
            .map(domain => domain.trim().toLowerCase())
            .filter(Boolean)
        : [];

    return {
        suspensionTimeout,
        suspendActiveTab: settings.suspendActiveTab === true,
        whitelistedDomains
    };
}

async function loadSettings() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][SETTINGS] Extension context invalid, using default config');
        return;
    }
    try {
        const result = await chrome.storage.sync.get('tabSuspenderSettings');
        if (result.tabSuspenderSettings) {
            config = normalizeSettings(result.tabSuspenderSettings);
        }
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][SETTINGS] Context invalidated during load, using defaults');
            return;
        }
        console.error('[BG] Failed to load settings:', error);
    }
}

function ensureSettingsLoaded() {
    if (!settingsReadyPromise) {
        settingsReadyPromise = loadSettings();
    }
    return settingsReadyPromise;
}

async function saveSettings() {
    try {
        await chrome.storage.sync.set({ tabSuspenderSettings: config });
    } catch (error) {
        console.error('[BG] Failed to save settings:', error);
    }
}

// ============================================================================
// CONTEXT MENUS
// ============================================================================

function createContextMenus() {
    try {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: 'suspendOthers',
                title: 'Sleep other tabs',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: 'whitelistSite',
                title: 'Keep this site awake',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: 'restoreAll',
                title: 'Wake all sleeping tabs',
                contexts: ['page']
            });
        });
    } catch (error) {
        console.error('[BG] Failed to create context menus:', error);
    }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        switch (info.menuItemId) {
            case 'suspendOthers':
                await suspendAllExcept(tab.id);
                break;
            case 'whitelistSite':
                await whitelistCurrentSite(tab);
                break;
            case 'restoreAll':
                await restoreAllTabs();
                break;
        }
    } catch (error) {
        console.error('[BG] Context menu action failed:', error);
    }
});

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

chrome.commands.onCommand.addListener(async (command) => {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        switch (command) {
            case 'suspend_others':
                if (activeTab) await suspendAllExcept(activeTab.id);
                break;
            case 'restore_all':
                await restoreAllTabs();
                break;
            case 'whitelist_site':
                if (activeTab) await whitelistCurrentSite(activeTab);
                break;
        }
    } catch (error) {
        console.error('[BG] Command failed:', error);
    }
});

// ============================================================================
// TAB MONITORING
// ============================================================================

function enqueueSchedulerTask(task, operationName) {
    schedulerQueue = schedulerQueue
        .then(async () => {
            if (!isExtensionContextValid()) return;
            await ensureSettingsLoaded();
            return task();
        })
        .catch(error => {
            console.error(`[BG][SCHEDULER] ${operationName} failed:`, error);
        });

    return schedulerQueue;
}

async function getInactiveSinceMap() {
    const result = await chrome.storage.session.get(INACTIVE_SINCE_KEY);
    const stored = result[INACTIVE_SINCE_KEY] || {};
    const normalized = {};

    for (const [tabId, timestamp] of Object.entries(stored)) {
        if (/^\d+$/.test(tabId) && Number.isFinite(timestamp) && timestamp > 0) {
            normalized[tabId] = timestamp;
        }
    }

    return normalized;
}

async function saveInactiveSinceMap(inactiveSince) {
    await chrome.storage.session.set({ [INACTIVE_SINCE_KEY]: inactiveSince });
}

function getSuspensionTimeoutMs() {
    const timeoutMinutes = Number(config.suspensionTimeout);
    const safeMinutes = Number.isFinite(timeoutMinutes) && timeoutMinutes >= 1
        ? timeoutMinutes
        : DEFAULT_CONFIG.suspensionTimeout;
    return safeMinutes * 60 * 1000;
}

function isAutoSuspendCandidate(tab) {
    return Boolean(
        tab?.id !== undefined &&
        !tab.active &&
        !isSuspendedTab(tab) &&
        !isInternalPage(tab.url) &&
        !isWhitelisted(tab.url)
    );
}

function reconcileInactiveSince(tabs, inactiveSince, now) {
    let changed = false;
    const existingTabIds = new Set(tabs.filter(tab => tab.id !== undefined).map(tab => String(tab.id)));

    for (const tabId of Object.keys(inactiveSince)) {
        if (!existingTabIds.has(tabId)) {
            delete inactiveSince[tabId];
            changed = true;
        }
    }

    for (const tab of tabs) {
        if (tab.id === undefined) continue;
        const tabId = String(tab.id);

        if (isAutoSuspendCandidate(tab)) {
            if (!Number.isFinite(inactiveSince[tabId])) {
                inactiveSince[tabId] = now;
                changed = true;
            }
        } else if (inactiveSince[tabId] !== undefined) {
            delete inactiveSince[tabId];
            changed = true;
        }
    }

    return changed;
}

function applyActivationState(tabs, activeInfo) {
    if (!activeInfo || !Number.isInteger(activeInfo.tabId)) return tabs;

    return tabs.map(tab => {
        if (tab.id === activeInfo.tabId) {
            return { ...tab, active: true };
        }

        if (tab.windowId === activeInfo.windowId) {
            return { ...tab, active: false };
        }

        return tab;
    });
}

function applyTabSnapshot(tabs, tabSnapshot) {
    if (!tabSnapshot || !Number.isInteger(tabSnapshot.id)) return tabs;

    return tabs.map(tab => (
        tab.id === tabSnapshot.id
            ? { ...tab, ...tabSnapshot }
            : tab
    ));
}

async function scheduleNextSuspensionAlarm(inactiveSince) {
    const timeoutMs = getSuspensionTimeoutMs();
    const timestamps = Object.values(inactiveSince).filter(Number.isFinite);

    if (timestamps.length === 0) {
        await chrome.alarms.clear(SUSPEND_ALARM_NAME);
        return;
    }

    const earliestDeadline = Math.min(...timestamps) + timeoutMs;
    const now = Date.now();
    const scheduledTime = earliestDeadline > now
        ? earliestDeadline
        : now + MIN_ALARM_DELAY_MS;
    const existingAlarm = await chrome.alarms.get(SUSPEND_ALARM_NAME);

    if (existingAlarm && Math.abs(existingAlarm.scheduledTime - scheduledTime) < 1000) return;

    await chrome.alarms.create(SUSPEND_ALARM_NAME, { when: scheduledTime });
}

async function reconcileSchedulerState(tabSnapshot = null) {
    const queriedTabs = await chrome.tabs.query({});
    const tabs = applyTabSnapshot(queriedTabs, tabSnapshot);
    const inactiveSince = await getInactiveSinceMap();
    const changed = reconcileInactiveSince(tabs, inactiveSince, Date.now());

    if (changed) await saveInactiveSinceMap(inactiveSince);
    await scheduleNextSuspensionAlarm(inactiveSince);
}

async function runSuspensionSweep(activeInfo = null) {
    const queriedTabs = await chrome.tabs.query({});
    const tabs = applyActivationState(queriedTabs, activeInfo);
    const inactiveSince = await getInactiveSinceMap();
    const now = Date.now();
    const timeoutMs = getSuspensionTimeoutMs();
    let changed = reconcileInactiveSince(tabs, inactiveSince, now);

    for (const tab of tabs) {
        if (!isAutoSuspendCandidate(tab)) continue;

        const tabId = String(tab.id);
        if (now - inactiveSince[tabId] < timeoutMs) continue;

        const suspended = await suspendTab(tab.id);
        if (suspended) {
            delete inactiveSince[tabId];
            changed = true;
            continue;
        }

        const latestTab = await chrome.tabs.get(tab.id).catch(() => null);
        const [effectiveLatestTab] = applyActivationState(
            latestTab ? [latestTab] : [],
            activeInfo
        );
        if (!isAutoSuspendCandidate(effectiveLatestTab)) {
            delete inactiveSince[tabId];
            changed = true;
        }
    }

    if (changed) await saveInactiveSinceMap(inactiveSince);
    await scheduleNextSuspensionAlarm(inactiveSince);
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SUSPEND_ALARM_NAME) return;
    return enqueueSchedulerTask(runSuspensionSweep, 'alarm sweep');
});

// ============================================================================
// TAB EVENT LISTENERS
// ============================================================================

chrome.tabs.onActivated.addListener((activeInfo) => {
    return enqueueSchedulerTask(
        async () => {
            await startActiveTabTracking(activeInfo.tabId);
            await runSuspensionSweep(activeInfo);
        },
        'tab activation'
    );
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Note: Stats are tracked in:
    // - background.js suspendTab() for auto-suspend and message-based suspend
    // - popup.js updateMemoryStatsLocal() for direct popup suspensions
    // Do NOT add stats tracking here - it would cause double-counting

    if (changeInfo.discarded !== undefined || changeInfo.url !== undefined) {
        await updateBadge();
    }

    // Loading and background refreshes do not represent user activity. Reconcile only
    // when eligibility can change, without resetting an existing inactivity timestamp.
    if (changeInfo.url !== undefined || changeInfo.discarded !== undefined) {
        await enqueueSchedulerTask(
            () => reconcileSchedulerState(tab),
            'tab update'
        );
    }
});

chrome.tabs.onRemoved.addListener(() => {
    enqueueSchedulerTask(reconcileSchedulerState, 'tab removal');
});

chrome.tabs.onCreated.addListener(() => {
    enqueueSchedulerTask(reconcileSchedulerState, 'tab creation');
});

chrome.tabs.onReplaced.addListener(() => {
    enqueueSchedulerTask(reconcileSchedulerState, 'tab replacement');
});

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        handleMessage(message, sender)
            .then(sendResponse)
            .catch(error => {
                console.error('[BG] Message handling error:', error);
                sendResponse({ error: error.message });
            });
    } catch (error) {
        console.error('[BG] Synchronous message handler error:', error);
        sendResponse({ error: error.message || 'Unknown error' });
    }
    return true;
});

async function handleMessage(message, sender) {
    try {
        await ensureSettingsLoaded();

        switch (message.type) {
            case 'MARK_PINNED_FAVICON': {
                const tab = await chrome.tabs.get(message.tabId).catch(() => null);
                return { success: await markPinnedTabFavicon(tab) };
            }

            case 'SUSPEND_IDLE_ACTIVE_TAB':
                return await enqueueSchedulerTask(
                    () => suspendIdleActiveTab(sender),
                    'idle current tab'
                );

            case 'SUSPEND_TAB':
                if (message.tabId === undefined) {
                    console.warn('[BG] SUSPEND_TAB received without tabId');
                    return { success: false, error: 'Missing tabId' };
                }
                const didSuspend = await suspendTab(message.tabId);
                return { success: didSuspend };

            case 'RESTORE_TAB':
                if (message.tabId === undefined) {
                    console.warn('[BG] RESTORE_TAB received without tabId');
                    return { success: false, error: 'Missing tabId' };
                }
                const didRestore = await restoreTab(message.tabId);
                return { success: didRestore };

            case 'SUSPEND_ALL':
                const suspended = await suspendAllInactive();
                return { success: true, count: suspended };

            case 'RESTORE_ALL':
                const restored = await restoreAllTabs();
                return { success: true, count: restored };

            case 'GET_TAB_LIST':
                return await getTabList();

            case 'GET_STATS':
                return await getStats();

            case 'GET_SETTINGS':
                return { settings: config };

            case 'SAVE_SETTINGS':
                config = normalizeSettings({ ...config, ...message.settings });
                await saveSettings();
                await startActiveTabTracking();
                await enqueueSchedulerTask(runSuspensionSweep, 'settings update');
                return { success: true };

            case 'WHITELIST_DOMAIN':
                await addToWhitelist(message.domain);
                await enqueueSchedulerTask(reconcileSchedulerState, 'whitelist update');
                return { success: true };

            case 'REMOVE_WHITELIST':
                await removeFromWhitelist(message.domain);
                await enqueueSchedulerTask(reconcileSchedulerState, 'whitelist update');
                return { success: true };

            case 'RELOAD_CONFIG':
                // Reload settings from storage (called when popup updates whitelist)
                settingsReadyPromise = loadSettings();
                await settingsReadyPromise;
                await startActiveTabTracking();
                await enqueueSchedulerTask(runSuspensionSweep, 'config reload');
                console.log('[BG][CONFIG] Reloaded settings from storage');
                return { success: true };

            default:
                console.warn('[BG] Unknown message type:', message.type);
                return { error: 'Unknown message type' };
        }
    } catch (error) {
        console.error('[BG] Error in handleMessage:', error);
        throw error; // Re-throw to be caught by the outer handler
    }
}

// ============================================================================
// SUSPENSION LOGIC
// ============================================================================

function isActiveSleepCandidate(tab) {
    return Boolean(
        config.suspendActiveTab &&
        tab?.active &&
        /^https?:\/\//i.test(tab.url || '') &&
        !isSuspendedTab(tab) &&
        !isWhitelisted(tab.url)
    );
}

async function startActiveTabTracking(tabId = null) {
    if (!config.suspendActiveTab) return;
    const tabs = tabId === null
        ? await chrome.tabs.query({ active: true })
        : [await chrome.tabs.get(tabId).catch(() => null)];

    await Promise.all(tabs.filter(isActiveSleepCandidate).map(tab => (
        chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['active-tab.js']
        }).catch(() => {})
    )));
}

async function suspendIdleActiveTab(sender) {
    if (sender.frameId !== 0 || sender.tab?.id === undefined) return { success: false };
    const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
    if (!isActiveSleepCandidate(tab)) return { success: false };
    const favicon = await createSleepingFavicon(tab.url);

    // Read frame activity at the deadline so iframe input also keeps the page awake.
    const activity = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => globalThis.__tabDozeLastActivity || 0
    });
    const lastActivity = Math.max(0, ...activity.map(frame => Number(frame.result) || 0));
    if (!lastActivity) return { success: false };
    if (Date.now() - lastActivity < getSuspensionTimeoutMs() * 1.5) {
        return { success: false, lastActivity };
    }

    const latestTab = await chrome.tabs.get(tab.id).catch(() => null);
    if (!isActiveSleepCandidate(latestTab) || latestTab.url !== tab.url) return { success: false };
    const parameters = new URLSearchParams({ url: latestTab.url, title: latestTab.title || '' });
    if (favicon) parameters.set('favicon', favicon);
    await chrome.tabs.update(tab.id, {
        url: `${chrome.runtime.getURL('sleep.html')}#${parameters}`
    });
    await updateMemoryStats(latestTab.url);
    await updateBadge();
    return { success: true };
}

async function shouldSuspendTab(tabId) {
    try {
        await ensureSettingsLoaded();

        // Defensive handling: tab may have been closed
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log(`[BG][SUSPEND] Tab ${tabId} no longer exists`);
            return false;
        }

        if (isInternalPage(tab.url)) return false;
        if (isSuspendedTab(tab)) return false;
        if (tab.active) return false;
        if (isWhitelisted(tab.url)) return false;

        return true;
    } catch (error) {
        console.error('[BG] shouldSuspendTab error:', error);
        return false;
    }
}

async function suspendTab(tabId) {
    try {
        const canSuspend = await shouldSuspendTab(tabId);
        if (!canSuspend) return false;

        // Defensive handling: tab may have been closed between shouldSuspendTab check and now
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log(`[BG][SUSPEND] Tab ${tabId} no longer exists, cannot suspend`);
            return false;
        }

        await markPinnedTabFavicon(tab);
        await markTabTitleAsDiscarded(tabId, tab.title);

        // Native Chrome discard unloads the page from memory while keeping it in the tab strip.
        try {
            const discardedTab = await chrome.tabs.discard(tabId);
            const latestTab = discardedTab?.discarded
                ? discardedTab
                : await chrome.tabs.get(tabId).catch(() => null);

            if (!latestTab?.discarded) {
                await clearTabTitleDiscardMarker(tabId);
                console.warn(`[BG][SUSPEND] Browser did not discard tab ${tabId}; keeping it scheduled for retry`);
                return false;
            }
        } catch (discardError) {
            await clearTabTitleDiscardMarker(tabId);
            // Check if error is because tab no longer exists
            if (discardError.message?.includes('No tab with id')) {
                console.log(`[BG][SUSPEND] Tab ${tabId} was closed during suspension`);
                return false;
            }
            console.error(`[BG][SUSPEND] Failed to discard tab ${tabId}:`, discardError);
            return false; // Don't update stats if suspension failed
        }

        await updateMemoryStats(tab.url);
        await updateBadge();

        return true;
    } catch (error) {
        console.error('[BG] Failed to suspend tab:', error);
        return false;
    }
}

async function createSleepingFavicon(pageUrl) {
    try {
        const faviconUrl = new URL(chrome.runtime.getURL('_favicon/'));
        faviconUrl.searchParams.set('pageUrl', pageUrl);
        faviconUrl.searchParams.set('size', '32');
        const response = await fetch(faviconUrl);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = new OffscreenCanvas(32, 32);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0, 32, 32);
        bitmap.close();
        context.fillStyle = '#2563EB';
        context.beginPath();
        context.arc(24, 8, 8, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#FFFFFF';
        context.font = 'bold 12px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('Z', 24, 8.5);
        const png = await canvas.convertToBlob({ type: 'image/png' });
        return `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(await png.arrayBuffer())))}`;
    } catch (error) {
        console.warn('[BG] Could not create sleeping favicon:', error);
        return null;
    }
}

async function markPinnedTabFavicon(tab) {
    if (!tab?.pinned || !/^https?:\/\//i.test(tab.url || '')) return false;
    const favicon = await createSleepingFavicon(tab.url);
    if (!favicon) return false;

    let onUpdated;
    let timeout;
    // Wait for Chrome to receive the new favicon before discarding.
    const faviconReady = new Promise(resolve => {
        onUpdated = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.favIconUrl === favicon) resolve(true);
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        timeout = setTimeout(() => resolve(false), 1000);
    });

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: markedFavicon => {
                const previous = globalThis.__tabDozeSleepingFavicon;
                previous?.marker.remove();
                const icons = previous?.icons || Array.from(document.head.querySelectorAll('link[rel~="icon" i]'));
                icons.forEach(icon => icon.remove());
                const marker = document.createElement('link');
                marker.rel = 'icon';
                marker.type = 'image/png';
                marker.sizes = '32x32';
                marker.href = markedFavicon;
                document.head.appendChild(marker);
                globalThis.__tabDozeSleepingFavicon = { icons, marker };
            },
            args: [favicon]
        });
        return await faviconReady;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
    }
}

async function markTabTitleAsDiscarded(tabId, fallbackTitle = '') {
    try {
        return await Promise.race([
            (async () => {
                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: holdDiscardedTitleMarker,
                    args: [
                        DISCARDED_TITLE_PREFIX,
                        fallbackTitle,
                        MARK_TITLE_HOLD_MS,
                        MARK_TITLE_GUARD_MS,
                        TITLE_GUARD_STATE_KEY
                    ]
                });
                return Boolean(results?.[0]?.result);
            })(),
            new Promise(resolve => setTimeout(() => resolve(false), MARK_TITLE_TIMEOUT_MS))
        ]);
    } catch {
        // Some pages cannot be scripted. Discard should still proceed.
        return false;
    }
}

async function clearTabTitleDiscardMarker(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: clearDiscardedTitleMarker,
            args: [DISCARDED_TITLE_PREFIX, TITLE_GUARD_STATE_KEY]
        });
    } catch {
        // The tab may already be gone or no longer scriptable.
    }
}

async function holdDiscardedTitleMarker(prefix, fallbackTitle, holdMs, guardMs, stateKey) {
    globalThis[stateKey]?.stop?.();

    let stopped = false;
    let intervalId = null;
    let observer = null;

    const applyMarker = () => {
        if (stopped) return false;

        const currentTitle = document.title || fallbackTitle || '';
        if (!currentTitle) return false;

        if (!currentTitle.startsWith(prefix)) {
            document.title = prefix + currentTitle;
        }
        return document.title.startsWith(prefix);
    };

    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (intervalId !== null) clearInterval(intervalId);
        observer?.disconnect();
        if (globalThis[stateKey]?.stop === stop) delete globalThis[stateKey];
    };

    if (document.documentElement && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(applyMarker);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    intervalId = setInterval(applyMarker, 25);
    globalThis[stateKey] = { stop };
    setTimeout(stop, guardMs);

    applyMarker();
    await new Promise(resolve => setTimeout(resolve, holdMs));
    return applyMarker();
}

function clearDiscardedTitleMarker(prefix, stateKey) {
    globalThis[stateKey]?.stop?.();
    while (document.title.startsWith(prefix)) {
        document.title = document.title.slice(prefix.length);
    }
    const favicon = globalThis.__tabDozeSleepingFavicon;
    if (favicon) {
        favicon.marker.remove();
        document.head.append(...favicon.icons);
        delete globalThis.__tabDozeSleepingFavicon;
    }
}

async function restoreTab(tabId) {
    try {
        // Defensive handling: tab may have been closed
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
            console.log(`[BG][RESTORE] Tab ${tabId} no longer exists`);
            return false;
        }

        const originalUrl = getSleepingPageUrl(tab.url);
        if (originalUrl) {
            await chrome.tabs.update(tabId, { url: originalUrl });
            await updateBadge();
            return true;
        }

        if (tab.discarded) {
            return await reloadTab(tabId);
        }

        return false;
    } catch (error) {
        console.error('[BG] Failed to restore tab:', error);
        return false;
    }
}

async function reloadTab(tabId) {
    try {
        await chrome.tabs.reload(tabId);
        await enqueueSchedulerTask(reconcileSchedulerState, 'tab restore');
        await updateBadge();
        return true;
    } catch (reloadError) {
        if (reloadError.message?.includes('No tab with id')) {
            console.log(`[BG][RESTORE] Tab ${tabId} was closed during reload`);
            return false;
        }
        throw reloadError;
    }
}

async function suspendAllInactive(exceptTabId = null) {
    const tabs = await chrome.tabs.query({});
    let count = 0;

    for (const tab of tabs) {
        if (tab.id !== exceptTabId && !tab.active) {
            // Tab may have been closed since query - suspendTab handles this defensively
            const success = await suspendTab(tab.id);
            if (success) count++;
        }
    }

    await enqueueSchedulerTask(reconcileSchedulerState, 'manual suspension');
    return count;
}

async function suspendAllExcept(tabId) {
    return suspendAllInactive(tabId);
}

async function restoreAllTabs() {
    const tabs = await chrome.tabs.query({});
    let count = 0;

    for (const tab of tabs) {
        if (isSuspendedTab(tab)) {
            // Tab may have been closed since query - restoreTab handles this defensively
            const success = await restoreTab(tab.id);
            if (success) count++;
        }
    }

    await enqueueSchedulerTask(reconcileSchedulerState, 'restore all');
    return count;
}

// ============================================================================
// WHITELIST
// ============================================================================

function isWhitelisted(url) {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname.toLowerCase();

        // Normalize www prefix for consistent matching
        const hostnameWithoutWww = hostname.startsWith('www.') ? hostname.slice(4) : hostname;

        return config.whitelistedDomains.some(domain => {
            let d = domain.toLowerCase();
            // Normalize www prefix in whitelist domain too
            const domainWithoutWww = d.startsWith('www.') ? d.slice(4) : d;

            // Match with and without www prefix
            return hostname === d ||
                   hostname === domainWithoutWww ||
                   hostnameWithoutWww === d ||
                   hostnameWithoutWww === domainWithoutWww ||
                   hostname.endsWith('.' + d) ||
                   hostname.endsWith('.' + domainWithoutWww) ||
                   hostnameWithoutWww.endsWith('.' + d) ||
                   hostnameWithoutWww.endsWith('.' + domainWithoutWww);
        });
    } catch {
        return false;
    }
}

async function addToWhitelist(domain) {
    // Normalize domain: remove www prefix for consistency
    let normalizedDomain = domain.toLowerCase().trim();
    if (normalizedDomain.startsWith('www.')) {
        normalizedDomain = normalizedDomain.slice(4);
    }

    // Check if already exists (with or without www)
    const alreadyExists = config.whitelistedDomains.some(d => {
        const existingNormalized = d.toLowerCase().startsWith('www.') ? d.slice(4).toLowerCase() : d.toLowerCase();
        return existingNormalized === normalizedDomain;
    });

    if (!alreadyExists) {
        config.whitelistedDomains.push(normalizedDomain);
        await saveSettings();
    }
}

async function removeFromWhitelist(domain) {
    config.whitelistedDomains = config.whitelistedDomains.filter(d => d !== domain);
    await saveSettings();
}

async function whitelistCurrentSite(tab) {
    try {
        const url = new URL(tab.url);
        await addToWhitelist(url.hostname);
        await enqueueSchedulerTask(reconcileSchedulerState, 'whitelist current site');
    } catch (error) {
        console.error('[BG] Failed to whitelist site:', error);
    }
}

// ============================================================================
// HELPERS
// ============================================================================

function isInternalPage(url) {
    if (!url) return true;

    // All protocols that should NOT be suspended
    const internalPrefixes = [
        'chrome://',
        'chrome-extension://',
        'chrome-search://',
        'edge://',
        'about:',
        'file://',
        'data:',
        'blob:',
        'javascript:',
        'view-source:',
        'devtools://',
        'brave://',
        'opera://',
        'vivaldi://'
    ];

    return internalPrefixes.some(prefix => url.startsWith(prefix));
}

function isSuspendedTab(tab) {
    return Boolean(tab?.discarded || getSleepingPageUrl(tab?.url));
}

function getSleepingPageUrl(url) {
    const prefix = `${chrome.runtime.getURL('sleep.html')}#`;
    if (!url?.startsWith(prefix)) return null;
    return new URLSearchParams(url.slice(prefix.length)).get('url');
}

// ============================================================================
// STATS
// ============================================================================

async function updateMemoryStats(url) {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        const stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        const estimatedMemory = 50 * 1024 * 1024; // 50MB

        stats.totalSaved += estimatedMemory;
        stats.tabsSuspended++;
        stats.history.push({
            timestamp: Date.now(),
            url,
            memorySaved: estimatedMemory
        });

        if (stats.history.length > 500) {
            stats.history = stats.history.slice(-500);
        }

        await chrome.storage.local.set({ memoryStats: stats });

        // Update an open statistics page without keeping the service worker alive.
        try {
            const currentStats = await getStats();
            chrome.runtime.sendMessage({
                type: 'STATS_UPDATED',
                stats: currentStats,
                timestamp: Date.now()
            }).catch(() => {});
        } catch {
            // Statistics broadcasting is non-critical.
        }
    } catch (error) {
        console.error('[BG][STATS] Failed to update memory stats:', error);
    }
}

async function getStats() {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        let stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        // Validate and sanitize data to prevent NaN/corruption issues
        stats.totalSaved = Math.max(0, parseInt(stats.totalSaved) || 0);
        stats.tabsSuspended = Math.max(0, parseInt(stats.tabsSuspended) || 0);
        stats.history = Array.isArray(stats.history) ? stats.history : [];

        const today = new Date().toDateString();
        const todaySaved = stats.history
            .filter(h => new Date(h.timestamp).toDateString() === today)
            .reduce((sum, h) => sum + h.memorySaved, 0);

        const allTabs = await chrome.tabs.query({});
        const suspendedCount = allTabs.filter(isSuspendedTab).length;

        const response = {
            totalSaved: stats.totalSaved,
            todaySaved,
            tabsSuspended: suspendedCount,
            totalTabs: allTabs.length,
            activeTabs: allTabs.length - suspendedCount,
            lifetimeTabsSuspended: stats.tabsSuspended
        };

        return response;
    } catch (error) {
        console.error('[BG][STATS] Failed to get stats:', error);
        return { error: error.message };
    }
}

async function getTabList() {
    try {
        const windows = await chrome.windows.getAll({ populate: true });

        const inactiveSince = await getInactiveSinceMap();

        return windows.map(win => ({
            id: win.id,
            focused: win.focused,
            tabs: win.tabs.map(tab => ({
                id: tab.id,
                windowId: tab.windowId,
                url: getSleepingPageUrl(tab.url) || tab.url || '',
                title: tab.title || 'Untitled',
                favIconUrl: tab.favIconUrl || '',
                active: tab.active,
                status: isSuspendedTab(tab) ? 'suspended' : (tab.active ? 'active' : 'idle'),
                lastActivity: tab.active
                    ? Date.now()
                    : inactiveSince[tab.id] || tab.lastAccessed || Date.now()
            }))
        }));
    } catch (error) {
        console.error('[BG] Failed to get tab list:', error);
        return [];
    }
}

// ============================================================================
// BADGE
// ============================================================================

async function updateBadge() {
    if (!isExtensionContextValid()) {
        console.warn('[BG][BADGE] Extension context invalid, skipping badge update');
        return;
    }
    try {
        const tabs = await chrome.tabs.query({});
        const suspendedCount = tabs.filter(isSuspendedTab).length;

        // Re-check context before chrome.action calls
        if (!isExtensionContextValid()) {
            console.warn('[BG][BADGE] Context invalidated before setting badge');
            return;
        }

        await chrome.action.setBadgeText({
            text: suspendedCount > 0 ? String(suspendedCount) : ''
        });

        await chrome.action.setBadgeBackgroundColor({ color: '#0F766E' });
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG][BADGE] Context invalidated during badge update');
            return;
        }
        console.error('[BG] Failed to update badge:', error);
    }
}

// ============================================================================
// STARTUP
// ============================================================================

(async () => {
    // Verify extension context is valid before initialization
    if (!isExtensionContextValid()) {
        console.warn('[BG] Extension context invalid at init, will retry on next SW wake');
        return;
    }

    try {
        await ensureSettingsLoaded();
        await migrateLegacyTimerState();

        // Re-check context after each async operation
        if (!isExtensionContextValid()) {
            console.warn('[BG] Context invalidated after loadSettings');
            return;
        }

        await enqueueSchedulerTask(runSuspensionSweep, 'service worker initialization');
        await startActiveTabTracking();

        if (!isExtensionContextValid()) {
            console.warn('[BG] Context invalidated after scheduler initialization');
            return;
        }

        await updateBadge();

        if (!isExtensionContextValid()) {
            console.warn('[BG] Context invalidated after updateBadge');
            return;
        }

        console.log('[BG] Background initialized successfully');
    } catch (error) {
        // Check for context invalidation errors
        if (error.message && (error.message.includes('Extension context invalidated') ||
            error.message.includes('No SW'))) {
            console.warn('[BG] Context invalidated during initialization');
            return;
        }
        console.error('[BG] Initialization failed:', error);
    }
})();
