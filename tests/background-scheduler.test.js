const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(
    path.join(__dirname, '..', 'background.js'),
    'utf8'
) + `
globalThis.__schedulerTest = {
    alarmName: SUSPEND_ALARM_NAME,
    clearDiscardedTitleMarker,
    getInactiveSinceMap,
    handleMessage,
    holdDiscardedTitleMarker,
    reconcile: () => enqueueSchedulerTask(reconcileSchedulerState, 'test reconcile'),
    sweep: () => enqueueSchedulerTask(runSuspensionSweep, 'test sweep'),
    waitForQueue: () => schedulerQueue
};
`;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createEvent() {
    const listeners = [];
    return {
        addListener(listener) {
            listeners.push(listener);
        },
        async emit(...args) {
            await Promise.all(listeners.map(listener => listener(...args)));
        }
    };
}

function createStorageArea(store) {
    return {
        async get(keys) {
            if (keys === undefined || keys === null) return clone(store);

            const result = {};
            if (typeof keys === 'string') {
                if (store[keys] !== undefined) result[keys] = clone(store[keys]);
                return result;
            }

            if (Array.isArray(keys)) {
                for (const key of keys) {
                    if (store[key] !== undefined) result[key] = clone(store[key]);
                }
                return result;
            }

            for (const [key, fallback] of Object.entries(keys)) {
                result[key] = store[key] === undefined ? clone(fallback) : clone(store[key]);
            }
            return result;
        },
        async set(values) {
            Object.assign(store, clone(values));
        },
        async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
        }
    };
}

function createHarness(options = {}) {
    const shared = options.shared || {};
    const clock = shared.clock || { now: options.now || 1_000_000 };
    const tabs = shared.tabs || clone(options.tabs || []);
    const alarms = shared.alarms || {};
    const calls = [];
    const storage = shared.storage || {
        session: {},
        local: { schedulerStateVersion: 2 },
        sync: {
            tabSuspenderSettings: {
                suspensionTimeout: options.timeout || 30,
                whitelistedDomains: options.whitelistedDomains || []
            }
        }
    };

    const events = {
        alarm: createEvent(),
        command: createEvent(),
        contextMenu: createEvent(),
        installed: createEvent(),
        message: createEvent(),
        port: createEvent(),
        startup: createEvent(),
        tabActivated: createEvent(),
        tabCreated: createEvent(),
        tabRemoved: createEvent(),
        tabReplaced: createEvent(),
        tabUpdated: createEvent()
    };

    function findTab(tabId) {
        return tabs.find(tab => tab.id === tabId);
    }

    const chrome = {
        runtime: {
            id: 'scheduler-test',
            lastError: null,
            onInstalled: events.installed,
            onStartup: events.startup,
            onConnect: events.port,
            onMessage: events.message,
            getURL: value => `chrome-extension://scheduler-test/${value}`,
            async sendMessage() {}
        },
        storage: {
            session: createStorageArea(storage.session),
            local: createStorageArea(storage.local),
            sync: createStorageArea(storage.sync)
        },
        alarms: {
            onAlarm: events.alarm,
            async create(name, alarmInfo) {
                const scheduledTime = alarmInfo.when ??
                    clock.now + alarmInfo.delayInMinutes * 60 * 1000;
                alarms[name] = { name, scheduledTime };
                calls.push(`alarm:${name}:${scheduledTime}`);
            },
            async get(name) {
                return clone(alarms[name]);
            },
            async getAll() {
                return clone(Object.values(alarms));
            },
            async clear(name) {
                const existed = Boolean(alarms[name]);
                delete alarms[name];
                return existed;
            }
        },
        tabs: {
            onActivated: events.tabActivated,
            onUpdated: events.tabUpdated,
            onRemoved: events.tabRemoved,
            onCreated: events.tabCreated,
            onReplaced: events.tabReplaced,
            async query(queryInfo = {}) {
                return clone(tabs.filter(tab =>
                    queryInfo.active === undefined || tab.active === queryInfo.active
                ));
            },
            async get(tabId) {
                const tab = findTab(tabId);
                if (!tab) throw new Error(`No tab with id: ${tabId}`);
                return clone(tab);
            },
            async discard(tabId) {
                const tab = findTab(tabId);
                if (!tab) throw new Error(`No tab with id: ${tabId}`);
                if (tab.active) throw new Error('Cannot discard active tab');
                if (options.discardError) throw new Error(options.discardError);
                if (options.discardNoEffect) {
                    calls.push(`discard-no-effect:${tabId}`);
                    return undefined;
                }
                tab.discarded = true;
                calls.push(`discard:${tabId}`);
                return clone(tab);
            },
            async reload(tabId) {
                const tab = findTab(tabId);
                if (!tab) throw new Error(`No tab with id: ${tabId}`);
                tab.discarded = false;
            },
            async create() {}
        },
        windows: {
            async getAll() {
                return [{ id: 1, focused: true, tabs: clone(tabs) }];
            }
        },
        scripting: {
            async executeScript({ target, func }) {
                const operation = func?.name === 'clearDiscardedTitleMarker' ? 'unmark' : 'mark';
                calls.push(`${operation}:${target.tabId}`);
                return [{ result: true }];
            }
        },
        action: {
            async setBadgeText() {},
            async setBadgeBackgroundColor() {}
        },
        contextMenus: {
            onClicked: events.contextMenu,
            removeAll(callback) {
                callback();
            },
            create() {}
        },
        commands: { onCommand: events.command }
    };

    class FakeDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [clock.now]));
        }

        static now() {
            return clock.now;
        }
    }

    const context = vm.createContext({
        chrome,
        console: { log() {}, warn() {}, error() {} },
        Date: FakeDate,
        URL,
        setTimeout(callback, delay = 0) {
            if (delay < 1000) callback();
            return 0;
        },
        clearTimeout() {},
        setInterval(callback) {
            callback();
            return 1;
        },
        clearInterval() {}
    });

    vm.runInContext(backgroundSource, context, { filename: 'background.js' });

    return {
        api: context.__schedulerTest,
        alarms,
        calls,
        clock,
        context,
        events,
        storage,
        tabs,
        shared: { alarms, clock, storage, tabs }
    };
}

