/**
 * RuleTester tests for no-test-sleep
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+).
 */
import { RuleTester } from 'eslint';
import noTestSleep from '../rules/no-test-sleep.mjs';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-test-sleep', noTestSleep, {
    valid: [
        {
            name: 'zero-delay macrotask drain (the drainMacrotask() spelling)',
            code: 'await new Promise((resolve) => setTimeout(resolve, 0));',
        },
        {
            name: 'sub-threshold delay',
            code: 'await new Promise((resolve) => setTimeout(resolve, 5));',
        },
        {
            name: 'const delay below the threshold',
            code: 'const DELAY_MS = 10;\nawait new Promise((r) => setTimeout(r, DELAY_MS));',
        },
        {
            name: 'unresolvable delay is left alone rather than guessed at',
            code: 'await new Promise((r) => setTimeout(r, getDelay()));',
        },
        {
            name: 'reassigned let is not treated as a constant',
            code: 'let DELAY_MS = 30;\nDELAY_MS = 60;\nawait new Promise((r) => setTimeout(r, DELAY_MS));',
        },
        {
            name: 'a parameter named like a const is not resolved',
            code: 'async function wait(DELAY_MS) {\n  await new Promise((r) => setTimeout(r, DELAY_MS));\n}',
        },
        {
            name: 'the fake-clock rule is not this rule’s business',
            code: "useTimerClock();\nawait vi.advanceTimersByTimeAsync(250);",
        },
    ],
    invalid: [
        {
            name: 'literal sleep above the threshold',
            code: 'await new Promise((resolve) => setTimeout(resolve, 50));',
            errors: [{ messageId: 'fixedSleep', data: { ms: 50 } }],
        },
        {
            name: 'exactly the threshold counts',
            code: 'await new Promise((resolve) => setTimeout(resolve, 20));',
            errors: [{ messageId: 'fixedSleep', data: { ms: 20 } }],
        },
        {
            name: 'const-bound delay is resolved to its literal',
            code: 'const DELAY_MS = 30;\nawait new Promise((r) => setTimeout(r, DELAY_MS));',
            errors: [{ messageId: 'fixedSleep', data: { ms: 30 } }],
        },
        {
            name: 'const-bound delay inside a test callback',
            code: 'it("x", async () => {\n  const DELAY_MS = 30;\n  await new Promise((r) => setTimeout(() => r(1), DELAY_MS));\n});',
            errors: [{ messageId: 'fixedSleep', data: { ms: 30 } }],
        },
        {
            name: 'const-bound delay inside a Promise factory, declared in the enclosing scope',
            code: 'const RETRY_MS = 250;\nawait new Promise((resolve) => {\n  setTimeout(resolve, RETRY_MS);\n});',
            errors: [{ messageId: 'fixedSleep', data: { ms: 250 } }],
        },
        {
            // Regression: the delay memo used to be keyed by identifier NAME, so
            // the first DELAY_MS resolved in the file stood in for every later
            // one and the 50ms below escaped the rule.
            name: 'two same-named consts in one file resolve independently',
            code: 'function shortWait() {\n  const D = 5;\n  return new Promise((r) => setTimeout(r, D));\n}\nfunction longWait() {\n  const D = 50;\n  return new Promise((r) => setTimeout(r, D));\n}',
            errors: [{ messageId: 'fixedSleep', data: { ms: 50 } }],
        },
        {
            name: 'the reverse order does not misreport the short sleep',
            code: 'function longWait() {\n  const D = 50;\n  return new Promise((r) => setTimeout(r, D));\n}\nfunction shortWait() {\n  const D = 5;\n  return new Promise((r) => setTimeout(r, D));\n}',
            errors: [{ messageId: 'fixedSleep', data: { ms: 50 } }],
        },
    ],
});
