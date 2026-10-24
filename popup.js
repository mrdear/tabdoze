/**
 * TabDoze - Popup JavaScript
 * Handles tab list display and user interactions
 */

// DOM Elements - Core
const tabsList = document.getElementById('tabsList');
const memorySaved = document.getElementById('memorySaved');
const suspendedCount = document.getElementById('suspendedCount');
const totalTabCount = document.getElementById('totalTabCount');
const suspendAllBtn = document.getElementById('suspendAllBtn');
const restoreAllBtn = document.getElementById('restoreAllBtn');
const whitelistBtn = document.getElementById('whitelistBtn');
const settingsBtn = document.getElementById('settingsBtn');
const filterSelect = document.getElementById('filterSelect');

// DOM Elements - Hero Section
const heroEmotion = document.getElementById('heroEmotion');
const healthBarFill = document.getElementById('healthBarFill');
const healthPercent = document.getElementById('healthPercent');

// DOM Elements - Tab List Section
const tabsToggle = document.getElementById('tabsToggle');
const tabsExpanded = document.getElementById('tabsExpanded');
const tabsSummaryText = document.getElementById('tabsSummaryText');
const tabsChevron = document.getElementById('tabsChevron');
const windowCount = document.getElementById('windowCount');

let currentFilter = 'all';
let tabsData = [];

// Removed: these elements no longer exist in UI
// const progressFill = document.getElementById('progressFill');
// const memoryChange = document.getElementById('memoryChange');
// const heroMessage = document.getElementById('heroMessage');

// Operation locks to prevent race conditions
let isOperationInProgress = false;
const DISCARDED_TITLE_PREFIX = '💤 ';
const TITLE_GUARD_STATE_KEY = '__tabDozeTitleGuard';
const MARK_TITLE_HOLD_MS = 150;
const MARK_TITLE_GUARD_MS = 1200;
const MARK_TITLE_TIMEOUT_MS = 500;

// Helper function to check if extension context is still valid
function isContextValid() {
    return chrome.runtime?.id !== undefined;
}

// Safe wrapper for chrome.runtime.sendMessage that handles context invalidation
async function safeSendMessage(message) {
    if (!isContextValid()) {
        return undefined;
    }
    try {
        return await chrome.runtime.sendMessage(message);
    } catch (e) {
        // Context invalidated - extension was reloaded/updated
        if (e.message?.includes('Extension context invalidated') ||
            e.message?.includes('message port closed')) {
            return undefined;
        }
        throw e;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadStats();
    setupEventListeners();
    await initTabListState();
});

// Event Listeners
function setupEventListeners() {
    if (suspendAllBtn) suspendAllBtn.addEventListener('click', handleSuspendAll);
    if (restoreAllBtn) restoreAllBtn.addEventListener('click', handleRestoreAll);
    if (whitelistBtn) whitelistBtn.addEventListener('click', handleWhitelist);
    if (settingsBtn) settingsBtn.addEventListener('click', handleSettings);
    if (filterSelect) filterSelect.addEventListener('change', handleFilterChange);

    // Tab list toggle
    if (tabsToggle) {
        tabsToggle.addEventListener('click', toggleTabsList);
    }

}

function isTabListExpanded() {
    return Boolean(tabsExpanded && tabsExpanded.style.display !== 'none');
}

