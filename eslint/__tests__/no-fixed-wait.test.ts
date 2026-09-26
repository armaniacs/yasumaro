/**
 * RuleTester tests for no-fixed-wait
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+).
 */
import { RuleTester } from 'eslint';
import noFixedWait from '../rules/no-fixed-wait.mjs';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-fixed-wait', noFixedWait, {
    valid: [
        {
            name: 'the condition-based Playwright waits are the point of the rule',
            code: 'await page.waitForLoadState(\'load\');',
        },
        {
            name: 'waitForSelector is condition-based',
            code: 'await page.waitForSelector(\'#ready\');',
        },
        {
            name: 'waitForFunction names the condition it waits for',
            code: 'await page.waitForFunction(() => window.readyFlag === true);',
        },
        {
            name: 'a locator assertion carries its own retry',
            code: 'await expect(locator).toBeVisible();',
        },
        {
            name: 'expect.poll is the condition-wait spelling',
            code: 'await expect.poll(() => readState()).toBe(true);',
        },
        {
            name: 'waitForEvent waits for something to happen',
            code: 'await page.waitForEvent(\'response\');',
        },
        {
            // RuleTester registers the rule as `rule-to-test/<name>`, so the
            // directive has to spell that prefix to resolve here. In the repo
            // the same line reads `local/no-fixed-wait`.
            name: 'a measurement window, opted out on the line above the call',
            code: `// eslint-disable-next-line rule-to-test/no-fixed-wait -- long task entries are delivered asynchronously, the window is part of the measurement
            await page.waitForTimeout(2_000);`,
        },
        {
            name: 'a raw timer sleep belongs to no-test-sleep, not this rule',
            code: 'await new Promise((resolve) => setTimeout(resolve, 50));',
        },
        {
            name: 'a bare identifier call is not a Playwright method call',
            code: 'await waitForTimeout(500);',
        },
        {
            name: 'a dynamic computed key is not guessed at',
            code: 'await page[methodName](500);',
        },
        {
            name: 'a computed key that is not a string literal is ignored',
            code: 'const key = 1;\nawait page[key](500);',
        },
    ],
    invalid: [
        {
            name: 'the page-level spelling',
            code: 'await page.waitForTimeout(500);',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'a locator-level spelling',
            code: 'await locator.waitForTimeout(200);',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'a frame-level spelling with a numeric separator',
            code: 'await page.mainFrame().waitForTimeout(6_000);',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'the computed spelling names the same API',
            code: "await page['waitForTimeout'](500);",
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'the optional-call spelling',
            code: 'await page.waitForTimeout?.(500);',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'no argument is still a fixed wait (a sub-zero one)',
            code: 'await page.waitForTimeout();',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'the call is reported without being awaited',
            code: 'page.waitForTimeout(50);',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'a const-bound duration is reported like any other',
            code: 'const SETTLE_MS = 2_000;\nawait page.waitForTimeout(SETTLE_MS);',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'inside a test callback',
            code: 'test("x", async ({ page }) => {\n  await page.waitForTimeout(500);\n});',
            errors: [{ messageId: 'fixedWait' }],
        },
        {
            name: 'two fixed waits in one snippet are both reported',
            code: 'await page.waitForTimeout(500);\nawait page.locator(\'#a\').waitForTimeout(200);',
            errors: [{ messageId: 'fixedWait' }, { messageId: 'fixedWait' }],
        },
    ],
});
