import requireSanitizedMarkdown from './rules/require-sanitized-markdown.mjs';
import requireResponseSizeLimit from './rules/require-response-size-limit.mjs';

export default {
  rules: {
    'require-sanitized-markdown': requireSanitizedMarkdown,
    'require-response-size-limit': requireResponseSizeLimit,
  },
};
