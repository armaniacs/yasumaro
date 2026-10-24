/**
 * cssThemeContract.test.ts
 *
 * Comprehensive safety net for the extension stylesheets' color theming.
 * An earlier incident (white-on-white onboarding banner in dark mode) was
 * caused by `var(--color-surface, #ffffff)` where --color-surface was never
 * defined: the background kept its light fallback while the text switched to
 * dark-mode colors. A follow-up scan found 13 more undefined theme variables
 * of the same class. jsdom does not resolve stylesheets, so none of the
 * existing DOM tests can see these mistakes — this file reads the CSS
 * instead, following the precedent of statusMessageCssContract.test.ts.
 *
 * Three independent nets (all scheme-aware):
 *   1. coverage — every --color-* / --ym-color-* token referenced anywhere
 *      must be defined somewhere (a fallback does NOT count as a definition).
 *   2. opaque fallback — an undefined token must not hide behind a fixed
 *      light color fallback (the exact white-on-white pattern).
 *   3. contrast — curated text/background pairs must keep WCAG AA (4.5:1)
 *      in both light and dark schemes, resolved through the var() chains.
 *
 * Per-selector pins for the onboarding banner itself live in
 * src/dashboard/__tests__/onboardingBannerTheme.test.ts; this file owns the
 * generic engine plus the contrast pairs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Stylesheets in cascade order for the options page (dashboard.css @imports
 *  tokens/wizard/confirmDialog first; models-dev-dialog.css is linked after). */
const OPTIONS_FILES = [
  'src/styles/tokens.css',
  'src/styles/wizard.css',
  'src/styles/confirmDialog.css',
  'entrypoints/options/dashboard.css',
  'entrypoints/options/models-dev-dialog.css',
];

/** Extra stylesheets only scanned for the coverage nets (popup page). */
const COVERAGE_EXTRA_FILES = ['entrypoints/popup/styles.css'];

type Zone = 'base' | 'light' | 'dark';

