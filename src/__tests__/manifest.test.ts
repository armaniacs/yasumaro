/**
 * manifest.test.ts
 *
 * Least-privilege verification of the manifest wxt.config.ts declares.
 *
 * The manifest is no longer a checked-in file: WXT generates it at build time
 * from wxt.config.ts, so the old `existsSync('manifest.json')` gate here was
 * permanently false and every test in this file was permanently skipped. This
 * suite now verifies the manifest where it actually lives, in two layers:
 *
 *   1. The declared manifest — wxt.config.ts's manifest factory is called
 *      directly with a Chromium MV3 `wxt build` env, so a permission that is
 *      hard-coded into the config instead of the SSOT, or an SSOT entry the
 *      factory stops passing through, fails at `npm run validate` time with
 *      no build.
 *   2. The SSOT inputs the factory must consume —
 *      AI_PROVIDER_HOST_PERMISSIONS, OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS and
 *      buildLocalHostPermissions() from src/utils/cspDomains.ts, the single
 *      source the manifest permissions and the CSP connect-src are both
 *      generated from (M24).
 *
 * Every precondition is a failing assertion, never a skip or a warn-and-
 * return: a factory that stops declaring host_permissions, a domain that
 * creeps past the cap, or a web_accessible_resources entry the content script
 * needs must be a red test.
 *
 * The built artifact itself (dist/chromium-mv3) is verified by
 * scripts/release-checks/check-manifest.mjs, which CI runs after
 * `npm run build` (PBI 2026-10-12-03): the dist files the declared
 * web_accessible_resources point at only exist after a build.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_PROVIDER_HOST_PERMISSIONS,
  OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
  GIST_EGRESS_HOST_PERMISSIONS,
  buildLocalHostPermissions,
} from '../utils/cspDomains.js';
import type { UserManifest } from 'wxt';
// Intentional deviation from the ".js extensions on all imports" convention
// (AGENTS.md): wxt.config.ts is the root build config, not a compiled module —
// no .js form exists for it, and vitest (vite) resolves the .ts directly.
import wxtConfig from '../../wxt.config.ts';

/* -------------------------------------------------------- declared manifest */

/**
 * Mirrors `wxt build` for the Chromium MV3 target the repo ships. The factory
 * only reads `browser`, but the full env keeps the call faithful to the CLI.
 */
const CHROMIUM_BUILD_ENV = {
  mode: 'production',
  command: 'build',
  browser: 'chromium',
  manifestVersion: 3,
} as const;

function buildDeclaredManifest(): UserManifest {
  const factory = wxtConfig.manifest;
  if (typeof factory !== 'function') {
    throw new Error(
      'wxt.config.ts no longer declares the manifest as a factory — update manifest.test.ts to match',
    );
  }
  const declared = factory(CHROMIUM_BUILD_ENV);
  if (declared instanceof Promise) {
    throw new Error(
      'wxt.config.ts manifest factory is async — resolve it here so a broken declaration fails instead of hanging',
    );
  }
  return declared;
}

const declared = buildDeclaredManifest();

function declaredHostPermissions(): string[] {
  const host = declared.host_permissions;
  if (host === undefined) {
    throw new Error(
      'wxt.config.ts declares no host_permissions — local service and AI provider access dies',
    );
  }
  return host;
}

function declaredOptionalHostPermissions(): string[] {
  const optional = declared.optional_host_permissions;
  if (optional === undefined) {
    throw new Error(
      'wxt.config.ts declares no optional_host_permissions — opt-in providers and list sources die',
    );
  }
  return optional;
}

/* ------------------------------------------------------ SSOT-derived inputs */

/** What wxt.config.ts must pass as host_permissions: local service origins, always-granted AI providers, and the Gist egress origin. */
const EXPECTED_HOST_PERMISSIONS: readonly string[] = [
  ...buildLocalHostPermissions(),
  ...AI_PROVIDER_HOST_PERMISSIONS,
  ...GIST_EGRESS_HOST_PERMISSIONS,
];

/** What wxt.config.ts must pass as optional_host_permissions: the opt-in SSOT list verbatim. */
const EXPECTED_OPTIONAL_HOST_PERMISSIONS: readonly string[] = [
  ...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
];