// Toggle tab list expand/collapse
async function toggleTabsList() {
    const isExpanded = tabsExpanded && tabsExpanded.style.display !== 'none';
    const nextExpanded = !isExpanded;

    if (tabsExpanded) {
        tabsExpanded.style.display = nextExpanded ? 'block' : 'none';
    }

    if (tabsChevron) {
        tabsChevron.style.transform = nextExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    if (nextExpanded && tabsData.length === 0) {
        await loadTabs();
    }

    // Save preference to storage
    try {
        await chrome.storage.local.set({ tabListExpanded: nextExpanded });
    } catch (e) {
        console.log('Could not save tab list preference:', e);
    }
}

// Initialize tab list state from storage
async function initTabListState() {
    try {
        if (tabsExpanded) {
            tabsExpanded.style.display = 'none';
        }

        if (tabsChevron) {
            tabsChevron.style.transform = 'rotate(0deg)';
        }

        if (tabsList) {
            tabsList.innerHTML = '';
        }

        await chrome.storage.local.set({ tabListExpanded: false });
    } catch (e) {
        console.log('Could not load tab list preference:', e);
    }
}

// Load Statistics - direct from storage as fallback
async function loadStats() {
    try {
        // Try messaging first
        try {
            const response = await safeSendMessage({ type: 'GET_STATS' });
            if (response && !response.error) {
                updateStatsDisplay(response);
                return;
            }
        } catch (e) {
            // Use direct storage fallback below.
        }

        // Fallback: read directly from storage
        const result = await chrome.storage.local.get('memoryStats');
        const stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        const today = new Date().toDateString();
        const todaySaved = (stats.history || [])
            .filter(h => new Date(h.timestamp).toDateString() === today)
            .reduce((sum, h) => sum + h.memorySaved, 0);

        const allTabs = await chrome.tabs.query({});
        const suspended = allTabs.filter(isSuspendedTab).length;

        updateStatsDisplay({
            totalSaved: stats.totalSaved || 0,
            todaySaved: todaySaved,
            tabsSuspended: suspended,
            totalTabs: allTabs.length
        });
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Update Stats Display
async function updateStatsDisplay(stats) {
    const todayBytes = stats.todaySaved || 0;
    const totalTabs = stats.totalTabs || 0;
    const suspended = stats.tabsSuspended || 0;

    // Hero value - memory saved
    if (memorySaved) {
        memorySaved.textContent = formatBytes(todayBytes);
    }

    // Hero emotional copy
    if (heroEmotion) {
        heroEmotion.textContent = getEmotionalCopy(todayBytes);
    }

    // Health bar - calculate percentage based on suspended tabs
    if (healthBarFill && healthPercent) {
        const percentage = totalTabs > 0 ? Math.round((suspended / totalTabs) * 100) : 0;
        healthBarFill.style.width = percentage + '%';
        healthPercent.textContent = percentage + '%';
    }

    // Stats
    if (suspendedCount) suspendedCount.textContent = suspended;
    if (totalTabCount) totalTabCount.textContent = totalTabs;

    const windows = await chrome.windows.getAll();
    const windowCnt = windows.length;

    // Window count
    if (windowCount) {
        windowCount.textContent = windowCnt;
    }

    // Update tab summary text
    if (tabsSummaryText) {
        tabsSummaryText.textContent = `${totalTabs} tabs across ${windowCnt} ${windowCnt === 1 ? 'window' : 'windows'}`;
    }

}

// REMOVED: Dead code - getYesterdayMemory() was never called
// REMOVED: Dead code - getHeroMessage() was never called

// Get emotional copy based on bytes saved (for hero section)
function getEmotionalCopy(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    const mb = bytes / (1024 * 1024);

    if (gb >= 1) return "Estimated from today's sleep events";
    if (mb >= 500) return "More idle tabs are sleeping";
    if (mb >= 100) return "Background tabs are resting";
    if (mb >= 50) return "One more tab put to sleep";
    return "Put idle tabs to sleep";
}

// Load Tabs - direct from Chrome API as fallback
async function loadTabs() {
    try {
        if (tabsList) tabsList.innerHTML = '<div class="loading">Loading tabs...</div>';

        // Try messaging first
        let windows = null;
        try {
            const response = await safeSendMessage({ type: 'GET_TAB_LIST' });
            if (response && Array.isArray(response) && response.length > 0) {
                windows = response;
            }
        } catch (e) {
            console.log('Message failed, using direct API:', e);
        }

        // Fallback: use Chrome API directly
        if (!windows) {
            const chromeWindows = await chrome.windows.getAll({ populate: true });
            windows = chromeWindows.map(win => ({
                id: win.id,
                focused: win.focused,
                tabs: win.tabs.map(tab => ({
                    id: tab.id,
                    windowId: tab.windowId,
                    url: tab.url || '',
                    title: tab.title || 'Untitled',
                    favIconUrl: tab.favIconUrl || '',
                    active: tab.active,
                    status: isSuspendedTab(tab) ? 'suspended' : (tab.active ? 'active' : 'idle')
                }))
            }));
        }

        if (!windows || windows.length === 0) {
            if (tabsList) tabsList.innerHTML = '<div class="empty-state"><p>No tabs found</p></div>';
            return;
        }

        tabsData = windows;
        renderTabs(windows);
    } catch (error) {
        console.error('Error loading tabs:', error);
        if (tabsList) tabsList.innerHTML = '<div class="empty-state"><p>Error: ' + error.message + '</p></div>';
    }
}

// Render Tabs
function renderTabs(windows) {
    if (!tabsList) return;
    tabsList.innerHTML = '';

    windows.forEach((win, winIndex) => {
        const windowGroup = document.createElement('div');
        windowGroup.className = 'window-group';

        // Window header
        const windowHeader = document.createElement('div');
        windowHeader.className = 'window-header';
        windowHeader.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
      </svg>
      Window ${winIndex + 1}
      ${win.focused ? '<span class="window-badge">Active</span>' : ''}
    `;
        windowGroup.appendChild(windowHeader);

        // Filter tabs
        let filteredTabs = win.tabs || [];
        if (currentFilter !== 'all') {
            filteredTabs = filteredTabs.filter(tab => tab.status === currentFilter);
        }

        // Tab items
        filteredTabs.forEach(tab => {
            const tabItem = createTabItem(tab);
            windowGroup.appendChild(tabItem);
        });

        if (filteredTabs.length > 0) {
            tabsList.appendChild(windowGroup);
        }
    });

    if (tabsList.children.length === 0) {
        tabsList.innerHTML = '<div class="empty-state"><p>No tabs match the filter</p></div>';
    }
}

// Create Tab Item Element
function createTabItem(tab) {
    const item = document.createElement('div');
    item.className = `tab-item ${tab.status}`;
    item.dataset.tabId = tab.id;

    const isSuspended = tab.status === 'suspended';
    const isActive = tab.status === 'active';
    const favicon = getDisplayFavicon(tab);
    const faviconMarkup = favicon
        ? `<img src="${escapeHtml(favicon)}" class="tab-favicon tab-favicon-img" alt="">`
        : '<span class="tab-favicon tab-favicon-placeholder" aria-hidden="true"></span>';
    const domain = getDomain(tab.url);
    const actionLabel = isSuspended ? 'Wake' : (isActive ? 'Active' : 'Sleep');
    const action = isSuspended ? 'restore' : 'suspend';

    item.innerHTML = `
    <span class="tab-favicon-wrap">
      ${faviconMarkup}
    </span>
    <div class="tab-info">
      <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
      <div class="tab-url">${escapeHtml(domain)}</div>
    </div>
    <span class="tab-status ${tab.status}">${isSuspended ? 'sleeping' : tab.status}</span>
    <button class="tab-action" data-action="${action}" ${isActive ? 'disabled' : ''}>
      ${actionLabel}
    </button>
  `;

    // Handle favicon load error
    const faviconImg = item.querySelector('.tab-favicon-img');
    if (faviconImg) {
        faviconImg.onerror = function() {
            const placeholder = document.createElement('span');
            placeholder.className = 'tab-favicon tab-favicon-placeholder';
            placeholder.setAttribute('aria-hidden', 'true');
            this.replaceWith(placeholder);
        };
    }

    // Tab click - switch to tab
    item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-action')) {
            chrome.tabs.update(tab.id, { active: true });
            if (tab.windowId) {
                chrome.windows.update(tab.windowId, { focused: true });
            }
        }
    });

    // Action button click
    const actionBtn = item.querySelector('.tab-action');
    actionBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const action = actionBtn.dataset.action;
        if (action === 'suspend') {
            const whitelistedDomains = await getWhitelistSettings();
            if (isUrlWhitelisted(tab.url, whitelistedDomains)) {
                // Show feedback that tab is whitelisted
                actionBtn.textContent = 'Kept Awake';
                actionBtn.disabled = true;
                setTimeout(() => {
                    actionBtn.textContent = 'Sleep';
                    actionBtn.disabled = false;
                }, 1500);
                return;
            }
            await suspendTabDirect(tab.id, tab.url, tab.title, tab.favIconUrl, whitelistedDomains);
        } else {
            await restoreTabDirect(tab.id, tab.url);
        }

        // Reload tabs
        setTimeout(() => {
            loadStats();
            if (isTabListExpanded()) loadTabs();
        }, 300);
    });

    return item;
}

function getDisplayFavicon(tab) {
    return getSafeFaviconSource(tab.favIconUrl || '');
}

function getSafeFaviconSource(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    const candidates = [trimmed];
    try {
        const decoded = decodeURIComponent(trimmed);
        if (decoded !== trimmed) candidates.push(decoded);
    } catch {
        // Keep the original value if it was not URI-encoded.
    }

    return candidates.find(isAllowedFaviconSource) || '';
}

function isAllowedFaviconSource(source) {
    return /^(https?:\/\/|data:image\/|chrome-extension:\/\/|blob:|chrome:\/\/favicon)/i.test(source);
}

function isSuspendedTab(tab) {
    return Boolean(tab?.discarded);
}

// Get whitelist settings from storage
async function getWhitelistSettings() {
    try {
        const result = await chrome.storage.sync.get('tabSuspenderSettings');
        return result.tabSuspenderSettings?.whitelistedDomains || [];
    } catch (error) {
        console.error('[WHITELIST] Failed to get whitelist settings:', error);
        return [];
    }
}

// Check if URL is whitelisted
function isUrlWhitelisted(url, whitelistedDomains) {
    if (!url || !whitelistedDomains || whitelistedDomains.length === 0) {
        return false;
    }

    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname.toLowerCase();

        // Normalize www prefix
        const hostnameWithoutWww = hostname.startsWith('www.') ? hostname.slice(4) : hostname;

        return whitelistedDomains.some(domain => {
            const d = domain.toLowerCase();
            const domainWithoutWww = d.startsWith('www.') ? d.slice(4) : d;

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

// Direct suspend function (fallback)
async function suspendTabDirect(tabId, url, title, favicon, whitelistedDomains = null) {
    try {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) return false;

        // Don't suspend internal pages or already suspended
        if (isInternalUrl(tab.url || url) || isSuspendedTab(tab) || tab.active) {
            return false;
        }

        // Check whitelist if domains provided
        if (whitelistedDomains && isUrlWhitelisted(tab.url || url, whitelistedDomains)) {
            console.log('[SUSPEND] Tab is whitelisted, skipping:', tab.url || url);
            return false;
        }

        await markTabTitleAsDiscarded(tabId, tab.title || title);
        try {
            const discardedTab = await chrome.tabs.discard(tabId);
            const latestTab = discardedTab?.discarded
                ? discardedTab
                : await chrome.tabs.get(tabId).catch(() => null);

            if (!latestTab?.discarded) {
                await clearTabTitleDiscardMarker(tabId);
                console.warn('[SUSPEND] Browser did not discard tab:', tabId);
                return false;
            }
        } catch (discardError) {
            await clearTabTitleDiscardMarker(tabId);
            throw discardError;
        }

        // Update stats locally since we're bypassing background.js suspendTab()
        await updateMemoryStatsLocal(tab.url || url);

        return true;
    } catch (error) {
        console.error('Failed to suspend tab:', error);
        return false;
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
}

// Update memory stats locally (mirrors background.js logic)
async function updateMemoryStatsLocal(url) {
    try {
        const result = await chrome.storage.local.get('memoryStats');
        const stats = result.memoryStats || { totalSaved: 0, tabsSuspended: 0, history: [] };

        const estimatedMemory = 50 * 1024 * 1024; // 50MB per tab

        stats.totalSaved += estimatedMemory;
        stats.tabsSuspended++;
        stats.history.push({
            timestamp: Date.now(),
            url: url || 'unknown',
            memorySaved: estimatedMemory
        });

        // Keep history to last 500 entries
        if (stats.history.length > 500) {
            stats.history = stats.history.slice(-500);
        }

        await chrome.storage.local.set({ memoryStats: stats });
    } catch (error) {
        console.error('[STATS] Failed to update memory stats:', error);
    }
}

// Direct restore function (fallback)
async function restoreTabDirect(tabId, currentUrl) {
    try {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) return;

        if (tab.discarded) {
            await chrome.tabs.reload(tabId);
        }
    } catch (error) {
        console.error('Failed to restore tab:', error);
    }
}

// Handle Suspend Other Tabs
async function handleSuspendAll() {
    // Prevent race conditions
    if (isOperationInProgress) return;
    isOperationInProgress = true;

    suspendAllBtn.disabled = true;
    suspendAllBtn.textContent = 'Putting tabs to sleep...';

    try {
        await handleSuspendAllBasic();
    } catch (error) {
        console.error('Error suspending other tabs:', error);
        suspendAllBtn.disabled = false;
        isOperationInProgress = false;
    }
}

// Basic suspend other tabs (fallback without feedback)
async function handleSuspendAllBasic() {
    try {
        // Get whitelist and other settings
        const settingsResult = await chrome.storage.sync.get('tabSuspenderSettings');
        const settings = settingsResult.tabSuspenderSettings || {};
        const whitelistedDomains = settings.whitelistedDomains || [];

        const tabs = await chrome.tabs.query({ active: false });
        let suspendedCount = 0;

        for (const tab of tabs) {
            // Skip if no URL
            if (!tab.url) continue;

            // Skip internal pages
            if (isInternalUrl(tab.url)) continue;

            // Skip already suspended/discarded
            if (isSuspendedTab(tab)) continue;

            // Skip whitelisted domains
            if (isUrlWhitelisted(tab.url, whitelistedDomains)) {
                continue;
            }

            const success = await suspendTabDirect(tab.id, tab.url, tab.title, tab.favIconUrl, whitelistedDomains);
            if (success) suspendedCount++;
        }

        setTimeout(() => {
            loadStats();
            if (isTabListExpanded()) loadTabs();
            resetSuspendAllButton();
            isOperationInProgress = false;
        }, 500);
    } catch (error) {
        console.error('Error in basic suspend other tabs:', error);
        resetSuspendAllButton();
        isOperationInProgress = false;
    }
}

// Reset primary suspend button to default state
function resetSuspendAllButton() {
    if (suspendAllBtn) {
        suspendAllBtn.disabled = false;
        suspendAllBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
            <span>Sleep Other Tabs</span>
        `;
    }
}

// Check if URL is internal/special and should not be suspended
function isInternalUrl(url) {
    if (!url) return false; // undefined URLs are NOT system pages - this was the bug!
    const internalPrefixes = [
        'chrome://', 'chrome-extension://', 'chrome-search://',
        'edge://', 'about:', 'file://', 'data:', 'blob:',
        'javascript:', 'view-source:', 'devtools://',
        'brave://', 'opera://', 'vivaldi://'
    ];
    return internalPrefixes.some(prefix => url.startsWith(prefix));
}

// Handle Restore All
async function handleRestoreAll() {
    // Prevent race conditions
    if (isOperationInProgress) return;
    isOperationInProgress = true;

    restoreAllBtn.disabled = true;
    restoreAllBtn.textContent = 'Waking tabs...';

    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (isSuspendedTab(tab)) {
                await restoreTabDirect(tab.id, tab.url);
            }
        }

        setTimeout(() => {
            loadStats();
            if (isTabListExpanded()) loadTabs();
            restoreAllBtn.disabled = false;
            restoreAllBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Wake All
      `;
            isOperationInProgress = false;
        }, 500);
    } catch (error) {
        console.error('Error restoring all:', error);
        restoreAllBtn.disabled = false;
        isOperationInProgress = false;
    }
}

// Handle Whitelist
async function handleWhitelist() {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Check if we have a valid tab with URL
        if (!activeTab) {
            showWhitelistError('No active tab found');
            return;
        }

        if (!activeTab.url) {
            showWhitelistError('Cannot whitelist this page');
            return;
        }

        // Check for internal/restricted URLs
        const url = activeTab.url;
        if (url.startsWith('chrome://') ||
            url.startsWith('chrome-extension://') ||
            url.startsWith('about:') ||
            url.startsWith('edge://') ||
            url.startsWith('brave://')) {
            showWhitelistError('Cannot whitelist browser pages');
            return;
        }

        const domain = getDomain(activeTab.url);

        if (!domain || domain === 'Unknown') {
            showWhitelistError('Invalid domain');
            return;
        }

        // Save to storage directly with try-catch
        let result;
        try {
            result = await chrome.storage.sync.get('tabSuspenderSettings');
        } catch (storageError) {
            console.error('[WHITELIST] Failed to read settings:', storageError);
            showWhitelistError('Failed to read settings');
            return;
        }
        const settings = result.tabSuspenderSettings || { whitelistedDomains: [] };

        // Check if already whitelisted
        if (settings.whitelistedDomains.includes(domain)) {
            showWhitelistSuccess(domain, true); // Already whitelisted
            return;
        }

        settings.whitelistedDomains.push(domain);
        try {
            await chrome.storage.sync.set({ tabSuspenderSettings: settings });
        } catch (storageError) {
            console.error('[WHITELIST] Failed to save settings:', storageError);
            showWhitelistError('Failed to save whitelist');
            return;
        }

        // Notify background.js to reload config (for immediate effect on running timers)
        try {
            await safeSendMessage({ type: 'RELOAD_CONFIG' });
            console.log('[WHITELIST] Notified background to reload config');
        } catch (e) {
            // Background might not be listening for this, that's okay - storage.onChanged will handle it
            console.log('[WHITELIST] Background notification failed (using storage fallback):', e);
        }

        showWhitelistSuccess(domain, false);

    } catch (error) {
        console.error('[WHITELIST] Error whitelisting:', error);
        showWhitelistError('Failed to whitelist');
    }
}

// Show whitelist success feedback
function showWhitelistSuccess(domain, alreadyWhitelisted) {
    const message = alreadyWhitelisted ? 'Already protected' : `${domain} protected`;

    whitelistBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        ${alreadyWhitelisted ? 'Protected' : 'Added!'}
      `;
    whitelistBtn.style.borderColor = '#22c55e';
    whitelistBtn.style.color = '#22c55e';
    whitelistBtn.title = message;

    setTimeout(() => {
        whitelistBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          Keep Awake
        `;
        whitelistBtn.style.borderColor = '';
        whitelistBtn.style.color = '';
        whitelistBtn.title = 'Keep current site awake';
    }, 2000);
}

// Show whitelist error feedback
function showWhitelistError(message) {
    whitelistBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        Can't add
      `;
    whitelistBtn.style.borderColor = '#ef4444';
    whitelistBtn.style.color = '#ef4444';
    whitelistBtn.title = message;

    setTimeout(() => {
        whitelistBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          Keep Awake
        `;
        whitelistBtn.style.borderColor = '';
        whitelistBtn.style.color = '';
        whitelistBtn.title = 'Keep current site awake';
    }, 2000);
}

// Handle Settings
function handleSettings() {
    chrome.runtime.openOptionsPage();
}

// Handle Filter Change
function handleFilterChange() {
    currentFilter = filterSelect.value;
    renderTabs(tabsData);
}

// Utility Functions
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 MB';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDomain(url) {
    try {
        if (!url) return 'Unknown';
        return new URL(url).hostname;
    } catch {
        return url || 'Unknown';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
