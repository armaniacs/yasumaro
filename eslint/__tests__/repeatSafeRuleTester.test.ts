/**
 * Regression test for the shared `--repeats` mechanism in repeatSafeRuleTester.
 *
 * `vitest --repeats` only re-runs the `it` body, so a normal run cannot observe
 * what happens on the second repetition. This test drives the iteration rebuild
 * directly: two consecutive rebuilds must yield different case bodies, and
 * running every case of both rebuilds must not raise
 * "detected duplicate test case". If the rebuild ever stops re-executing the
 * `describe` tree, the second pass below reuses the first pass's registry and
 * fails here instead of only under `--repeats`.
 */
import { describe, expect, it } from 'vitest';
import type { Rule } from 'eslint';
import { createRepeatSafeRuleTester, rebuildRuleCaseBodiesForIteration } from './repeatSafeRuleTester.js';

const sentinelRule: Rule.RuleDefinition = {
    meta: {
        type: 'problem',
        messages: { reported: 'the sentinel rule reported this call' },
        schema: [],
    },
    create: (context) => ({
        CallExpression(node) {
            context.report({ node, messageId: 'reported' });
        },
    }),
};

const ruleTester = createRepeatSafeRuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('sentinel', sentinelRule, {
    valid: [{ name: 'a declaration is not a call', code: 'const value = 1;' }],
    invalid: [
        {
            name: 'a bare call is reported',
            code: 'doThing();',
            errors: [{ messageId: 'reported' }],
        },
        {
            name: 'a call inside a function is reported too',
            code: 'function run() { doThing(); }',
            errors: [{ messageId: 'reported' }],
        },
    ],
});

describe('repeatSafeRuleTester', () => {
    it('registers one body per case and rebuilds a different one each iteration', () => {
        const first = rebuildRuleCaseBodiesForIteration();
        expect(first).toHaveLength(3);

        const second = rebuildRuleCaseBodiesForIteration();
        expect(second).toHaveLength(3);
        expect(second.some((body, index) => body === first[index])).toBe(false);
    });

    it('runs every case of two consecutive iterations without a duplicate-case failure', () => {
        // Running the bodies in registration order is what RuleTester itself
        // does inside one iteration; a registry shared between the two
        // iterations makes the second round throw on its first case.
        for (const round of ['first', 'second']) {
            const bodies = rebuildRuleCaseBodiesForIteration();
            expect(bodies, round).toHaveLength(3);
            for (const body of bodies) body();
        }
    });
});
