/**
 * RuleTester tests for no-vacuous-negative-wait
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+).
 */
import { RuleTester } from 'eslint';
import noVacuousNegativeWait from '../rules/no-vacuous-negative-wait.mjs';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-vacuous-negative-wait', noVacuousNegativeWait, {
    valid: [
        {
            name: 'a positive wait is the supported use',
            code: 'await waitForMock(() => expect(mockSetAll).toHaveBeenCalled());',
        },
        {
            name: 'a positive assertion anchors the negative one',
            code: 'await vi.waitFor(() => {\n  expect(handler).toHaveBeenCalled();\n  expect(dialog).not.toHaveBeenCalled();\n});',
        },
        {
            // RuleTester registers the rule as `rule-to-test/<name>`, so the
            // directive has to spell that prefix to resolve here. In the repo
            // the same line reads `local/no-vacuous-negative-wait`.
            name: 'a change-detection wait, opted out on the line above the call',
            code: `// eslint-disable-next-line rule-to-test/no-vacuous-negative-wait -- waits for the ticker to overwrite the marker
await vi.waitFor(() => expect(el.textContent).not.toBe(marker));`,
        },
        {
            name: 'no expectation at all is not this rule’s business',
            code: 'await waitForMock(() => { if (!ready) throw new Error("not ready"); });',
        },
        {
            name: 'expect.soft on a positive matcher is positive',
            code: 'await vi.waitFor(() => expect.soft(el.textContent).toContain("done"));',
        },
        {
            name: 'a non-wait call with a negative assertion is fine',
            code: 'expect(mockSetAll).not.toHaveBeenCalled();',
        },
    ],
    invalid: [
        {
            name: 'the single-line waitForMock form',
            code: 'await waitForMock(() => expect(mockSetAll).not.toHaveBeenCalled());',
            errors: [{ messageId: 'vacuousNegativeWait', data: { count: 1 } }],
        },
        {
            name: 'the multi-line vi.waitFor form',
            code: 'await vi.waitFor(\n  () => expect(chrome.action.setBadgeText).not.toHaveBeenCalled(),\n  { interval: 1 }\n);',
            errors: [{ messageId: 'vacuousNegativeWait', data: { count: 1 } }],
        },
        {
            name: 'a block-bodied callback with only a negative',
            code: 'await waitForMock(() => {\n  expect(mockSetAll).not.toHaveBeenCalled();\n});',
            errors: [{ messageId: 'vacuousNegativeWait', data: { count: 1 } }],
        },
        {
            name: 'two negative assertions are still no anchor',
            code: 'await waitForMock(() => {\n  expect(mockSetAll).not.toHaveBeenCalled();\n  expect(dialog).not.toHaveBeenCalled();\n});',
            errors: [{ messageId: 'vacuousNegativeWait', data: { count: 2 } }],
        },
        {
            name: 'not.toBeNull counts as negative too',
            code: 'await waitForMock(() => expect(document.getElementById("x")).not.toBeNull());',
            errors: [{ messageId: 'vacuousNegativeWait', data: { count: 1 } }],
        },
        {
            name: 'a bare imported waitFor is covered too',
            code: 'await waitFor(() => expect(mockSetAll).not.toHaveBeenCalled());',
            errors: [{ messageId: 'vacuousNegativeWait', data: { count: 1 } }],
        },
        {
            name: 'the arrow body is the expect chain itself',
            code: 'await waitForMock(() => expect(mock).not.toHaveBeenCalledWith("x"));',
            errors: [{ messageId: 'vacuousNegativeWait', data: { count: 1 } }],
        },
    ],
});