/** Legacy default AI providers the manifest must always grant. */
const DEFAULT_AI_PROVIDER_PATTERNS = [
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://api.groq.com/*',
  'https://mistral.ai/*',
  'https://deepseek.com/*',
  'https://generativelanguage.googleapis.com/*',
];

/** Opt-in AI providers that must stay out of host_permissions (least privilege). */
const OPT_IN_AI_PROVIDER_HOSTS = [
  'api-inference.huggingface.co',
  'api.openrouter.ai',
  'deepinfra.com',
  'cerebras.ai',
];

/** Non-AI list sources the uBlock import / tranco flows need on demand. */
const ESSENTIAL_NON_AI_HOSTS = [
  'raw.githubusercontent.com',
  'gitlab.com',
  'tranco-list.eu',
  'easylist.to',
];

/**
 * host_permissions = 16 local service origins + 14 always-granted AI provider
 * domains + 1 Gist egress origin (api.github.com, PBI 2026-10-21-11) = 31
 * today. The cap leaves headroom for a handful of provider additions and fails
 * on creep of 10 or more entries (the pre-WXT manifest carried 2000+ domains;
 * the original unenforceable "<30" cap never ran).
 */
const MAX_HOST_PERMISSIONS = 40;

/** host_permissions + optional_host_permissions = 63 today. */
const MAX_TOTAL_HOST_PERMISSIONS = 100;

/* --------------------------------------- declared localhost removals (PBI 2026-10-16-10) */

/**
 * An intentional localhost permission removal, declared with its reason.
 *
 * The localhost "must exist" gate is relaxed only through this declaration:
 * a removal listed here (with a non-empty reason) is accepted by the gate,
 * while a removal without a declaration still fails (red-side preserved).
 * Only localhost / 127.0.0.1 origins may be declared — AI provider domains
 * stay mandatory. Empty today, so the declared manifest passes unchanged;
 * a future least-privilege cut adds its entry here together with the reason.
 */
export type DeclaredPermissionRemoval = {
  permission: string;
  reason: string;
};

const DECLARED_LOCALHOST_REMOVALS: readonly DeclaredPermissionRemoval[] = [];

function isLocalHostPermission(permission: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/\*$/.test(permission);
}

/**
 * The SSOT host composition minus removals declared with a reason. Every
 * declaration is validated: a non-empty reason, a localhost-only target that
 * the SSOT currently grants, and no duplicates. A bad declaration throws, so
 * a reason-less or out-of-scope "declaration" can never silently widen the gate.
 */
function expectedHostPermissionsAllowingDeclaredRemovals(
  removals: readonly DeclaredPermissionRemoval[] = DECLARED_LOCALHOST_REMOVALS,
): string[] {
  const seen = new Set<string>();
  for (const removal of removals) {
    if (typeof removal.reason !== 'string' || removal.reason.trim().length === 0) {
      throw new Error(
        `declared localhost removal of "${removal.permission}" needs a non-empty reason — an unexplained removal is a red-side failure`,
      );
    }
    if (!isLocalHostPermission(removal.permission)) {
      throw new Error(
        `declared removal of "${removal.permission}" is rejected — only localhost / 127.0.0.1 origins may be removed by declaration`,
      );
    }
    if (!EXPECTED_HOST_PERMISSIONS.includes(removal.permission)) {
      throw new Error(
        `declared removal of "${removal.permission}" is not in the SSOT composition — declare only what the SSOT currently grants`,
      );
    }
    if (seen.has(removal.permission)) {
      throw new Error(`duplicate declared removal of "${removal.permission}"`);
    }
    seen.add(removal.permission);
  }
  return EXPECTED_HOST_PERMISSIONS.filter((permission) => !seen.has(permission));
}

/* ------------------------------------------------------- the permission gate */

/**
 * The permission gate over any manifest-shaped input. The Red-side tests in
 * this file run this exact gate against tampered inputs in the
 * "permission gate over the declared manifest" describe, so it stays
 * module-private: there are no external consumers to import it from.
 */
