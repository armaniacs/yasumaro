/**
 * ESLint rule: utils-layer-boundary
 *
 * Enforces the src/utils/ layer definitions from dev-docs/LAYERS.md:
 * - Layer 0 (Foundation, pure): no `chrome` global usage, no static imports
 *   of Layer 1 / Layer 2 / Barrel modules.
 * - Layer 1 (Infrastructure): no static imports of Layer 2 modules.
 *
 * Only static `ImportDeclaration` is inspected. Dynamic `import()` is
 * intentionally out of scope: it is the sanctioned technique for avoiding
 * cycles (see ADR 2026-08-20-utils-layer-circular-dependency), so ADR-recorded
 * circular exceptions pass this rule by construction.
 *
 * Type-only imports (`import type`) are skipped: they are erased at compile
 * time and create no runtime dependency edge.
 *
 * The layer file lists below are the single source of truth (SSOT) for the
 * mechanical check. dev-docs/LAYERS.md documents the mapping in its
 * "Mechanical enforcement" section.
 */

const LAYER0_FILES = [
  'src/utils/errorUtils.ts',
  'src/utils/objectUtils.ts',
  'src/utils/string.ts',
  'src/utils/htmlEscape.ts',
  'src/utils/urlUtils.ts',
  'src/utils/wildcardToRegex.ts',
  'src/utils/pathSanitizer.ts',
  'src/utils/cssUtils.ts',
  'src/utils/crypto/primitives.ts',
  'src/utils/crypto/envelope.ts',
  'src/utils/crypto/types.ts',
  'src/utils/crypto/cryptoParams.ts',
  'src/utils/logger/types.ts',
  'src/utils/logger/buffer.ts',
  'src/utils/commonTypes.ts',
  'src/utils/types.ts',
  'src/utils/urlEntry.ts',
  'src/utils/luhn.ts',
];

// Layer 1 files enforced by this rule (v1 scope). Files listed in LAYERS.md
// but deleted since (settingsStore.ts, optimisticLock.ts) are omitted; modules
// not yet classified in LAYERS.md (domainUtils.ts, DomainFilter.ts,
// SettingsRepository.ts, storageTransaction.ts, …) are out of scope until
// classified — see LAYERS.md "Mechanical enforcement".
const LAYER1_FILES = [
  'src/utils/storage/types.ts',
  'src/utils/storage/defaults.ts',
  'src/utils/storage/encryptionSession.ts',
  'src/utils/storage/savedUrlRepository.ts',
  'src/utils/storage/domainFilterCache.ts',
  'src/utils/storage/privacyConsent.ts',
  'src/utils/storage/quota.ts',
  'src/utils/storage/storageMaintenance.ts',
  'src/utils/Mutex.ts',
  'src/utils/rateLimiter.ts',
  'src/utils/trustDb/domainValidation.ts',
  'src/utils/trustDb/managedStringList.ts',
  // Reclassified 2026-09-17 (PBI 05): chrome.storage side effects, formerly
  // mislisted as Layer 0 in LAYERS.md.
  'src/utils/crypto/hmacKeyStore.ts',
];

// Layer 2 modules (High-level Utilities per LAYERS.md). Matched by path
// suffix with or without extension, so both `./x.js` and `../x.ts` resolve.
const LAYER2_MODULES = [
  'src/utils/pageContentPipeline.ts',
  'src/utils/aiSummaryCleaner/',
  'src/utils/sentenceExtractor.ts',
  'src/utils/promptSanitizer.ts',
  'src/utils/piiSanitizer.ts',
  'src/utils/obsidianConfigValidator.ts',
  'src/utils/fetch.ts',
  'src/utils/ssrfGuard.ts',
  'src/utils/cspValidator.ts',
  'src/utils/ublockParser/',
  'src/utils/ublockMatcher.ts',
  // Reclassified 2026-09-17 (PBI 05): depends on Layer 2 piiSanitizer,
  // formerly mislisted as Layer 0 in LAYERS.md.
  'src/utils/logger/sanitize.ts',
];

// Barrel shims are excluded from this rule: new imports through them are
// already discouraged by no-restricted-imports (warn) in eslint.config.js.
// Double-reporting the same edge in two rules would obscure the layer signal.
const BARREL_MODULES = ['src/utils/storage.ts', 'src/utils/logger.ts', 'src/utils/crypto/index.ts'];

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function stripExtension(p) {
  return p.replace(/\.(js|ts|mts|cts|mjs)$/, '');
}

/**
 * Resolve a static import source to a normalized path for suffix matching.
 * Relative sources are resolved against the importing file; bare specifiers
 * (node builtins, npm packages) return null (out of scope).
 */