async function settle(harness) {
    for (let i = 0; i < 4; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    await harness.api.waitForQueue();
}

test('inactivity starts when a tab leaves the active state', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, url: 'https://active.example', active: true, discarded: false },
            { id: 2, url: 'https://idle.example', active: false, discarded: false }
        ]
    });
    await settle(harness);

    assert.deepEqual(harness.storage.session.tabInactiveSince, { 2: harness.clock.now });

    harness.clock.now += 29 * 60 * 1000;
    harness.tabs[0].active = false;
    harness.tabs[1].active = true;
    await harness.events.tabActivated.emit({ tabId: 2, windowId: 1 });
    await settle(harness);

    assert.deepEqual(harness.storage.session.tabInactiveSince, { 1: harness.clock.now });
    assert.equal(harness.tabs[0].discarded, false);
    assert.equal(
        harness.alarms[harness.api.alarmName].scheduledTime,
        harness.clock.now + 30 * 60 * 1000
    );
});

test('page loads and service worker restarts preserve inactivity', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, url: 'https://active.example', active: true, discarded: false },
            { id: 2, url: 'https://idle.example', active: false, discarded: false }
        ]
    });
    await settle(harness);
    const inactiveSince = harness.storage.session.tabInactiveSince[2];

    harness.clock.now += 10 * 60 * 1000;
    await harness.events.tabUpdated.emit(2, { status: 'complete' }, clone(harness.tabs[1]));
    await settle(harness);
    assert.equal(harness.storage.session.tabInactiveSince[2], inactiveSince);

    const restarted = createHarness({ shared: harness.shared });
    await settle(restarted);
    assert.equal(restarted.storage.session.tabInactiveSince[2], inactiveSince);
    assert.equal(
        restarted.alarms[restarted.api.alarmName].scheduledTime,
        inactiveSince + 30 * 60 * 1000
    );
});

test('deadline marks the title before discarding only eligible tabs', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, url: 'https://active.example', active: true, discarded: false },
            { id: 2, url: 'https://idle.example', active: false, discarded: false },
            { id: 3, url: 'https://keep.example', active: false, discarded: false }
        ],
        whitelistedDomains: ['keep.example']
    });
    await settle(harness);

    harness.clock.now += 30 * 60 * 1000;
    await harness.events.alarm.emit({ name: harness.api.alarmName });
    await settle(harness);

    assert.equal(harness.tabs[0].discarded, false);
    assert.equal(harness.tabs[1].discarded, true);
    assert.equal(harness.tabs[2].discarded, false);
    assert.ok(harness.calls.indexOf('mark:2') < harness.calls.indexOf('discard:2'));
    assert.deepEqual(harness.storage.session.tabInactiveSince, {});
});

