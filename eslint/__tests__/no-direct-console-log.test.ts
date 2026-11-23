/**
 * RuleTester tests for no-direct-console-log (PBI 2026-11-11-03).
 *
 * Direct `console.*` calls outside the logger seam must fail; the seam
 * itself (src/utils/logger/**) passes by construction and pre-existing
 * call sites pass only through a reasoned `allow` entry (grandfather台帳).
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+), built through
 * createRepeatSafeRuleTester so the cases also pass `vitest --repeats`.
 */
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import noDirectConsoleLog from '../rules/no-direct-console-log.mjs';

const ruleTester = createRepeatSafeRuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

const BENCH_ALLOW = [
    {
        allow: [
            {
                file: 'src/wasm/textrank/bench.ts',
                reason: 'CLI bench tooling: stdout reporting, not product logging.',
            },
        ],
    },
];

ruleTester.run('no-direct-console-log', noDirectConsoleLog, {
    valid: [
        {
            name: 'logger seam file passes by construction (api)',
            filename: '/repo/src/utils/logger/api.ts',
            code: "console.error('Logger: Failed to write structured log', e);",
        },
        {
            name: 'logger seam file passes by construction (core)',
            filename: '/repo/src/utils/logger/core.ts',
            code: "console.error('Logger: Failed to save log', e);",
        },
        {
            name: 'allowlisted file passes with a reason',
            filename: '/repo/src/wasm/textrank/bench.ts',
            options: BENCH_ALLOW,
            code: 'console.log(`${label}: ${duration} ms/op`);',
        },
        {
            name: 'a locally shadowed console binding is not the global',
            filename: '/repo/src/utils/someFeature.ts',
            code: 'function f(console) { console.log(key); }',
        },
        {
            name: 'referencing the method without calling it is not use',
            filename: '/repo/src/utils/someFeature.ts',
            code: 'expect(console.warn).toHaveBeenCalledWith(key);',
        },
        {
            name: 'spying on console is not a log emission',
            filename: '/repo/src/utils/someFeature.ts',
            code: "vi.spyOn(console, 'warn').mockImplementation(() => {});",
        },
        {
            name: 'comments mentioning console are not use',
            filename: '/repo/src/utils/someFeature.ts',
            code: '// never through a raw console.warn call\nconst x = 1;',
        },
        {
            name: 'other objects with log methods are out of scope',
            filename: '/repo/src/utils/someFeature.ts',
            code: 'logger.log(message);',
        },
    ],
    invalid: [
        {
            name: 'raw console.warn in an unlisted file fails',
            filename: '/repo/src/utils/newFeature.ts',
            code: "console.warn('wasm unavailable', detail);",
            errors: [{ messageId: 'directConsole', data: { method: 'warn' } }],
        },
        {
            name: 'raw console.error in an unlisted file fails',
            filename: '/repo/src/dashboard/newPanel.ts',
            code: "console.error('[BugReport] failed', err);",
            errors: [{ messageId: 'directConsole', data: { method: 'error' } }],
        },
        {
            name: 'raw console.log in an unlisted file fails',
            filename: '/repo/src/utils/newFeature.ts',
            code: 'console.log(message);',
            errors: [{ messageId: 'directConsole', data: { method: 'log' } }],
        },
        {
            name: 'raw console.debug in an unlisted file fails',
            filename: '/repo/src/utils/newFeature.ts',
            code: 'console.debug(message);',
            errors: [{ messageId: 'directConsole', data: { method: 'debug' } }],
        },
        {
            name: 'promise-catch shorthand still reports the callback reference',
            filename: '/repo/src/privacy/privacy.ts',
            code: 'loadPrivacyPolicy().catch(console.error);',
            errors: [{ messageId: 'directConsoleRef', data: { method: 'error' } }],
        },
        {
            name: 'optional-chained access is still a direct call',
            filename: '/repo/src/utils/newFeature.ts',
            code: 'console?.warn(message);',
            errors: [{ messageId: 'directConsole', data: { method: 'warn' } }],
        },
        {
            name: 'allowlist does not leak to other files',
            filename: '/repo/src/utils/newFeature.ts',
            options: BENCH_ALLOW,
            code: 'console.log(message);',
            errors: [{ messageId: 'directConsole', data: { method: 'log' } }],
        },
        {
            name: 'each direct call in one file reports separately',
            filename: '/repo/src/utils/newFeature.ts',
            code: "console.warn(a);\nconsole.error(b);",
            errors: [
                { messageId: 'directConsole', data: { method: 'warn' } },
                { messageId: 'directConsole', data: { method: 'error' } },
            ],
        },
    ],
});
