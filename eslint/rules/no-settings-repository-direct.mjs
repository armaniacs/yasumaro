/**
 * ESLint rule: no-settings-repository-direct
 *
 * Port of the eslint.config.js `no-restricted-syntax` ban on
 * `NewExpression[callee.name='SettingsRepository']`: direct instantiation is
 * forbidden; use the settingsRepository singleton or an injected SettingsReader.
 *
 * oxlint has no native no-restricted-syntax, so the one selector this repo relied
 * on becomes a local rule. Kept syntactic (callee name match) like the original.
 * The seam/test/DI exclusions live in the oxlint override's `excludeFiles`
 * (gen-oxlintrc.mjs), mirroring the eslint block's `ignores`.
 */
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      noDirectInstantiation:
        'Do not instantiate SettingsRepository directly. Use the settingsRepository singleton or an injected SettingsReader.',
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee && node.callee.type === 'Identifier' && node.callee.name === 'SettingsRepository') {
          context.report({ node, messageId: 'noDirectInstantiation' });
        }
      },
    };
  },
};