interface RuleEntry {
  sels: string[];
  decls: Map<string, string>;
  zone: Zone;
  file: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function zoneOf(condition: string): Zone {
  if (condition.includes('prefers-color-scheme')) {
    return condition.includes('dark') ? 'dark' : 'light';
  }
  return 'base';
}

/** Split top-level @media blocks out, keeping document order. */
function splitMedia(css: string): Array<{ condition: string | null; body: string }> {
  const parts: Array<{ condition: string | null; body: string }> = [];
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) {
      parts.push({ condition: null, body: css.slice(i) });
      break;
    }
    parts.push({ condition: null, body: css.slice(i, at) });
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    parts.push({ condition: css.slice(at, open), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return parts;
}

/** Split declarations on top-level semicolons (data-URI svg in url() holds some). */
function splitDecls(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ';' && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

function parseEntries(rel: string, css: string): RuleEntry[] {
  const entries: RuleEntry[] = [];
  // @import lines carry no declarations but would otherwise merge into the
  // selector text of the first rule (@import must precede all rules, so the
  // light :root that follows them is the usual victim).
  const scrubbed = stripComments(css).replace(/@import[^;]+;/g, '');
  for (const part of splitMedia(scrubbed)) {
    const zone = part.condition === null ? 'base' : zoneOf(part.condition);
    for (const match of part.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = (match[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const first = sels[0] ?? '';
      if (sels.length === 0 || first.startsWith('@')) continue;
      const decls = new Map<string, string>();
      for (const decl of splitDecls(match[2] ?? '')) {
        const colon = decl.indexOf(':');
        if (colon === -1) continue;
        const prop = decl.slice(0, colon).trim();
        const value = decl.slice(colon + 1).trim();
        if (prop !== '' && value !== '') decls.set(prop, value);
      }
      entries.push({ sels, decls, zone, file: rel });
    }
  }
  return entries;
}

interface VarUse {
  name: string;
  fallback: string | null;
  file: string;
}

/** Parse one var(...) reference starting at `start` (balanced parens). */
function parseVarRef(text: string, start: number): { name: string; fallback: string | null; end: number } | null {
  const open = text.indexOf('(', start);
  if (open === -1) return null;
  let depth = 1;
  let i = open + 1;
  let quote: string | null = null;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
    }
    i += 1;
  }
  if (depth !== 0) return null;
  const inner = text.slice(open + 1, i - 1);
  let comma = -1;
  let d2 = 0;
  let q2: string | null = null;
  for (let k = 0; k < inner.length; k += 1) {
    const ch = inner[k];
    if (q2 !== null) {
      if (ch === q2) q2 = null;
    } else if (ch === '"' || ch === "'") {
      q2 = ch;
    } else if (ch === '(') {
      d2 += 1;
    } else if (ch === ')') {
      d2 -= 1;
    } else if (ch === ',' && d2 === 0) {
      comma = k;
      break;
    }
  }
  const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
  const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
  if (!/^--[\w-]+$/.test(name)) return null;
  return { name, fallback: fallback === '' ? null : fallback, end: i };
}

function collectVarUses(rel: string, css: string): VarUse[] {
  const uses: VarUse[] = [];
  const clean = stripComments(css);
  let idx = 0;
  while (idx < clean.length) {
    const at = clean.indexOf('var(', idx);
    if (at === -1) break;
    const ref = parseVarRef(clean, at);
    if (ref === null) {
      idx = at + 4;
      continue;
    }
    uses.push({ name: ref.name, fallback: ref.fallback, file: rel });
    idx = ref.end;
  }
  return uses;
}

const isThemeToken = (name: string): boolean => name.startsWith('--color-') || name.startsWith('--ym-color-');

const optionEntries: RuleEntry[] = OPTIONS_FILES.flatMap((rel) =>
  parseEntries(rel, readFileSync(join(REPO_ROOT, rel), 'utf-8'))
);

const allEntries: RuleEntry[] = [...optionEntries, ...COVERAGE_EXTRA_FILES.flatMap((rel) =>
  parseEntries(rel, readFileSync(join(REPO_ROOT, rel), 'utf-8'))
)];

const allUses: VarUse[] = [...OPTIONS_FILES, ...COVERAGE_EXTRA_FILES].flatMap((rel) =>
  collectVarUses(rel, readFileSync(join(REPO_ROOT, rel), 'utf-8'))
);

/** Last definition wins; dark scheme layers dark-zone rules over base, light
 *  scheme layers light-zone rules over base (other @media kinds count as base). */
function buildDefs(scheme: 'light' | 'dark', entries: RuleEntry[]): Map<string, string> {
  const defs = new Map<string, string>();
  for (const e of entries) {
    if (e.zone !== 'base' && e.zone !== scheme) continue;
    for (const [prop, value] of e.decls) {
      if (prop.startsWith('--')) defs.set(prop, value);
    }
  }
  return defs;
}

function resolveValue(raw: string, defs: Map<string, string>, guard = 0): string {
  if (guard > 25) throw new Error(`var() chain too deep (circular?): ${raw}`);
  let out = raw;
  for (;;) {
    const at = out.indexOf('var(');
    if (at === -1) return out;
    const ref = parseVarRef(out, at);
    if (ref === null) return out;
    const replacement = defs.has(ref.name)
      ? (defs.get(ref.name) as string)
      : (ref.fallback ?? `var(${ref.name})`);
    out = out.slice(0, at) + replacement + out.slice(ref.end);
    guard += 1;
    if (guard > 25) throw new Error(`var() chain too deep (circular?): ${raw}`);
  }
}

function propOf(sel: string, prop: string, scheme: 'light' | 'dark'): string | null {
  let found: string | null = null;
  for (const e of optionEntries) {
    if (e.zone !== 'base' && e.zone !== scheme) continue;
    if (!e.sels.includes(sel)) continue;
    const v = e.decls.get(prop);
    if (v !== undefined) found = v;
  }
  return found;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(input: string): Rgb {
  const s = input.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex !== null) {
    const h = hex[1] ?? '';
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = s.match(/^(rgba?|hsla?)\(\s*([^)]+)\s*\)$/);
  if (fn !== null) {
    const kind = fn[1] ?? '';
    const channels = fn[2] ?? '';
    const nums = channels.split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (kind.startsWith('h')) throw new Error(`hsl() not supported in test resolver: ${input}`);
    if (nums.length < 3 || nums.some(Number.isNaN)) throw new Error(`unparseable color: ${input}`);
    // Length is checked above, so these defaults never fire at runtime.
    const [r = 0, g = 0, b = 0, a = 1] = nums;
    return { r, g, b, a };
  }
  if (s === 'white' || s === '#fff') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black' || s === '#000') return { r: 0, g: 0, b: 0, a: 1 };
  throw new Error(`unsupported color literal: ${input}`);
}

/** First color token inside a resolved background value (skips gradients/urls). */
function firstColor(resolved: string): string {
  const m = resolved.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\bwhite\b|\bblack\b/);
  if (m === null) throw new Error(`no color found in resolved background: ${resolved}`);
  return m[0];
}

function blendOver(fg: Rgb, bg: Rgb): Rgb {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance(c: Rgb): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = luminance(blendOver(fg, bg));
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function isOpaqueColorLiteral(fallback: string): boolean {
  const s = fallback.trim().toLowerCase();
  if (s === '' || s.includes('var(')) return false;
  if (s === 'transparent' || s === 'currentcolor' || s === 'inherit' || s === 'initial') return false;
  if (/^#[0-9a-f]{3,8}$/.test(s)) return true;
  const fn = s.match(/^(rgba?|hsla?)\(\s*([^)]+)\s*\)$/);
  if (fn !== null) {
    const channels = fn[2] ?? '';
    const parts = channels.split(/[\s,\/]+/).filter(Boolean);
    const alphaPart = parts[3];
    const alpha = alphaPart === undefined ? 1 : Number(alphaPart);
    return !(alpha < 1);
  }
  return /^[a-z]+$/.test(s);
}

interface ContrastPair {
  label: string;
  fgSel: string;
  fgProp: string;
  bgSel: string;
  bgProp: string;
}

const CONTRAST_PAIRS: ContrastPair[] = [
  { label: 'body text', fgSel: 'body', fgProp: 'color', bgSel: 'body', bgProp: 'background' },
  { label: 'panel description', fgSel: '.panel-description', fgProp: 'color', bgSel: '.content-area', bgProp: 'background' },
  { label: 'onboarding intro', fgSel: '.onboarding-banner-head p', fgProp: 'color', bgSel: '.onboarding-banner', bgProp: 'background' },
  { label: 'onboarding choice title', fgSel: '.onboarding-choice-title', fgProp: 'color', bgSel: '.onboarding-choice', bgProp: 'background' },
  { label: 'onboarding choice description', fgSel: '.onboarding-choice-desc', fgProp: 'color', bgSel: '.onboarding-choice', bgProp: 'background' },
  { label: 'secondary button', fgSel: '.secondary-btn', fgProp: 'color', bgSel: '.secondary-btn', bgProp: 'background' },
  { label: 'help text', fgSel: '.help-text', fgProp: 'color', bgSel: '.help-text', bgProp: 'background' },
];

describe('cssThemeContract', () => {
  describe('token coverage', () => {
    it('resolves every color token used across stylesheets to a definition', () => {
      const defined = new Set<string>();
      for (const e of allEntries) {
        for (const prop of e.decls.keys()) {
          if (isThemeToken(prop)) defined.add(prop);
        }
      }
      const missing = new Map<string, string[]>();
      for (const use of allUses) {
        if (!isThemeToken(use.name) || defined.has(use.name)) continue;
        const files = missing.get(use.name) ?? [];
        if (!files.includes(use.file)) files.push(use.file);
        missing.set(use.name, files);
      }
      expect(
        [...missing.entries()].map(([name, files]) => `${name} (used in ${files.join(', ')})`),
        'Every --color-*/--ym-color-* reference must be defined; a fallback is not a definition.'
      ).toEqual([]);
    });

    it('never hides an undefined token behind a fixed light color fallback', () => {
      const defined = new Set<string>();
      for (const e of allEntries) {
        for (const prop of e.decls.keys()) {
          if (isThemeToken(prop)) defined.add(prop);
        }
      }
      const offenders = allUses
        .filter((u) => isThemeToken(u.name) && !defined.has(u.name) && u.fallback !== null && isOpaqueColorLiteral(u.fallback))
        .map((u) => `${u.name} with fallback ${u.fallback} in ${u.file}`);
      expect(offenders, 'Undefined token + opaque fallback renders one scheme correctly and the other wrong.').toEqual([]);
    });

    it('keeps dark-mode token overrides typo-free', () => {
      const light = new Set<string>();
      const darkOnly = new Set<string>();
      for (const e of allEntries) {
        for (const prop of e.decls.keys()) {
          if (!isThemeToken(prop)) continue;
          if (e.zone === 'dark') {
            darkOnly.add(prop);
          } else {
            light.add(prop);
          }
        }
      }
      const unknown = [...darkOnly].filter((n) => !light.has(n));
      expect(unknown, 'Dark override of a token that has no light definition is a typo.').toEqual([]);
    });
  });

  describe('contrast', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const pair of CONTRAST_PAIRS) {
        it(`keeps WCAG AA contrast for ${pair.label} in ${scheme} mode`, () => {
          const defs = buildDefs(scheme, optionEntries);
          const fgRaw = propOf(pair.fgSel, pair.fgProp, scheme);
          const bgRaw = propOf(pair.bgSel, pair.bgProp, scheme);
          expect(fgRaw, `${pair.fgSel} { ${pair.fgProp} } must exist`).not.toBeNull();
          expect(bgRaw, `${pair.bgSel} { ${pair.bgProp} } must exist`).not.toBeNull();
          const fg = parseColor(resolveValue(firstColor(resolveValue(fgRaw as string, defs)), defs));
          const bg = parseColor(resolveValue(firstColor(resolveValue(bgRaw as string, defs)), defs));
          const ratio = contrastRatio(fg, bg);
          expect(
            ratio,
            `${pair.label} in ${scheme}: fg ${fgRaw} on bg ${bgRaw} = ${ratio.toFixed(2)}:1, want >= 4.5:1.`
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  });
});