function resolveImport(currentFile, source) {
  if (!source.startsWith('.')) {
    return null;
  }
  const dir = currentFile.slice(0, currentFile.lastIndexOf('/'));
  const parts = `${dir}/${source}`.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return stripExtension(out.join('/'));
}

function matchesAny(resolved, entries) {
  // `resolved` may carry an arbitrary absolute prefix (repo root differs
  // between machines and RuleTester fixtures), so file entries match by
  // suffix and directory entries (trailing slash) match by path segment.
  return entries.some((e) => {
    const isDir = e.endsWith('/');
    const base = stripExtension(isDir ? e.slice(0, -1) : e);
    if (resolved === base || resolved.endsWith(`/${base}`)) {
      return true;
    }
    return isDir && resolved.includes(`/${base}/`);
  });
}

function isAllowlisted(allow, currentFile, resolved) {
  const current = stripExtension(currentFile);
  return allow.some(
    (entry) =>
      (current === stripExtension(entry.from) || current.endsWith(`/${stripExtension(entry.from)}`)) &&
      matchesAny(resolved, [entry.to]),
  );
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'enforce src/utils/ layer boundaries (Layer 0 purity, Layer 1 → Layer 2 ban)',
    },
    messages: {
      layer0Chrome:
        'Layer 0 (Foundation) module must not reference the `chrome` global. Move chrome-dependent logic to Layer 1. See dev-docs/LAYERS.md.',
      layer0ForbiddenImport:
        "Layer 0 (Foundation) module must not statically import '{{target}}' ({{targetLayer}}). Layer 0 may only depend on Layer 0. See dev-docs/LAYERS.md.",
      layer1ForbiddenImport:
        "Layer 1 (Infrastructure) module must not statically import '{{target}}' (Layer 2). Use dynamic import() for sanctioned circular exceptions only. See dev-docs/LAYERS.md.",
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
                from: { type: 'string' },
                to: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['from', 'to'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const filename = normalizePath(context.filename || context.getFilename());
    const options = context.options[0] || {};
    const allow = options.allow || [];

    const inLayer0 = LAYER0_FILES.some((f) => filename.endsWith(f));
    const inLayer1 = LAYER1_FILES.some((f) => filename.endsWith(f));

    if (!inLayer0 && !inLayer1) {
      return {};
    }

    /** True when `chrome` in this scope is a local binding, not the global. */
    function isLocalChrome(node) {
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        if (scope.set.has('chrome')) {
          return true;
        }
        scope = scope.upper;
      }
      return false;
    }

    function checkStaticImport(node) {
      if (node.importKind === 'type') {
        return;
      }
      const source = node.source && node.source.value;
      if (typeof source !== 'string') {
        return;
      }
      const resolved = resolveImport(filename, source);
      if (resolved === null) {
        return;
      }
      if (inLayer0) {
        const layer1Hit = matchesAny(resolved, LAYER1_FILES);
        if (layer1Hit) {
          if (!isAllowlisted(allow, filename, resolved)) {
            context.report({ node, messageId: 'layer0ForbiddenImport', data: { target: source, targetLayer: 'Layer 1' } });
          }
          return;
        }
        if (matchesAny(resolved, LAYER2_MODULES)) {
          if (!isAllowlisted(allow, filename, resolved)) {
            context.report({ node, messageId: 'layer0ForbiddenImport', data: { target: source, targetLayer: 'Layer 2' } });
          }
          return;
        }
        if (matchesAny(resolved, BARREL_MODULES)) {
          if (!isAllowlisted(allow, filename, resolved)) {
            context.report({ node, messageId: 'layer0ForbiddenImport', data: { target: source, targetLayer: 'Barrel' } });
          }
        }
        return;
      }
      if (inLayer1 && matchesAny(resolved, LAYER2_MODULES)) {
        if (!isAllowlisted(allow, filename, resolved)) {
          context.report({ node, messageId: 'layer1ForbiddenImport', data: { target: source } });
        }
      }
    }

    const visitors = {
      ImportDeclaration: checkStaticImport,
    };

    if (inLayer0) {
      // MemberExpression on the `chrome` global (e.g. chrome.storage.local).
      // Comments and string literals never reach this visitor, so prose like
      // "has no chrome.storage side effects" is not flagged. A bare
      // `typeof chrome` guard (UnaryExpression) is not usage either.
      visitors.MemberExpression = (node) => {
        if (node.object.type !== 'Identifier' || node.object.name !== 'chrome') {
          return;
        }
        if (isLocalChrome(node)) {
          return;
        }
        context.report({ node, messageId: 'layer0Chrome' });
      };
    }

    return visitors;
  },
};
