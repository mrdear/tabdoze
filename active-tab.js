(() => {
    if (globalThis.__tabDozeActivityTracker) return;
    globalThis.__tabDozeActivityTracker = true;

    const interactionEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove'];
    const isTopFrame = window === window.top;
    let timeoutMs = 0;
    let timer = null;

    function scheduleCheck() {
        if (!isTopFrame || !timeoutMs) return;
        const remaining = globalThis.__tabDozeLastActivity + timeoutMs - Date.now();
        timer = setTimeout(checkInactivity, Math.max(0, remaining));
    }

    function recordActivity(event) {
        if (!event.isTrusted || !timeoutMs) return;
        globalThis.__tabDozeLastActivity = Date.now();
        if (timer === null) scheduleCheck();
    }

    function handleVisibilityChange(event) {
        if (!document.hidden) recordActivity(event);
    }

    async function checkInactivity() {
        timer = null;
        if (!timeoutMs) return;
        if (Date.now() - globalThis.__tabDozeLastActivity < timeoutMs) {
            scheduleCheck();
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({ type: 'SUSPEND_IDLE_ACTIVE_TAB' });
            if (response?.lastActivity && timeoutMs) {
                globalThis.__tabDozeLastActivity = Math.max(
                    globalThis.__tabDozeLastActivity,
                    response.lastActivity
                );
                if (timer === null) scheduleCheck();
            }
        } catch {
            // Navigating to the sleeping page closes this content script's connection.
        }
    }

    function applySettings(settings = {}) {
        const wasEnabled = timeoutMs > 0;
        const enabled = settings.suspendActiveTab === true;
        timeoutMs = enabled ? (Number(settings.suspensionTimeout) || 30) * 90 * 1000 : 0;

        if (enabled !== wasEnabled) {
            for (const eventName of interactionEvents) {
                if (enabled) {
                    document.addEventListener(eventName, recordActivity, { capture: true, passive: true });
                } else {
                    document.removeEventListener(eventName, recordActivity, true);
                }
            }
            if (enabled) {
                if (isTopFrame) {
                    window.addEventListener('focus', recordActivity);
                    document.addEventListener('visibilitychange', handleVisibilityChange);
                }
                globalThis.__tabDozeLastActivity = isTopFrame ? Date.now() : 0;
            } else {
                window.removeEventListener('focus', recordActivity);
                document.removeEventListener('visibilitychange', handleVisibilityChange);
                globalThis.__tabDozeLastActivity = 0;
            }
        }

        clearTimeout(timer);
        timer = null;
        if (enabled) scheduleCheck();
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.tabSuspenderSettings) {
            applySettings(changes.tabSuspenderSettings.newValue);
        }
    });

    chrome.storage.sync.get('tabSuspenderSettings').then(result => {
        applySettings(result.tabSuspenderSettings);
    });
})();
