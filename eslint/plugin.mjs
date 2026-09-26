import requireSanitizedMarkdown from './rules/require-sanitized-markdown.mjs';
import requireResponseSizeLimit from './rules/require-response-size-limit.mjs';
import noTautologyExpect from './rules/no-tautology-expect.mjs';
import noGreedyFakeTimers from './rules/no-greedy-fake-timers.mjs';
import noTestSleep from './rules/no-test-sleep.mjs';
import noFixedWait from './rules/no-fixed-wait.mjs';
import noVacuousNegativeWait from './rules/no-vacuous-negative-wait.mjs';
import utilsLayerBoundary from './rules/utils-layer-boundary.mjs';

export default {
  rules: {
    'require-sanitized-markdown': requireSanitizedMarkdown,
    'require-response-size-limit': requireResponseSizeLimit,
    'no-tautology-expect': noTautologyExpect,
    'no-greedy-fake-timers': noGreedyFakeTimers,
    'no-test-sleep': noTestSleep,
    'no-fixed-wait': noFixedWait,
    'no-vacuous-negative-wait': noVacuousNegativeWait,
    'utils-layer-boundary': utilsLayerBoundary,
  },
};
