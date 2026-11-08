/**
 * ESLint rule: no-raw-storage
 *
 * PBI 2026-11-07-02: rejects NEW direct `chrome.storage.local.<method>()`
 * calls outside the storage seam and the documented allowlist.
 *
 * `SettingsRepository` (defaults + migration + encryption + quota) behind the
 * `StoragePort` seam is the single source of truth for settings persistence.
 * A raw get/set/remove/clear/getBytesInUse bypasses that seam: it skips
 * migration, skips envelope encryption, and splits the 1s settings cache.
 *
 * What is checked: only `CallExpression`s whose callee is exactly
 * `chrome.storage.local.<method>`. Comments, string literals, `typeof chrome`
 * guards, `vi.spyOn(chrome.storage.local, ...)` references, and passing the
 * area object itself (e.g. `chromeStorageAreaAdapter(chrome.storage.local)`
 * in src/utils/ports.ts) never reach this visitor and are not flagged.
 *
 * What passes by construction (no allowlist entry needed):
 * - `src/utils/storage/**` — the seam itself (SettingsRepository,
 *   ChromeStoragePort, migration, encryption session, quota, maintenance).
 * - `src/utils/ports.ts` — the `chromeStorageAreaAdapter(chrome.storage.local)`
 *   factory that builds the production port.
 *
 * Everything else needs an `allow` entry `{ file, reason }` in
 * eslint.config.js. `reason` is required by the schema: an unjustified
 * bypass is exactly what this rule exists to prevent. Test files are out of
 * scope via the config `ignores` (tests stub `chrome.storage.local`).
 */

const RAW_METHODS = new Set(['get', 'set', 'remove', 'clear', 'getBytesInUse']);

// Directory / file exemptions that pass without an allowlist entry. Matched
// by suffix so absolute filenames (which differ per machine and per
// RuleTester fixture) still match.
const SEAM_PREFIXES = ['src/utils/storage/'];
const SEAM_FILES = ['src/utils/ports.ts'];

function normalizePath(p) {
  return String(p).replace(/\\/g, '/');
}

function isSeamFile(filename) {
  const normalized = normalizePath(filename);
  return (
    SEAM_PREFIXES.some((prefix) => normalized.includes(`/${prefix}`)) ||
    SEAM_FILES.some((file) => normalized === file || normalized.endsWith(`/${file}`))
  );
}

function isAllowlisted(allow, filename) {
  const normalized = normalizePath(filename);
  return allow.some(
    (entry) => normalized === entry.file || normalized.endsWith(`/${entry.file}`),
  );
}

/** True when `chrome` in this scope is a local binding, not the global. */
function isLocalChrome(context, node) {
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    if (scope.set.has('chrome')) {
      return true;
    }
    scope = scope.upper;
  }
  return false;
}

function getMethodName(property) {
  if (!property) return null;
  if (property.type === 'Identifier' && !property.computed) return property.name;
  if (property.type === 'Literal' && typeof property.value === 'string') return property.value;
  return null;
}

/**
 * True when `node` is the `chrome.storage.local` object expression, tolerant
 * of `a?.b` chains (OptionalMemberExpression) but not of computed access with
 * a non-literal key (which this rule does not try to resolve).
 */
function isStorageLocalArea(node) {
  if (!node) return false;
  const objectType = node.type;
  if (objectType !== 'MemberExpression' && objectType !== 'OptionalMemberExpression') {
    return false;
  }
  const { object, property, computed } = node;
  if (computed) return false;
  if (property.type !== 'Identifier' || property.name !== 'local') return false;
  if (!object || (object.type !== 'MemberExpression' && object.type !== 'OptionalMemberExpression')) {
    return false;
  }
  if (object.computed) return false;
  if (object.property.type !== 'Identifier' || object.property.name !== 'storage') return false;
  const root = object.object;
  return root != null && root.type === 'Identifier' && root.name === 'chrome';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow direct chrome.storage.local get/set outside the SettingsRepository/StoragePort seam and the documented allowlist',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['file', 'reason'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawStorage:
        'Direct chrome.storage.local.{{method}}() bypasses the SettingsRepository/StoragePort SSOT (defaults, migration, encryption, quota). Route settings reads/writes through the settingsRepository singleton or an injected SettingsReader/StoragePort, or document this file in the rule allowlist with a reason.',
    },
  },

  create(context) {
    const filename = normalizePath(context.filename || context.getFilename());
    const options = context.options[0] || {};
    const allow = options.allow || [];

    if (isSeamFile(filename)) {
      return {};
    }
    const fileAllowlisted = isAllowlisted(allow, filename);
    if (fileAllowlisted) {
      return {};
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' &&
          callee.type !== 'OptionalMemberExpression'
        ) {
          return;
        }
        if (!isStorageLocalArea(callee.object)) {
          return;
        }
        const method = getMethodName(callee.property);
        if (!RAW_METHODS.has(method)) {
          return;
        }
        if (isLocalChrome(context, node)) {
          return;
        }
        context.report({ node: callee, messageId: 'rawStorage', data: { method } });
      },
    };
  },
};
