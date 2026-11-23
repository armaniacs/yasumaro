/**
 * oxlint JS plugin wrapper around the existing local rules.
 *
 * oxlint's JS plugin API is ESLint v9 compatible, so the rule modules under
 * eslint/rules/*.mjs are loaded unchanged: each is an object with `meta` +
 * `create`, exactly the shape oxlint expects. This file only supplies the
 * top-level `meta.name` (oxlint derives the rule namespace from it) and maps
 * the rule ids.
 *
 * While the ESLint config is still the source of truth, this wrapper exists so
 * `oxlint` can run the same 13 rules as a parity check. Once the migration
 * lands, eslint/rules/ is removed and the rules move under an oxlint-owned
 * directory; this file is the seam that makes that move a path change.
 */
import requireSanitizedMarkdown from './rules/require-sanitized-markdown.mjs';
import requireResponseSizeLimit from './rules/require-response-size-limit.mjs';
import noTautologyExpect from './rules/no-tautology-expect.mjs';
import noGreedyFakeTimers from './rules/no-greedy-fake-timers.mjs';
import noTestSleep from './rules/no-test-sleep.mjs';
import noFixedWait from './rules/no-fixed-wait.mjs';
import noVacuousNegativeWait from './rules/no-vacuous-negative-wait.mjs';
import noManualProtocolVersion from './rules/no-manual-protocol-version.mjs';
import utilsLayerBoundary from './rules/utils-layer-boundary.mjs';
import noDeadTestSkip from './rules/no-dead-test-skip.mjs';
import noRawStorage from './rules/no-raw-storage.mjs';
import noDirectConsoleLog from './rules/no-direct-console-log.mjs';
import noSettingsRepositoryDirect from './rules/no-settings-repository-direct.mjs';

export const meta = { name: 'local' };

export const rules = {
  'require-sanitized-markdown': requireSanitizedMarkdown,
  'require-response-size-limit': requireResponseSizeLimit,
  'no-tautology-expect': noTautologyExpect,
  'no-greedy-fake-timers': noGreedyFakeTimers,
  'no-test-sleep': noTestSleep,
  'no-fixed-wait': noFixedWait,
  'no-vacuous-negative-wait': noVacuousNegativeWait,
  'no-manual-protocol-version': noManualProtocolVersion,
  'utils-layer-boundary': utilsLayerBoundary,
  'no-dead-test-skip': noDeadTestSkip,
  'no-raw-storage': noRawStorage,
  'no-direct-console-log': noDirectConsoleLog,
  // Port of the eslint.config.js no-restricted-syntax SettingsRepository ban.
  'no-settings-repository-direct': noSettingsRepositoryDirect,
};

export default { meta, rules };
