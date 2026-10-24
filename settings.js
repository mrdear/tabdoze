/**
 * TabDoze - Settings Page JavaScript
 * Redesigned with Smart Defaults approach
 */

// DOM Elements - Header
const backBtn = document.getElementById('backBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

// DOM Elements - Profile Selection
const profileSelector = document.getElementById('profileSelector');
const profileStatus = document.getElementById('profileStatus');

// DOM Elements - Custom Timing
const customTimingSection = document.getElementById('customTimingSection');
const customTimingSlider = document.getElementById('customTimingSlider');
const timeoutSlider = document.getElementById('timeout');
const timeoutValue = document.getElementById('timeoutValue');
const suspendActiveTabCheckbox = document.getElementById('suspendActiveTab');
const activeTabSleepDescription = document.getElementById('activeTabSleepDescription');

// DOM Elements - Whitelist
const addCurrentSiteBtn = document.getElementById('addCurrentSiteBtn');
const whitelistItems = document.getElementById('whitelistItems');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomainBtn');

// DOM Elements - Impact
const impactValue = document.getElementById('impactValue');
const impactRank = document.getElementById('impactRank');
const viewStatsBtn = document.getElementById('viewStatsBtn');

// DOM Elements - Toast
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// State
let settings = {};
let currentProfile = 'balanced';

// Profile configurations
const PROFILES = {
    relaxed: { timeout: 60, name: 'Relaxed', desc: '60 min' },
    balanced: { timeout: 30, name: 'Balanced', desc: '30 min' },
    aggressive: { timeout: 15, name: 'Aggressive', desc: '15 min' }
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await initIncludedFeatures();
    await loadSettings();
    await loadStats();
    setupEventListeners();
    updateUI();
});

async function initIncludedFeatures() {
    if (customTimingSlider) customTimingSlider.style.display = 'flex';
}

// Load settings
async function loadSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        settings = { suspendActiveTab: false, ...response.settings };

        const timeout = settings.suspensionTimeout || 30;
        currentProfile = getProfileForTimeout(timeout);
    } catch (error) {
        console.error('Failed to load settings:', error);
        showToast('Failed to load settings', 'error');
    }
}

// Load stats
async function loadStats() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
        const totalSaved = response.totalSaved || 0;
        const lifetimeTabs = response.lifetimeTabsSuspended || 0;

        // Format bytes to human readable (with null check)
        if (impactValue) impactValue.textContent = formatBytes(totalSaved);

        if (impactRank) impactRank.textContent = `${lifetimeTabs} tabs put to sleep`;
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Update UI based on settings
function updateUI() {
    // Update profile selector
    updateProfileSelector();

    // Update timeout slider
    if (timeoutSlider) {
        timeoutSlider.value = settings.suspensionTimeout || 30;
        updateTimeoutDisplay();
    }

    if (suspendActiveTabCheckbox) {
        suspendActiveTabCheckbox.checked = settings.suspendActiveTab === true;
    }

    // Update whitelist
    renderWhitelist();
}

// Update profile selector UI
function updateProfileSelector() {
    const buttons = profileSelector.querySelectorAll('.profile-btn');
    buttons.forEach(btn => {
        const profile = btn.dataset.profile;
        btn.classList.toggle('active', profile === currentProfile);
    });

    const timeout = Number(settings.suspensionTimeout) || Number(timeoutSlider?.value) || 30;
    profileStatus.innerHTML = `Currently: Tabs sleep after <strong>${timeout} minutes</strong>`;
    if (activeTabSleepDescription) {
        activeTabSleepDescription.textContent = `Sleep after ${timeout * 1.5} minutes without interaction (1.5× the sleep delay). Click Wake tab to reload the page.`;
    }
}

function getProfileForTimeout(timeout) {
    const match = Object.entries(PROFILES).find(([, profile]) => profile.timeout === Number(timeout));
    return match?.[0] || 'custom';
}

// Update timeout display
function updateTimeoutDisplay() {
    if (!timeoutValue || !timeoutSlider) return;
    const value = parseInt(timeoutSlider.value);
    if (value < 60) {
        timeoutValue.textContent = `${value} min`;
    } else {
        timeoutValue.textContent = `${Math.floor(value / 60)} hr`;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Back button
    backBtn?.addEventListener('click', () => {
        window.close();
    });

    // Profile selection
    profileSelector?.addEventListener('click', (e) => {
        const btn = e.target.closest('.profile-btn');
        if (!btn) return;

        const profile = btn.dataset.profile;
        const timeout = parseInt(btn.dataset.timeout);

        currentProfile = profile;
        settings.suspensionTimeout = timeout;
        if (timeoutSlider) timeoutSlider.value = timeout;

        updateTimeoutDisplay();
        updateProfileSelector();
        saveSettings();
    });

    // Custom timing slider
    timeoutSlider?.addEventListener('input', () => {
        const timeout = parseInt(timeoutSlider.value, 10);
        settings.suspensionTimeout = timeout;
        currentProfile = getProfileForTimeout(timeout);
        updateTimeoutDisplay();
        updateProfileSelector();
        debouncedSave();
    });

    suspendActiveTabCheckbox?.addEventListener('change', () => {
        settings.suspendActiveTab = suspendActiveTabCheckbox.checked;
        saveSettings();
    });

    // Whitelist - Add current site
    addCurrentSiteBtn?.addEventListener('click', addCurrentSite);

    // Whitelist - Add manual domain
    addDomainBtn?.addEventListener('click', addManualDomain);
    newDomainInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addManualDomain();
    });

    // View stats
    viewStatsBtn?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('stats-dashboard.html') });
    });

    // Export/Import
    exportBtn?.addEventListener('click', exportSettings);
    importBtn?.addEventListener('click', () => importFile.click());
    importFile?.addEventListener('change', importSettings);
}