function assertLeastPrivilegePermissions(
  manifest: UserManifest,
  declaredRemovals: readonly DeclaredPermissionRemoval[] = DECLARED_LOCALHOST_REMOVALS,
): void {
  const host = manifest.host_permissions;
  const optional = manifest.optional_host_permissions;
  if (host === undefined || optional === undefined) {
    throw new Error(
      'host_permissions / optional_host_permissions must be declared — least privilege cannot be verified on a missing list',
    );
  }

  // The declared lists must be exactly the SSOT composition minus removals
  // declared with a reason (PBI 2026-10-16-10): a domain hard-coded into
  // wxt.config.ts, an SSOT entry the factory stops passing through, or an
  // undeclared removal breaks the equality instead of drifting silently.
  expect(host).toEqual(expectedHostPermissionsAllowingDeclaredRemovals(declaredRemovals));
  expect(optional).toEqual([...EXPECTED_OPTIONAL_HOST_PERMISSIONS]);

  // 2026-09-05: <all_urls> was dropped from optional_host_permissions; least
  // privilege means no blanket host grant in either list.
  expect(host).not.toContain('<all_urls>');
  expect(optional).not.toContain('<all_urls>');

  expect(host.length).toBeLessThan(MAX_HOST_PERMISSIONS);
  expect(host.length + optional.length).toBeLessThan(MAX_TOTAL_HOST_PERMISSIONS);
}

/* ------------------------------------------------------- page-context WAR needs */

/**
 * MV3 web_accessible_resources: either flat strings or `{resources, matches}`
 * groups (wxt.config.ts uses the group form).
 */
type WarGroup = { resources?: string[]; matches?: string[] };

function declaredWarGroups(): WarGroup[] {
  const war = declared.web_accessible_resources;
  if (war === undefined || war.length === 0) {
    throw new Error(
      'wxt.config.ts declares no web_accessible_resources — the content script fetches chrome-extension:// resources from the page context, which need WAR (2026-04-15: a missing entry broke the dynamic import on every page)',
    );
  }
  const groups: WarGroup[] = [];
  for (const entry of war) {
    groups.push(typeof entry === 'string' ? { resources: [entry] } : entry);
  }
  return groups;
}

function declaredWarResources(): string[] {
  return declaredWarGroups().flatMap((group) => group.resources ?? []);
}

