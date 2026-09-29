/**
 * RuleTester tests for no-manual-protocol-version
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+), built through
 * createRepeatSafeRuleTester so the cases also pass `vitest --repeats`.
 */
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import noManualProtocolVersion from '../rules/no-manual-protocol-version.mjs';

const ruleTester = createRepeatSafeRuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-manual-protocol-version', noManualProtocolVersion, {
    valid: [
        {
            name: 'seam send without a version stamp',
            code: 'messageTransport.send({ type: "PING" });',
        },
        {
            name: 'non-sendMessage calls with a protocolVersion key are not senders',
            code: 'store.save({ type: "X", protocolVersion: 1 });',
        },
        {
            name: 'variable envelopes are left alone rather than guessed at',
            code: 'chrome.runtime.sendMessage(envelope);',
        },
    ],
    invalid: [
        {
            name: 'hand-stamped protocolVersion in a runtime send',
            code: 'chrome.runtime.sendMessage({ type: "PING", protocolVersion: 1 });',
            errors: [{ messageId: 'noManualVersion' }],
        },
        {
            name: 'string-literal key spelling is also caught',
            code: 'chrome.runtime.sendMessage({ type: "PING", "protocolVersion": 1 });',
            errors: [{ messageId: 'noManualVersion' }],
        },
    ],
});
