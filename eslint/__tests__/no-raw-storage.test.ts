/**
 * RuleTester tests for no-raw-storage (PBI 2026-11-07-02).
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+), built through
 * createRepeatSafeRuleTester so the cases also pass `vitest --repeats`.
 */
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import noRawStorage from '../rules/no-raw-storage.mjs';

const ruleTester = createRepeatSafeRuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

const SESSION_STORE_ALLOW = [
    {
        allow: [
            {
                file: 'src/background/sessionStore.ts',
                reason: 'Session persistence infra, not settings.',
            },
        ],
    },
];

ruleTester.run('no-raw-storage', noRawStorage, {
    valid: [
        {
            name: 'SSOT seam file passes by construction (SettingsRepository)',
            filename: '/repo/src/utils/storage/SettingsRepository.ts',
            code: 'const result = await chrome.storage.local.get("settings");',
        },
        {
            name: 'SSOT seam file passes by construction (ChromeStoragePort)',
            filename: '/repo/src/utils/storage/storagePort.ts',
            code: 'await chrome.storage.local.set(items);',
        },
        {
            name: 'port factory passing the area object is not a raw call',
            filename: '/repo/src/utils/ports.ts',
            code: 'function area() { return chromeStorageAreaAdapter(chrome.storage.local); }',
        },
        {
            name: 'allowlisted file passes with a reason',
            filename: '/repo/src/background/sessionStore.ts',
            options: SESSION_STORE_ALLOW,
            code: 'const all = await chrome.storage.local.get(null);',
        },
        {
            name: 'SettingsRepository singleton reads are not raw storage',
            filename: '/repo/src/background/someFeature.ts',
            code: 'const settings = await settingsRepository.getAll();',
        },
        {
            name: 'injected StoragePort reads are not raw storage',
            filename: '/repo/src/background/someFeature.ts',
            code: 'const result = await this.port.get(key);',
        },
        {
            name: 'a locally shadowed chrome binding is not the global',
            filename: '/repo/src/background/someFeature.ts',
            code: 'function f(chrome) { return chrome.storage.local.get(key); }',
        },
        {
            name: 'referencing the method without calling it is not use',
            filename: '/repo/src/background/someFeature.ts',
            code: 'expect(chrome.storage.local.get).toHaveBeenCalledWith(key);',
        },
        {
            name: 'comments mentioning the API are not use',
            filename: '/repo/src/background/someFeature.ts',
            code: '// never through a raw chrome.storage.local.set call\nconst x = 1;',
        },
        {
            name: 'other storage areas are out of scope',
            filename: '/repo/src/background/someFeature.ts',
            code: 'const s = await chrome.storage.session.get(key);',
        },
        {
            name: 'non-data methods on the area are out of scope',
            filename: '/repo/src/background/someFeature.ts',
            code: 'await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });',
        },
    ],
    invalid: [
        {
            name: 'raw get in an unlisted file fails',
            filename: '/repo/src/background/newFeature.ts',
            code: 'const result = await chrome.storage.local.get(key);',
            errors: [{ messageId: 'rawStorage', data: { method: 'get' } }],
        },
        {
            name: 'raw set in an unlisted file fails',
            filename: '/repo/src/background/newFeature.ts',
            code: 'await chrome.storage.local.set({ [key]: value });',
            errors: [{ messageId: 'rawStorage', data: { method: 'set' } }],
        },
        {
            name: 'raw remove in an unlisted file fails',
            filename: '/repo/src/background/newFeature.ts',
            code: 'await chrome.storage.local.remove(key);',
            errors: [{ messageId: 'rawStorage', data: { method: 'remove' } }],
        },
        {
            name: 'raw clear in an unlisted file fails',
            filename: '/repo/src/background/newFeature.ts',
            code: 'await chrome.storage.local.clear();',
            errors: [{ messageId: 'rawStorage', data: { method: 'clear' } }],
        },
        {
            name: 'raw getBytesInUse in an unlisted file fails',
            filename: '/repo/src/dashboard/newPanel.ts',
            code: 'const bytes = await chrome.storage.local.getBytesInUse(null);',
            errors: [{ messageId: 'rawStorage', data: { method: 'getBytesInUse' } }],
        },
        {
            name: 'fire-and-forget set with .catch still reports the inner set',
            filename: '/repo/src/background/newFeature.ts',
            code: 'chrome.storage.local.set(items).catch((e) => log(e));',
            errors: [{ messageId: 'rawStorage', data: { method: 'set' } }],
        },
        {
            name: 'optional-chained access is still a raw call',
            filename: '/repo/src/background/newFeature.ts',
            code: 'const result = await chrome.storage.local?.get(key);',
            errors: [{ messageId: 'rawStorage', data: { method: 'get' } }],
        },
        {
            name: 'allowlist does not leak to other files',
            filename: '/repo/src/background/newFeature.ts',
            options: SESSION_STORE_ALLOW,
            code: 'const result = await chrome.storage.local.get(key);',
            errors: [{ messageId: 'rawStorage', data: { method: 'get' } }],
        },
        {
            name: 'each raw call in one file reports separately',
            filename: '/repo/src/background/newFeature.ts',
            code: 'const r = await chrome.storage.local.get(a);\nawait chrome.storage.local.set({ [a]: 1 });',
            errors: [
                { messageId: 'rawStorage', data: { method: 'get' } },
                { messageId: 'rawStorage', data: { method: 'set' } },
            ],
        },
    ],
});
