const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const settingsSource = fs.readFileSync(
    path.join(__dirname, '..', 'settings.js'),
    'utf8'
);

function createElement(overrides = {}) {
    const listeners = {};
    const classes = new Set();
    return {
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        dataset: {},
        classList: {
            add: value => classes.add(value),
            remove: value => classes.delete(value),
            toggle(value, force) {
                if (force === undefined ? !classes.has(value) : force) classes.add(value);
                else classes.delete(value);
            },
            contains: value => classes.has(value)
        },
        addEventListener(type, listener) {
            listeners[type] = listener;
        },
        async emit(type, event = {}) {
            return listeners[type]?.(event);
        },
        querySelectorAll() {
            return [];
        },
        ...overrides
    };
}

test('profile buttons and custom slider save the displayed timeout', async () => {
    const savedSettings = [];
    let domReady;

    const profileButtons = [
        createElement({ dataset: { profile: 'relaxed', timeout: '60' } }),
        createElement({ dataset: { profile: 'balanced', timeout: '30' } }),
        createElement({ dataset: { profile: 'aggressive', timeout: '15' } })
    ];
    const profileSelector = createElement({
        querySelectorAll: () => profileButtons
    });
    const timeoutSlider = createElement({ value: '30' });

    const elements = new Map();
    const ids = [
        'backBtn', 'exportBtn', 'importBtn', 'importFile', 'profileStatus',
        'customTimingSection', 'customTimingSlider', 'timeoutValue',
        'addCurrentSiteBtn', 'whitelistItems', 'newDomain', 'addDomainBtn',
        'impactValue', 'impactRank', 'viewStatsBtn', 'toast', 'toastMessage'
    ];
    for (const id of ids) elements.set(id, createElement());
    elements.set('profileSelector', profileSelector);
    elements.set('timeout', timeoutSlider);

    const document = {
        getElementById: id => elements.get(id) || null,
        addEventListener(type, listener) {
            if (type === 'DOMContentLoaded') domReady = listener;
        },
        querySelector() {
            return null;
        },
        createElement() {
            return createElement();
        }
    };

    const chrome = {
        runtime: {
            async sendMessage(message) {
                if (message.type === 'GET_SETTINGS') {
                    return { settings: { suspensionTimeout: 30, whitelistedDomains: [] } };
                }
                if (message.type === 'GET_STATS') {
                    return { totalSaved: 0, lifetimeTabsSuspended: 0 };
                }
                if (message.type === 'SAVE_SETTINGS') {
                    savedSettings.push(message.settings);
                    return { success: true };
                }
                return { success: true };
            },
            getURL: value => value
        },
        tabs: {
            async query() {
                return [];
            },
            async create() {}
        }
    };

    vm.runInNewContext(settingsSource, {
        chrome,
        document,
        window: { close() {}, addEventListener() {} },
        console: { error() {}, warn() {}, log() {} },
        setTimeout(callback) {
            callback();
            return 0;
        },
        clearTimeout() {},
        Blob,
        URL
    }, { filename: 'settings.js' });

    await domReady();

    await profileSelector.emit('click', {
        target: { closest: () => profileButtons[2] }
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(timeoutSlider.value, 15);
    assert.equal(savedSettings.at(-1).suspensionTimeout, 15);
    assert.match(elements.get('profileStatus').innerHTML, /15 minutes/);

    timeoutSlider.value = '42';
    await timeoutSlider.emit('input');
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(savedSettings.at(-1).suspensionTimeout, 42);
    assert.match(elements.get('profileStatus').innerHTML, /42 minutes/);
    assert.ok(profileButtons.every(button => !button.classList.contains('active')));
});
