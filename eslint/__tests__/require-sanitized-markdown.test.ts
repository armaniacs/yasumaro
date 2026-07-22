/**
 * RuleTester tests for require-sanitized-markdown
 */
import { RuleTester } from 'eslint';
import requireSanitizedMarkdown from '../rules/require-sanitized-markdown.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('require-sanitized-markdown', requireSanitizedMarkdown, {
  valid: [
    {
      name: 'sanitized variable used in template literal',
      code: [
        "import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';",
        'const safe = sanitizeForObsidian(title);',
        'const md = `- [${safe}](https://example.com)`;',
      ].join('\n'),
    },
    {
      name: 'sanitized member expression property used in template',
      code: [
        "import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';",
        'const safe = sanitizeForObsidian(entry.title);',
        'const md = `- [${safe}](https://example.com)`;',
      ].join('\n'),
    },
    {
      name: 'internal var names are skipped (with import)',
      code: [
        "import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';",
        'const md = `- [${timestamp}](https://example.com)`;',
      ].join('\n'),
    },
    {
      name: 'empty template literal without markdown patterns',
      code: 'const md = `Hello ${name}`;',
    },
    {
      name: 'sanitizedUrl variable used in markdown template',
      code: [
        "import { sanitizeUrlForMarkdownTarget } from '../utils/markdownSanitizer.js';",
        'const safe = sanitizeUrlForMarkdownTarget(url);',
        'const md = `- [link](${safe})`;',
      ].join('\n'),
    },
    {
      name: 'test file without import but with internal var name is ok',
      code: 'const md = `- [${timestamp}](https://example.com)`;',
      filename: '/path/to/__tests__/some.test.ts',
    },
  ],

  invalid: [
    {
      name: 'unsanitized identifier in markdown template literal',
      code: [
        "import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';",
        'const md = `- [${title}](https://example.com)`;',
      ].join('\n'),
      errors: [{ messageId: 'unsanitizedMarkdown' }],
    },
    {
      name: 'unsanitized MemberExpression (item.title) in markdown template',
      code: [
        "import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';",
        'const md = `- [${item.title}](https://example.com)`;',
      ].join('\n'),
      errors: [{ messageId: 'unsanitizedMarkdown' }],
    },
    {
      name: 'unsanitized MemberExpression (entry.summary) in markdown template',
      code: [
        "import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';",
        'const md = `- [${entry.summary}](https://example.com)`;',
      ].join('\n'),
      errors: [{ messageId: 'unsanitizedMarkdown' }],
    },
    {
      name: 'missing import + unsanitized var when markdown template exists without import',
      code: 'const md = `- [${raw}](https://example.com)`;',
      errors: [
        { messageId: 'missingImport' },
        { messageId: 'unsanitizedMarkdown' },
      ],
    },
    {
      name: 'multiple unsanitized vars in single template',
      code: [
        "import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';",
        'const md = `- [${a}](https://x.com) and [${b}](https://y.com)`;',
      ].join('\n'),
      errors: [
        { messageId: 'unsanitizedMarkdown' },
        { messageId: 'unsanitizedMarkdown' },
      ],
    },
  ],
});

export {};
