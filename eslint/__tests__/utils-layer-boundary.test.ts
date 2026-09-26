/**
 * RuleTester tests for utils-layer-boundary
 *
 * Pins both violation patterns (Layer 0 chrome usage, Layer 0/1 static
 * imports of upper layers) and allowance patterns (dynamic import circular
 * exceptions, type-only imports, intra-layer imports, comment/string
 * mentions of chrome.*).
 */
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import tsParser from '@typescript-eslint/parser';
import utilsLayerBoundary from '../rules/utils-layer-boundary.mjs';

const ruleTester = createRepeatSafeRuleTester({
  languageOptions: {
    // TS parser: the `import type` allowance case needs TS syntax.
    parser: tsParser,
  },
});

const LAYER0_FILE = '/repo/src/utils/errorUtils.ts';
const LAYER1_FILE = '/repo/src/utils/storage/defaults.ts';
const UNLISTED_FILE = '/repo/src/utils/domainUtils.ts';

ruleTester.run('utils-layer-boundary', utilsLayerBoundary, {
  valid: [
    {
      name: 'Layer 0 pure function with no imports',
      code: 'export function errorMessage(e) { return e instanceof Error ? e.message : String(e); }',
      filename: LAYER0_FILE,
    },
    {
      name: 'Layer 0 importing another Layer 0 module',
      code: "import { errorMessage } from './errorUtils.js';",
      filename: '/repo/src/utils/pathSanitizer.ts',
    },
    {
      name: 'Layer 0 mentioning chrome.* only in a comment',
      code: [
        '/** Pure primitives with no chrome.storage side effects. */',
        'export function add(a, b) { return a + b; }',
      ].join('\n'),
      filename: LAYER0_FILE,
    },
    {
      name: 'Layer 0 mentioning chrome.* only in a string literal',
      code: 'export const NOTE = "avoids chrome.storage for purity";',
      filename: LAYER0_FILE,
    },
    {
      name: 'Layer 0 shadowing chrome with a local variable',
      code: [
        'export function read(chrome) {',
        '  return chrome.storage;',
        '}',
      ].join('\n'),
      filename: LAYER0_FILE,
    },
    {
      name: 'Layer 0 with bare typeof chrome guard but no member access',
      code: [
        'export function hasChrome() {',
        "  return typeof chrome !== 'undefined';",
        '}',
      ].join('\n'),
      filename: LAYER0_FILE,
    },
    {
      name: 'Layer 0 importing messaging constants (outside utils, v1 out of scope)',
      code: "import { MAX } from '../../messaging/limits.js';",
      filename: '/repo/src/utils/crypto/envelope.ts',
    },
    {
      name: 'Layer 1 dynamic import of Layer 2 for cycle avoidance passes',
      code: [
        'export async function load() {',
        "  const { sanitizeRegex } = await import('../piiSanitizer.js');",
        '  return sanitizeRegex;',
        '}',
      ].join('\n'),
      filename: LAYER1_FILE,
    },
    {
      name: 'Layer 1 type-only import of Layer 2 is erased at compile time',
      code: "import type { MaskedItem } from '../piiSanitizer.js';",
      filename: LAYER1_FILE,
    },
    {
      name: 'Layer 1 importing Layer 0 and Layer 1 modules',
      code: [
        "import { errorMessage } from '../errorUtils.js';",
        "import { StorageKeys } from './types.js';",
      ].join('\n'),
      filename: LAYER1_FILE,
    },
    {
      name: 'Layer 1 importing barrel is left to no-restricted-imports',
      code: "import { logError } from '../logger.js';",
      filename: LAYER1_FILE,
    },
    {
      name: 'allowlisted Layer 1 edge passes (provisional defaults -> rules)',
      code: "import { CLEANSING_RULES } from '../aiSummaryCleaner/rules.js';",
      filename: LAYER1_FILE,
      options: [{ allow: [{ from: 'src/utils/storage/defaults.ts', to: 'src/utils/aiSummaryCleaner/rules' }] }],
    },
    {
      name: 'unlisted file is out of scope',
      code: "import { x } from './ublockMatcher.js';",
      filename: UNLISTED_FILE,
    },
  ],

  invalid: [
    {
      name: 'Layer 0 referencing chrome.storage is a violation',
      code: 'export async function get(k) { return chrome.storage.local.get(k); }',
      filename: LAYER0_FILE,
      errors: [{ messageId: 'layer0Chrome' }],
    },
    {
      name: 'Layer 0 guarded chrome.i18n usage is still a violation',
      code: [
        'export function locale() {',
        "  if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {",
        '    return chrome.i18n.getUILanguage();',
        '  }',
        "  return 'en';",
        '}',
      ].join('\n'),
      filename: LAYER0_FILE,
      errors: [{ messageId: 'layer0Chrome' }, { messageId: 'layer0Chrome' }],
    },
    {
      name: 'Layer 0 statically importing Layer 2 is a violation',
      code: "import { sanitizeRegex } from './piiSanitizer.js';",
      filename: LAYER0_FILE,
      errors: [{ messageId: 'layer0ForbiddenImport' }],
    },
    {
      name: 'Layer 0 statically importing Layer 1 is a violation',
      code: "import { Mutex } from './Mutex.js';",
      filename: LAYER0_FILE,
      errors: [{ messageId: 'layer0ForbiddenImport' }],
    },
    {
      name: 'Layer 0 statically importing a barrel is a violation',
      code: "import { logError } from './logger.js';",
      filename: LAYER0_FILE,
      errors: [{ messageId: 'layer0ForbiddenImport' }],
    },
    {
      name: 'Layer 1 statically importing Layer 2 is a violation',
      code: "import { sanitizeRegex } from '../piiSanitizer.js';",
      filename: LAYER1_FILE,
      errors: [{ messageId: 'layer1ForbiddenImport' }],
    },
    {
      name: 'Layer 1 statically importing Layer 2 directory module is a violation',
      code: "import { CLEANSING_RULES } from '../aiSummaryCleaner/rules.js';",
      filename: LAYER1_FILE,
      errors: [{ messageId: 'layer1ForbiddenImport' }],
    },
  ],
});

export {};