/** The page-context sources: the registered content script tree and the WAR-loaded chunk itself. */
const PAGE_CONTEXT_SOURCE_DIRS = ['src/content', 'entrypoints/content'];
const PAGE_CONTEXT_SOURCE_FILES = ['entrypoints/content-extractor.ts'];

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The resources the content script fetches from the page context: every
 * `chrome.runtime.getURL('...')` literal in page-context code. A getURL fetch
 * from the page needs a web_accessible_resources entry — extension pages
 * already have access, so only content-script code counts (2026-04-15: a WAR
 * omission killed the content script's dynamic import on every page).
 */
function collectPageContextGetURLTargets(): string[] {
  const getURLPattern = /getURL\(\s*(['"`])((?:(?!\1).)*)\1\s*\)/g;
  const targets = new Set<string>();
  const files = [
    ...PAGE_CONTEXT_SOURCE_DIRS.flatMap((dir) => listTsFiles(join(process.cwd(), dir))),
    ...PAGE_CONTEXT_SOURCE_FILES.map((file) => join(process.cwd(), file)),
  ];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(getURLPattern)) {
      const target = match[2];
      if (target) targets.add(target);
    }
  }
  return [...targets];
}

/**
 * Resolves a declared web_accessible_resources entry at source level.
 *
 * Supported origins (PBI 2026-10-13-03): `.js` entries are content-script
 * entrypoints built from `entrypoints/<name>.ts`, and every other entry ships
 * from `public/`. These are the only two origins WXT composes into the WAR
 * today (content-extractor.js, icons/icon48.png). A future module split that
 * puts a src-built chunk into the WAR (the pre-WXT manifest carried
 * `utils/*.js` entries) must extend this resolver — until then such an entry
 * fails the stale check as a false positive.
 */
function warResourceResolves(resource: string): boolean {
  if (resource.endsWith('.js')) {
    // Built from entrypoints/<name>.ts — WXT emits <name>.js for a content
    // script entrypoint.
    return existsSync(join(process.cwd(), 'entrypoints', resource.replace(/\.js$/, '.ts')));
  }
  // Everything else ships from public/.
  return existsSync(join(process.cwd(), 'public', resource));
}

/* ------------------------------------------------------------------- specs */

describe('Manifest - Host Permissions Minimization', () => {
  describe('host_permissions', () => {
    it('is exactly the SSOT composition minus declared localhost removals — local service origins plus always-granted AI providers', () => {
      expect(declaredHostPermissions()).toEqual(expectedHostPermissionsAllowingDeclaredRemovals());
    });

    it('contains the default AI provider domains', () => {
      const host = declaredHostPermissions();
      for (const pattern of DEFAULT_AI_PROVIDER_PATTERNS) {
        expect(host).toContain(pattern);
      }
    });

    it('contains every local service origin (localhost and 127.0.0.1, http and https) unless its removal is declared with a reason', () => {
      // PBI 2026-10-16-10: the "must exist" assertion is relaxed into
      // "must exist OR be declared removed". With DECLARED_LOCALHOST_REMOVALS
      // empty this behaves exactly as before; a future least-privilege cut
      // lists its origin there instead of fighting this gate.
      const host = declaredHostPermissions();
      for (const local of buildLocalHostPermissions()) {
        if (DECLARED_LOCALHOST_REMOVALS.some((removal) => removal.permission === local)) {
          expect(host).not.toContain(local);
        } else {
          expect(host).toContain(local);
        }
      }
    });

    it('contains the Gist egress origin as an always-granted host permission', () => {
      // PBI 2026-10-21-11: Gist sync's only outbound channel is declared
      // mandatorily, not escaped into optional_host_permissions.
      const host = declaredHostPermissions();
      for (const pattern of GIST_EGRESS_HOST_PERMISSIONS) {
        expect(host).toContain(pattern);
      }
    });

    it('never contains <all_urls>', () => {
      expect(declaredHostPermissions()).not.toContain('<all_urls>');
    });
  });

  describe('optional_host_permissions', () => {
    it('is exactly the opt-in SSOT list', () => {
      expect(declaredOptionalHostPermissions()).toEqual([...EXPECTED_OPTIONAL_HOST_PERMISSIONS]);
    });

    it('contains the opt-in AI provider domains', () => {
      const optional = declaredOptionalHostPermissions();
      for (const provider of OPT_IN_AI_PROVIDER_HOSTS) {
        expect(optional.some((perm) => perm.includes(provider))).toBe(true);
      }
    });

    it('keeps the opt-in AI provider domains out of host_permissions', () => {
      const host = declaredHostPermissions();
      for (const provider of OPT_IN_AI_PROVIDER_HOSTS) {
        expect(host.some((perm) => perm.includes(provider))).toBe(false);
      }
    });

    it('contains the essential non-AI list sources', () => {
      const optional = declaredOptionalHostPermissions();
      for (const domain of ESSENTIAL_NON_AI_HOSTS) {
        expect(optional.some((perm) => perm.includes(domain))).toBe(true);
      }
    });

    it('never contains <all_urls>', () => {
      expect(declaredOptionalHostPermissions()).not.toContain('<all_urls>');
    });
  });

  describe('permission count caps', () => {
    it('keeps host_permissions under the 40-entry cap (16 local + 14 AI provider + 1 Gist egress today)', () => {
      expect(declaredHostPermissions().length).toBeLessThan(MAX_HOST_PERMISSIONS);
    });

    it('keeps the total host permissions under 100 (63 today)', () => {
      const total =
        declaredHostPermissions().length + declaredOptionalHostPermissions().length;
      expect(total).toBeLessThan(MAX_TOTAL_HOST_PERMISSIONS);
    });
  });

  describe('web_accessible_resources', () => {
    it('declares every resource the content script fetches from the page context', () => {
      // chrome.runtime.getURL() from page-context code is a chrome-extension://
      // fetch the page itself performs — it needs a web_accessible_resources
      // entry (2026-04-15: a missing entry killed the content script's dynamic
      // import on every page, so autosave failed everywhere).
      const accessible = declaredWarResources();
      const required = collectPageContextGetURLTargets();
      expect(required.length, 'page-context getURL() targets must be discoverable').toBeGreaterThan(0);
      const missing = required.filter((target) => !accessible.includes(target));
      expect(missing).toEqual([]);
    });

    it('declares only resources that resolve to a source file or entrypoint', () => {
      // A stale web_accessible_resources entry pointing at a file the build no
      // longer produces is dead surface area — and the artifact gate fails on
      // it after a build. Resolve each declared resource at source level.
      const stale = declaredWarResources().filter((resource) => !warResourceResolves(resource));
      expect(stale).toEqual([]);
    });

    it('matches the http(s) pages the content script runs on', () => {
      // The content script injects on all http(s) pages (manifest
      // content_scripts <all_urls>), so the WAR matches must cover both
      // schemes or the icon injection and the dynamic import fail on one.
      const matches = declaredWarGroups().flatMap((group) => group.matches ?? []);
      expect(matches).toContain('http://*/*');
      expect(matches).toContain('https://*/*');
    });
  });

  describe('permission gate over the declared manifest', () => {
    it('passes the full least-privilege gate', () => {
      // The gate throws with the failing invariant's message; .not.toThrow()
      // surfaces that message as the test failure.
      expect(() => assertLeastPrivilegePermissions(declared)).not.toThrow();
    });

    it('throws when a host permission outside the SSOT composition is added', () => {
      // Red side of the gate (PBI 2026-10-13-01): one host permission the
      // SSOT never composes must fail the gate instead of drifting through.
      const tampered: UserManifest = {
        ...declared,
        host_permissions: [...declaredHostPermissions(), 'https://tracker.example/*'],
      };
      // The gate fails at its SSOT equality check; pin that message fragment
      // so a weakened gate (e.g. toEqual swapped for a subset check) cannot
      // pass this test silently.
      expect(() => assertLeastPrivilegePermissions(tampered)).toThrow(/to deeply equal/);
    });

    it('throws when a local service origin is dropped from host_permissions', () => {
      // Red side of the gate: dropping the Obsidian Local REST origin must
      // fail the gate instead of passing the remaining checks. The toContain
      // guard fails with a clear message if the SSOT ever stops generating
      // this origin, so the tampering below is never a silent no-op.
      const host = declaredHostPermissions();
      expect(host).toContain('http://127.0.0.1:27123/*');
      const tampered: UserManifest = {
        ...declared,
        host_permissions: host.filter((permission) => permission !== 'http://127.0.0.1:27123/*'),
      };
      expect(() => assertLeastPrivilegePermissions(tampered)).toThrow(/to deeply equal/);
    });

    describe('declared localhost removals', () => {
      it('accepts a localhost origin removed with a declared reason', () => {
        // BDD accept side (PBI 2026-10-16-10): an intentional least-privilege
        // cut, declared with its reason, passes the gate instead of fighting it.
        const host = declaredHostPermissions();
        const removed = 'http://127.0.0.1:27123/*';
        expect(host).toContain(removed);
        const tampered: UserManifest = {
          ...declared,
          host_permissions: host.filter((permission) => permission !== removed),
        };
        expect(tampered.host_permissions).not.toContain(removed);
        expect(() =>
          assertLeastPrivilegePermissions(tampered, [
            { permission: removed, reason: 'Obsidian Local REST on 27123 retired — 27124 is the only loopback port' },
          ]),
        ).not.toThrow();
      });

      it('rejects a localhost removal without a declaration', () => {
        // BDD reject side: the same cut with no declaration must still fail,
        // so undeclared deletions cannot drift through the relaxed gate.
        const host = declaredHostPermissions();
        const removed = 'http://localhost:27124/*';
        expect(host).toContain(removed);
        const tampered: UserManifest = {
          ...declared,
          host_permissions: host.filter((permission) => permission !== removed),
        };
        expect(() => assertLeastPrivilegePermissions(tampered, [])).toThrow(/to deeply equal/);
      });

      it('rejects a declared removal with an empty reason', () => {
        // A declaration without a reason is an undeclared removal in disguise.
        const host = declaredHostPermissions();
        const removed = 'http://127.0.0.1:27123/*';
        expect(host).toContain(removed);
        const tampered: UserManifest = {
          ...declared,
          host_permissions: host.filter((permission) => permission !== removed),
        };
        expect(() =>
          assertLeastPrivilegePermissions(tampered, [{ permission: removed, reason: '   ' }]),
        ).toThrow(/non-empty reason/);
      });

      it('rejects a declared removal for a non-localhost permission', () => {
        // The relaxation is localhost-scoped: AI provider domains stay
        // mandatory and cannot be removed by declaration.
        const removed = 'https://api.openai.com/*';
        expect(declaredHostPermissions()).toContain(removed);
        expect(() =>
          expectedHostPermissionsAllowingDeclaredRemovals([
            { permission: removed, reason: 'least privilege cut' },
          ]),
        ).toThrow(/only localhost/);
      });
    });
  });
});
