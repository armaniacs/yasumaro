/**
 * RuleTester tests for no-greedy-fake-timers
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+).
 */
import { RuleTester } from 'eslint';
import noGreedyFakeTimers from '../rules/no-greedy-fake-timers.mjs';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-greedy-fake-timers', noGreedyFakeTimers, {
    valid: [
        {
            name: 'the narrow fake set useTimerClock() installs',
            code: "vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });",
        },
        {
            name: 'an explicit toFake that stops short of the hungry timers',
            code: "vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });",
        },
        {
            name: 'useRealTimers is not a fake clock',
            code: 'vi.useRealTimers();',
        },
        {
            name: 'another object’s useFakeTimers is not vi’s',
            code: "clock.useFakeTimers({ toFake: ['setImmediate'] });",
        },
        {
            name: 'an empty toFake is explicit, so it is the caller’s choice',
            code: 'vi.useFakeTimers({ toFake: [] });',
        },
    ],
    invalid: [
        {
            name: 'default vi.useFakeTimers()',
            code: "beforeEach(() => { vi.useFakeTimers(); });",
            errors: [{ messageId: 'greedyFakeTimers' }],
        },
        {
            name: 'vi.useFakeTimers() with no arguments, next to a dynamic import',
            code: 'vi.useFakeTimers();\nawait importUnderTest();',
            errors: [{ messageId: 'greedyFakeTimers' }],
        },
        {
            name: 'toFake that includes setImmediate',
            code: "vi.useFakeTimers({ toFake: ['setTimeout', 'setImmediate', 'Date'] });",
            errors: [{ messageId: 'greedyFakeTimersMember', data: { names: 'setImmediate' } }],
        },
        {
            name: 'toFake that includes queueMicrotask',
            code: "vi.useFakeTimers({ toFake: ['setTimeout', 'queueMicrotask'] });",
            errors: [{ messageId: 'greedyFakeTimersMember', data: { names: 'queueMicrotask' } }],
        },
        {
            name: 'both hungry timers are named together',
            code: "vi.useFakeTimers({ toFake: ['setTimeout', 'setImmediate', 'queueMicrotask', 'Date'] });",
            errors: [{ messageId: 'greedyFakeTimersMember', data: { names: 'setImmediate/queueMicrotask' } }],
        },
    ],
});
