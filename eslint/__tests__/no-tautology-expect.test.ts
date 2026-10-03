/**
 * RuleTester tests for no-tautology-expect
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+), built through
 * createRepeatSafeRuleTester so the cases also pass `vitest --repeats`.
 */
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import noTautologyExpect from '../rules/no-tautology-expect.mjs';

const ruleTester = createRepeatSafeRuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-tautology-expect', noTautologyExpect, {
    valid: [
        {
            name: 'an identifier against a different literal is a real assertion',
            code: 'expect(result).toBe(true);',
        },
        {
            name: 'two different identifiers can differ at runtime',
            code: 'expect(value).toBe(otherValue);',
        },
        {
            name: 'a member chain against a literal',
            code: 'expect(user.name).toEqual("Alice");',
        },
        {
            name: 'an identifier against a numeric literal',
            code: 'expect(count).toBe(0);',
        },
        {
            name: 'two different member chains are not the same read',
            code: 'expect(state.count).toBe(prevState.count);',
        },
        {
            name: 'a negative matcher over different values',
            code: 'expect(actual).not.toBe(expected);',
        },
        {
            name: 'non-comparison matchers are not this rule’s business',
            code: 'expect(mockSave).toHaveBeenCalled();',
        },
        {
            name: 'a call expression on either side is out of scope',
            code: 'expect(fetchUser()).toBe(fetchUser());',
        },
        {
            name: 'arithmetic is not a pure member chain',
            code: 'expect(a + b).toBe(a + b);',
        },
        {
            name: 'a computed key that is not a string literal is not guessed at',
            code: 'expect(container[key]).toBe(container[key]);',
        },
        {
            name: 'array literals are not primitive literals',
            code: 'expect([]).toEqual([]);',
        },
        {
            name: 'object literals are out of scope',
            code: 'expect({ id: 1 }).toEqual({ id: 1 });',
        },
        {
            name: 'expect.soft is not resolved back to expect',
            code: 'expect.soft(value).toBe(value);',
        },
        {
            name: 'a non-expect assertion target is ignored',
            code: 'assert(value).toBe(value);',
        },
    ],
    invalid: [
        {
            name: 'the boolean-literal spelling',
            code: 'expect(true).toBe(true);',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'the identifier spelling',
            code: 'expect(value).toBe(value);',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'the member-chain spelling',
            code: 'expect(user.name).toBe(user.name);',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'a deeper chain with toEqual',
            code: 'expect(a.b.c).toEqual(a.b.c);',
            errors: [{ messageId: 'tautological', data: { method: 'toEqual' } }],
        },
        {
            name: 'a numeric literal with toEqual',
            code: 'expect(1).toEqual(1);',
            errors: [{ messageId: 'tautological', data: { method: 'toEqual' } }],
        },
        {
            name: 'a string literal with toStrictEqual',
            code: 'expect("done").toStrictEqual("done");',
            errors: [{ messageId: 'tautological', data: { method: 'toStrictEqual' } }],
        },
        {
            name: 'the nonstandard alias is covered too',
            code: 'expect(value).toBeStrictEqual(value);',
            errors: [{ messageId: 'tautological', data: { method: 'toBeStrictEqual' } }],
        },
        {
            name: 'the null-literal spelling',
            code: 'expect(null).toBe(null);',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'a negative matcher over the same value is still tautological',
            code: 'expect(el.textContent).not.toBe(el.textContent);',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'the resolves wrapper resolves back to expect',
            code: 'expect(promise).resolves.toBe(promise);',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'a computed string-literal key is still a pure chain',
            code: 'expect(config["retries"]).toBe(config["retries"]);',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'inside a test callback',
            code: 'test("x", () => {\n  expect(result).toBe(result);\n});',
            errors: [{ messageId: 'tautological', data: { method: 'toBe' } }],
        },
        {
            name: 'two tautologies in one snippet are both reported',
            code: 'expect(true).toBe(true);\nexpect(x).toBe(x);',
            errors: [
                { messageId: 'tautological', data: { method: 'toBe' } },
                { messageId: 'tautological', data: { method: 'toBe' } },
            ],
        },
    ],
});
