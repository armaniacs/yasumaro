/**
 * ESLint rule: no-direct-console-log
 *
 * PBI 2026-11-11-03: rejects NEW direct `console.<method>()` log emissions
 * outside the structured-logger seam and the documented allowlist.
 *
 * `logInfo/logWarn/logError/logDebug/logCritical` behind the logger seam
 * (src/utils/logger/) is the single source of truth for log emission: it
 * persists through addLog (PII-sanitized, SW-termination-safe) and owns the
 * only development console mirrors. A raw console call bypasses that seam:
 * it skips PII sanitization, skips persistence, and splits warn/error levels
 * across two emission paths (the double-fire the PBI removes).
 *
 * What is checked: `CallExpression`s whose callee is exactly
 * `console.<method>` with method in log/debug/info/warn/error, plus a bare
 * `console.<method>` reference passed as a call argument (the
 * `.catch(console.error)` shape — the promise machinery calls it, so it
 * emits exactly like a direct call). Comments, string literals,
 * `vi.spyOn(console, ...)` references, `expect(console.x)` assertions, and a
 * locally shadowed `console` binding never reach these visitors and are not
 * flagged.
 *
 * What passes by construction (no allowlist entry needed):
 * - `src/utils/logger/**` — the seam itself (api/core/storageAdapter/
 *   flushScheduler/criticalAlertSink). The logger cannot log to itself
 *   (that would recurse), so its last-resort console lines live here.
 *
 * Everything else needs an `allow` entry `{ file, reason }` in
 * eslint.config.js. `reason` is required by the schema: an unjustified
 * bypass is exactly what this rule exists to prevent. Test files are out of
 * scope via the config `ignores` (tests stub `console`).
 */

const LOG_METHODS = new Set(['log', 'debug', 'info', 'warn', 'error']);

// Directory exemptions that pass without an allowlist entry. Matched by
// suffix so absolute filenames (which differ per machine and per RuleTester
// fixture) still match.
const SEAM_PREFIXES = ['src/utils/logger/'];

function normalizePath(p) {
  return String(p).replace(/\\/g, '/');
}

function isSeamFile(filename) {
  const normalized = normalizePath(filename);
  return SEAM_PREFIXES.some((prefix) => normalized.includes(`/${prefix}`));
}

function isAllowlisted(allow, filename) {
  const normalized = normalizePath(filename);
  return allow.some(
    (entry) => normalized === entry.file || normalized.endsWith(`/${entry.file}`),
  );
}

/** True when `console` in this scope is a local binding, not the global. */
function isLocalConsole(context, node) {
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    if (scope.set.has('console')) {
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
 * True when `node` is the `console` object expression, tolerant of
 * `console?.method` chains (OptionalMemberExpression) but not of computed
 * access with a non-literal key (which this rule does not try to resolve).
 */
function isConsoleObject(node) {
  if (!node) return false;
  return node.type === 'Identifier' && node.name === 'console';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow direct console log/warn/error calls outside the structured-logger seam and the documented allowlist',
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
      directConsole:
        'Direct console.{{method}}() bypasses the structured-logger seam (PII sanitization, persistence, level consistency). Route through logInfo/logWarn/logError/logDebug/logCritical from src/utils/logger/api.js, or document this file in the rule allowlist with a reason.',
      directConsoleRef:
        'Passing console.{{method}} as a callback emits through it exactly like a direct call and bypasses the structured-logger seam. Wrap the call site with logInfo/logWarn/logError/logDebug/logCritical from src/utils/logger/api.js instead, or document this file in the rule allowlist with a reason.',
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

    /**
     * True for the assertion/spy shapes whose `console.<method>` argument is
     * an observation, not an emission: `expect(console.x)` and
     * `vi.spyOn(console, 'x')`-style spies.
     */
    function isObservationCall(node) {
      if (node.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (callee.type === 'Identifier' && callee.name === 'expect') return true;
      if (
        (callee.type === 'MemberExpression' ||
          callee.type === 'OptionalMemberExpression') &&
        getMethodName(callee.property) === 'spyOn'
      ) {
        return true;
      }
      return false;
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
        if (!isConsoleObject(callee.object)) {
          return;
        }
        const method = getMethodName(callee.property);
        if (!LOG_METHODS.has(method)) {
          return;
        }
        if (isLocalConsole(context, node)) {
          return;
        }
        context.report({ node: callee, messageId: 'directConsole', data: { method } });
      },
      // `.catch(console.error)` and friends: the reference is invoked by the
      // surrounding machinery, so it is an emission. The callee position
      // itself is owned by the CallExpression visitor above and skipped here
      // to avoid double-reporting `console.warn(x)`.
      MemberExpression(node) {
        if (!isConsoleObject(node.object)) {
          return;
        }
        const method = getMethodName(node.property);
        if (!LOG_METHODS.has(method)) {
          return;
        }
        const parent = node.parent;
        if (!parent || parent.type !== 'CallExpression') {
          return;
        }
        if (parent.callee === node) {
          return;
        }
        if (isObservationCall(parent)) {
          return;
        }
        if (isLocalConsole(context, node)) {
          return;
        }
        context.report({ node, messageId: 'directConsoleRef', data: { method } });
      },
    };
  },
};
