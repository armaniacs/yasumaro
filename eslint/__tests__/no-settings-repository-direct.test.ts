/**
 * RuleTester tests for no-settings-repository-direct
 *
 * Port of the eslint.config.js no-restricted-syntax ban on
 * `NewExpression[callee.name='SettingsRepository']`. Uses ESLint's RuleTester
 * with the flat config API, built through createRepeatSafeRuleTester so the
 * cases also pass `vitest --repeats`.
 */
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import noSettingsRepositoryDirect from '../rules/no-settings-repository-direct.mjs';

const ruleTester = createRepeatSafeRuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('no-settings-repository-direct', noSettingsRepositoryDirect, {
    valid: [
        {
            name: 'the settingsRepository singleton is the intended path',
            code: 'settingsRepository.read();',
        },
        {
            name: 'an injected SettingsReader is allowed',
            code: 'new SettingsReader();',
        },
        {
            name: 'a differently named repository is out of scope',
            code: 'new OtherRepository();',
        },
        {
            name: 'a factory call is not a new-expression',
            code: 'createSettingsRepository();',
        },
        {
            name: 'a member-callee new-expression is not a direct identifier instantiation',
            code: 'new factories.SettingsRepository();',
        },
        {
            name: 'an instanceof check is not an instantiation',
            code: 'if (repo instanceof SettingsRepository) { use(repo); }',
        },
    ],
    invalid: [
        {
            name: 'direct instantiation is reported',
            code: 'new SettingsRepository();',
            errors: [{ messageId: 'noDirectInstantiation' }],
        },
        {
            name: 'direct instantiation assigned to a binding is reported',
            code: 'const repo = new SettingsRepository();',
            errors: [{ messageId: 'noDirectInstantiation' }],
        },
        {
            name: 'direct instantiation inside a function is reported',
            code: 'function make() {\n  return new SettingsRepository();\n}',
            errors: [{ messageId: 'noDirectInstantiation' }],
        },
        {
            name: 'each direct instantiation is reported',
            code: 'const a = new SettingsRepository();\nconst b = new SettingsRepository();',
            errors: [
                { messageId: 'noDirectInstantiation' },
                { messageId: 'noDirectInstantiation' },
            ],
        },
    ],
});
