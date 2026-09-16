import requireSanitizedMarkdown from './rules/require-sanitized-markdown.mjs';
import requireResponseSizeLimit from './rules/require-response-size-limit.mjs';
import noTautologyExpect from './rules/no-tautology-expect.mjs';
import utilsLayerBoundary from './rules/utils-layer-boundary.mjs';

export default {
  rules: {
    'require-sanitized-markdown': requireSanitizedMarkdown,
    'require-response-size-limit': requireResponseSizeLimit,
    'no-tautology-expect': noTautologyExpect,
    'utils-layer-boundary': utilsLayerBoundary,
  },
};