// Add current site to whitelist
async function addCurrentSite() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
            showToast('Could not get current tab', 'error');
            return;
        }

        const url = new URL(tab.url);
        const domain = url.hostname.replace(/^www\./, '');

        if (domain.startsWith('chrome') || domain.startsWith('about')) {
            showToast('Browser pages cannot be added to Keep Awake', 'error');
            return;
        }

        await addDomain(domain);
    } catch (error) {
        console.error('Error adding current site:', error);
        showToast('Failed to add current site', 'error');
    }
}

// Add manual domain
function addManualDomain() {
    let domain = newDomainInput.value.trim().toLowerCase();
    if (!domain) return;

    // Clean up domain
    domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    // Validate
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(domain)) {
        showToast('Invalid domain format', 'error');
        return;
    }

    addDomain(domain);
    newDomainInput.value = '';
}

// Add domain to whitelist
async function addDomain(domain) {
    // Check if already exists
    if (settings.whitelistedDomains?.includes(domain)) {
        showToast('Domain is already kept awake', 'error');
        return;
    }

    try {
        await chrome.runtime.sendMessage({ type: 'WHITELIST_DOMAIN', domain });
        settings.whitelistedDomains = settings.whitelistedDomains || [];
        settings.whitelistedDomains.push(domain);
        renderWhitelist();
        showToast(`Added ${domain}`, 'success');
    } catch (error) {
        console.error('Failed to add domain:', error);
        showToast('Failed to add domain', 'error');
    }
}

// Remove domain from whitelist
async function removeDomain(domain) {
    try {
        await chrome.runtime.sendMessage({ type: 'REMOVE_WHITELIST', domain });
        settings.whitelistedDomains = settings.whitelistedDomains.filter(d => d !== domain);
        renderWhitelist();
        showToast(`Removed ${domain}`, 'success');
    } catch (error) {
        console.error('Failed to remove domain:', error);
        showToast('Failed to remove domain', 'error');
    }
}

// Render whitelist
function renderWhitelist() {
    const domains = settings.whitelistedDomains || [];
    const count = domains.length;

    // Update whitelist counter/header
    updateWhitelistHeader(count);

    if (count === 0) {
        whitelistItems.innerHTML = '<div class="whitelist-empty">No domains kept awake yet</div>';
        return;
    }

    whitelistItems.innerHTML = domains.map(domain => `
        <div class="whitelist-item" data-domain="${escapeHtml(domain)}">
            <span class="whitelist-domain">${escapeHtml(domain)}</span>
            <button class="whitelist-remove" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `).join('');

    // Add remove handlers
    whitelistItems.querySelectorAll('.whitelist-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.whitelist-item');
            const domain = item.dataset.domain;
            removeDomain(domain);
        });
    });
}

// Update whitelist header with counter
function updateWhitelistHeader(count) {
    const section = document.querySelector('.section:has(#whitelistItems)');
    if (!section) return;

    let counterEl = section.querySelector('.whitelist-counter');
    if (!counterEl) {
        counterEl = document.createElement('div');
        counterEl.className = 'whitelist-counter';
        const header = section.querySelector('.section-header');
        if (header) {
            header.appendChild(counterEl);
        }
    }
    counterEl.innerHTML = `<span class="counter-text unlimited">${count} sites</span>`;
}

// Debounced save
let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 500);
}

// Save settings
async function saveSettings() {
    try {
        const newSettings = {
            suspensionTimeout: parseInt(timeoutSlider?.value || settings.suspensionTimeout || 30, 10),
            suspendActiveTab: suspendActiveTabCheckbox?.checked === true,
            whitelistedDomains: settings.whitelistedDomains || []
        };

        await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: newSettings });
        settings = { ...settings, ...newSettings };
        showToast('Settings saved', 'success');
    } catch (error) {
        console.error('Failed to save settings:', error);
        showToast('Failed to save settings', 'error');
    }
}

// Export settings
function exportSettings() {
    const exportData = {
        ...settings,
        exportedAt: new Date().toISOString(),
        version: '1.1.3'
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tabdoze-settings.json';
    a.click();
    URL.revokeObjectURL(url);

    showToast('Settings exported', 'success');
}

// Import settings
async function importSettings(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const imported = JSON.parse(text);

        // Validate
        const validSettings = validateImportedSettings(imported);
        if (Object.keys(validSettings).length === 0) {
            showToast('No valid settings found', 'error');
            return;
        }

        await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: validSettings });
        settings = { ...settings, ...validSettings };
        updateUI();
        showToast('Settings imported', 'success');
    } catch (error) {
        console.error('Failed to import settings:', error);
        showToast('Failed to import settings', 'error');
    }

    importFile.value = '';
}

// Validate imported settings
function validateImportedSettings(imported) {
    const valid = {};

    if (typeof imported.suspensionTimeout === 'number' && imported.suspensionTimeout >= 1 && imported.suspensionTimeout <= 120) {
        valid.suspensionTimeout = imported.suspensionTimeout;
    }

    if (typeof imported.suspendActiveTab === 'boolean') {
        valid.suspendActiveTab = imported.suspendActiveTab;
    }

    if (Array.isArray(imported.whitelistedDomains)) {
        valid.whitelistedDomains = imported.whitelistedDomains
            .filter(d => typeof d === 'string' && d.trim().length > 0)
            .map(d => d.trim().toLowerCase());
    }

    return valid;
}

// Helper functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    toastMessage.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Force save on unload
window.addEventListener('beforeunload', () => {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveSettings();
    }
});