test('a woken tab starts a fresh inactivity cycle and can be discarded again', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, windowId: 1, url: 'https://active.example', active: true, discarded: false },
            { id: 2, windowId: 1, url: 'https://idle.example', active: false, discarded: false }
        ]
    });
    await settle(harness);

    harness.clock.now += 30 * 60 * 1000;
    await harness.events.alarm.emit({ name: harness.api.alarmName });
    await settle(harness);
    assert.equal(harness.tabs[1].discarded, true);

    harness.clock.now += 60 * 1000;
    await harness.events.tabActivated.emit({ tabId: 2, windowId: 1 });
    await settle(harness);
    harness.tabs[0].active = false;
    harness.tabs[1].active = true;
    harness.tabs[1].discarded = false;
    await harness.events.tabUpdated.emit(2, { discarded: false }, clone(harness.tabs[1]));
    await settle(harness);

    harness.clock.now += 2 * 60 * 1000;
    const secondInactiveSince = harness.clock.now;
    await harness.events.tabActivated.emit({ tabId: 1, windowId: 1 });
    await settle(harness);
    harness.tabs[0].active = true;
    harness.tabs[1].active = false;

    assert.deepEqual(harness.storage.session.tabInactiveSince, { 2: secondInactiveSince });
    assert.equal(
        harness.alarms[harness.api.alarmName].scheduledTime,
        secondInactiveSince + 30 * 60 * 1000
    );

    harness.clock.now += 30 * 60 * 1000;
    await harness.events.alarm.emit({ name: harness.api.alarmName });
    await settle(harness);

    assert.equal(harness.tabs[1].discarded, true);
    assert.equal(harness.calls.filter(call => call === 'discard:2').length, 2);
    assert.deepEqual(harness.storage.session.tabInactiveSince, {});
});

test('a background wake uses the update event snapshot to restart inactivity', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, windowId: 1, url: 'https://active.example', active: true, discarded: false },
            { id: 2, windowId: 1, url: 'https://idle.example', active: false, discarded: true }
        ]
    });
    await settle(harness);
    assert.equal(Object.keys(await harness.api.getInactiveSinceMap()).length, 0);

    const wokenSnapshot = { ...clone(harness.tabs[1]), discarded: false };
    await harness.events.tabUpdated.emit(2, { discarded: false }, wokenSnapshot);
    await settle(harness);

    assert.deepEqual(harness.storage.session.tabInactiveSince, { 2: harness.clock.now });
    assert.equal(
        harness.alarms[harness.api.alarmName].scheduledTime,
        harness.clock.now + 30 * 60 * 1000
    );
});

test('a discard with no effect stays scheduled for retry', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, url: 'https://active.example', active: true, discarded: false },
            { id: 2, url: 'https://idle.example', active: false, discarded: false }
        ],
        discardNoEffect: true
    });
    await settle(harness);
    const inactiveSince = harness.storage.session.tabInactiveSince[2];

    harness.clock.now += 30 * 60 * 1000;
    await harness.events.alarm.emit({ name: harness.api.alarmName });
    await settle(harness);

    assert.equal(harness.tabs[1].discarded, false);
    assert.equal(harness.storage.session.tabInactiveSince[2], inactiveSince);
    assert.equal(
        harness.alarms[harness.api.alarmName].scheduledTime,
        harness.clock.now + 30 * 1000
    );
    assert.ok(harness.calls.indexOf('mark:2') < harness.calls.indexOf('unmark:2'));
});

test('title guard restores the sleep marker after a page rewrites its title', async () => {
    const harness = createHarness();
    await settle(harness);

    let title = 'Inbox';
    let observerCallback = null;
    harness.context.document = {
        documentElement: {},
        get title() {
            return title;
        },
        set title(value) {
            title = value;
        }
    };
    harness.context.MutationObserver = class {
        constructor(callback) {
            observerCallback = callback;
        }
        observe() {}
        disconnect() {}
    };

    const marked = await harness.api.holdDiscardedTitleMarker(
        '💤 ',
        'Inbox',
        150,
        1200,
        '__testTitleGuard'
    );

    assert.equal(marked, true);
    assert.equal(title, '💤 Inbox');

    title = 'Inbox updated';
    observerCallback();
    assert.equal(title, '💤 Inbox updated');

    harness.api.clearDiscardedTitleMarker('💤 ', '__testTitleGuard');
    assert.equal(title, 'Inbox updated');
});

test('failed discard removes the temporary sleep marker', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, url: 'https://active.example', title: 'Active', active: true, discarded: false },
            { id: 2, url: 'https://idle.example', title: 'Idle', active: false, discarded: false }
        ],
        discardError: 'Discard rejected'
    });
    await settle(harness);

    const response = await harness.api.handleMessage({ type: 'SUSPEND_TAB', tabId: 2 });

    assert.equal(response.success, false);
    assert.equal(harness.tabs[1].discarded, false);
    assert.ok(harness.calls.indexOf('mark:2') < harness.calls.indexOf('unmark:2'));
});

test('shorter timeout uses the existing inactivity timestamp', async () => {
    const harness = createHarness({
        tabs: [
            { id: 1, url: 'https://active.example', active: true, discarded: false },
            { id: 2, url: 'https://idle.example', active: false, discarded: false }
        ]
    });
    await settle(harness);

    harness.clock.now += 20 * 60 * 1000;
    await harness.api.handleMessage({
        type: 'SAVE_SETTINGS',
        settings: { suspensionTimeout: 15, whitelistedDomains: [] }
    });
    await settle(harness);

    assert.equal(harness.tabs[1].discarded, true);
});
