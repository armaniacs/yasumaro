/**
 * RuleTester tests for no-dead-test-skip
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+), built through
 * createRepeatSafeRuleTester so the cases also pass `vitest --repeats`
 * (AGENTS.md の --repeats 規約. See ADR 2026-09-26).
 */
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import noDeadTestSkip from '../rules/no-dead-test-skip.mjs';

const ruleTester = createRepeatSafeRuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-dead-test-skip', noDeadTestSkip, {
    valid: [
        {
            // The runtime-conditional form: the skip is a real decision, not a
            // name on a dead body. (testDir/e2e/firefox-worker-smoke.spec.ts)
            name: 'a runtime condition with a reason is the supported use',
            code: "test.skip(testInfo.project.name !== 'firefox', 'firefox-only smoke (opfs-worker entry is firefox-only)');",
        },
        {
            name: 'a boolean literal condition is still runtime-conditional',
            code: 'test.skip(true, HEADLESS_FIXME_MESSAGE);',
        },
        {
            // testDir/e2e fixtures: the guard decides, not the test name.
            name: 'a skip inside an environment guard stays allowed',
            code: "if (!process.env.CI && !process.env.DISPLAY) {\n  test.skip(true, 'requires headed Chrome with display');\n}",
        },
        {
            // src/__tests__/wxt-build.test.ts — skipIf is a different method.
            name: 'describe.skipIf is a conditional API, not a declaration skip',
            code: "describe.skipIf(!distExists)('WXT Build Output', () => {});",
        },
        {
            // testDir/e2e/cleansing-preview-confirm.spec.ts — the single-string
            // Playwright runtime form marks the running test, it has no body.
            name: 'the single-string Playwright runtime form is allowed',
            code: "test.skip('requires headed Chrome with display');",
        },
        {
            name: 'a bare runtime test.skip() call is allowed',
            code: 'test.skip();',
        },
        {
            name: 'a non-test object with .skip() is not this rule’s business',
            code: 'stream.skip(2);',
        },
        {
            // src/__tests__/manifest.test.ts (pre-2026-10-12-03 shape): a
            // property reference, not a call.
            name: 'describe.skip as a property reference is not reported',
            code: 'const describeFn = manifestExists ? describe : describe.skip;',
        },
        {
            // RuleTester registers the rule as `rule-to-test/<name>`, so the
            // directive has to spell that prefix to resolve here. In the repo
            // the same line reads `local/no-dead-test-skip`.
            name: 'a declaration-form skip with a reasoned opt-out is allowed',
            code: `// eslint-disable-next-line rule-to-test/no-dead-test-skip -- the contract is scheduled for removal with ADR-014
it.skip('keeps the legacy envelope', () => {});`,
        },
    ],
    invalid: [
        {
            // The exact shape NN01/NN02 removed (2026-10-12): a static name on
            // a permanently dead body.
            name: 'the declaration-form it.skip',
            code: "it.skip('saves the AI summary to Obsidian', async () => {});",
            errors: [{ messageId: 'deadTestSkip', data: { method: 'skip' } }],
        },
        {
            name: 'the declaration-form describe.skip',
            code: "describe.skip('エッジケース: 書き込み失敗時のURL整合性', () => {});",
            errors: [{ messageId: 'deadTestSkip', data: { method: 'skip' } }],
        },
        {
            // With two arguments this is the vitest declaration form, not the
            // single-string Playwright runtime form.
            name: 'a two-argument test.skip with a static name is a declaration',
            code: "test.skip('waits for the same-URL mutex', async () => {});",
            errors: [{ messageId: 'deadTestSkip', data: { method: 'skip' } }],
        },
        {
            name: 'the declaration-form test.fixme',
            code: "test.fixme('needs a proper extension context', () => {});",
            errors: [{ messageId: 'deadTestSkip', data: { method: 'fixme' } }],
        },
        {
            // The each-chained form resolves its name one link further down the
            // chain; the discriminator is the same (static name + a body).
            name: 'the each-chained declaration form is covered too',
            code: "it.skip.each([1, 2])('keeps consistency for parallel call %d', (n) => {});",
            errors: [{ messageId: 'deadTestSkip', data: { method: 'skip' } }],
        },
        {
            name: 'the Playwright suite declaration form is covered too',
            code: "test.describe.skip('headed-only suite', () => {});",
            errors: [{ messageId: 'deadTestSkip', data: { method: 'skip' } }],
        },
        {
            name: 'an expression-less template literal is a static name',
            code: 'it.skip(`keeps the legacy envelope`, () => {});',
            errors: [{ messageId: 'deadTestSkip', data: { method: 'skip' } }],
        },
    ],
});
