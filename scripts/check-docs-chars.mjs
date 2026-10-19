#!/usr/bin/env node
/**
 * check-docs-chars.mjs — enforce the "Shift-JIS only, plus the enumerated emoji
 * exception" rule for documents (CLAUDE.local.md / AGENTS.md, section
 * "Documentation Characters").
 *
 * Why a script and not a paragraph: the rule names an exact character set. A
 * prose-only rule drifts the moment someone adds a symbol, and counting 3,000+
 * occurrences by hand is not reviewable. This runs the same check an author can
 * run locally:
 *
 *   node scripts/check-docs-chars.mjs          # report violations
 *   node scripts/check-docs-chars.mjs --list   # also list every offender char
 *
 * Exit code 1 when something outside the allowed set is found.
 *
 * Two kinds of violations are reported separately:
 *   - corruption: Hangul / Simplified Chinese / U+FFFD / Arabic. These are
 *     mojibake, fixed by rewriting the sentence (PBI 2026-10-19-13), never by
 *     widening the exception list.
 *   - substitution: a character that has a Shift-JIS equivalent (see the rule's
 *     mapping table). Fix by replacing it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Characters the product itself renders; quoting them is the point. */
const PRODUCT_GLYPHS = new Set(['∉', '⏎']);

/**
 * Codepoints JIS X 0208 contains but CP932 maps elsewhere (the classic
 * JIS-vs-CP932 divergence: 0x8160 is 〜 in JIS, ～ in CP932). The rule allows
 * "JIS X 0208 / CP932", so these stay legal. Control characters are allowed too;
 * the rule is about visible text.
 */
const JIS_ONLY = new Set(['\t', '\r', '\n', '〜', '−', '‖', '∥', '¢', '£', '¬']);

/** The enumerated emoji exception (68) + any flag + presentation modifiers. */
const EMOJI = new Set(
  '✅🟡🟢🎯🔴✓🔧⬜❌⚙🔒📝✗⚠📋🔵🔶🤖♻🧹📊🏷🌐✨' +
    '🛡🚧🖱🗄💡🐛📱🚫☁📌📦🔐🔍❓⛅🌨✕☰🎉📂✏🔔🙏' +
    '🚀⛔📈🕸📉🖥🗑🦋📜🟣🗂📖💎🔗🔓😀🧪⏳⏸▶🦄' +
    '\uFE0F\u20E3',
);
// Any national flag is allowed: a pair of regional indicators (U+1F1E6..U+1F1FF).
for (let cp = 0x1f1e6; cp <= 0x1f1ff; cp += 1) EMOJI.add(String.fromCodePoint(cp));

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.wxt',
  'graphify-out',
  '.superpowers',
  '.kilo',
  '.checking-team-tmp',
  'plans',
  'bench',
]);

/** Author-written documents only (generated files and rule files are excluded). */
function inScope(relPath) {
  if (relPath === 'THIRD_PARTY_NOTICES.md') return false;
  // The rule files quote the forbidden characters, and CLAUDE.md is a symlink to
  // AGENTS.md, so all three are out of scope.
  if (relPath === 'CLAUDE.local.md' || relPath === 'AGENTS.md' || relPath === 'CLAUDE.md') return false;
  if (relPath.endsWith('.md') && !relPath.includes('/')) return true;
  return (
    relPath.startsWith('pbi/') ||
    relPath.startsWith('dev-docs/') ||
    relPath.startsWith('docs/') ||
    relPath.startsWith('public/') // PRIVACY.md is user-facing and must stay byte-identical to docs/PRIVACY.md
  );
}

function classify(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0xac00 && cp <= 0xd7af) return 'corruption';
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) return 'corruption';
  if (cp === 0xfffd) return 'corruption';
  if (cp >= 0x0600 && cp <= 0x06ff) return 'corruption';
  return 'substitution';
}

function isShiftJis(ch) {
  try {
    // TextEncoder has no Shift-JIS; test against a CP932 table shipped with
    // Node's ICU via TextDecoder round-trip would be lossy, so use the same
    // practical check the rule documents: encode through a CP932 decoder.
    return cp932.has(ch);
  } catch {
    return false;
  }
}

/**
 * CP932 membership without a dependency: decode every byte pair/lone byte once.
 * Built lazily on first use (the table is ~10k entries).
 */
const cp932 = (() => {
  const set = new Set();
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  const tryDecode = (bytes) => {
    try {
      const text = decoder.decode(Uint8Array.from(bytes));
      if (text.length === 1 && text !== '\ufffd') set.add(text);
    } catch {
      /* not a valid CP932 sequence */
    }
  };
  for (let b = 0x20; b <= 0x7e; b += 1) tryDecode([b]);
  for (let b = 0xa1; b <= 0xdf; b += 1) tryDecode([b]);
  for (let hi = 0x81; hi <= 0xfc; hi += 1) {
    for (let lo = 0x40; lo <= 0xfc; lo += 1) {
      if (lo === 0x7f) continue;
      tryDecode([hi, lo]);
    }
  }
  return set;
})();

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = abs.replace(/^\.\//, '');
    if (statSync(abs).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(abs, out);
      continue;
    }
    if (name.endsWith('.md') && inScope(rel)) out.push(abs);
  }
  return out;
}

const showAll = process.argv.includes('--list');
const files = walk('.', []);
const found = new Map(); // char -> { kind, count, first }
let filesWithHits = 0;

for (const file of files) {
  let hits = 0;
  let lineNo = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    lineNo += 1;
    for (const ch of line) {
      if (ch === '\r' || EMOJI.has(ch) || PRODUCT_GLYPHS.has(ch) || JIS_ONLY.has(ch)) continue;
      if (isShiftJis(ch)) continue;
      hits += 1;
      const prev = found.get(ch);
      if (prev) prev.count += 1;
      else found.set(ch, { kind: classify(ch), count: 1, first: `${file}:${lineNo}` });
    }
  }
  if (hits > 0) filesWithHits += 1;
}

const corruption = [...found].filter(([, v]) => v.kind === 'corruption');
const substitution = [...found].filter(([, v]) => v.kind === 'substitution');
const sum = (list) => list.reduce((acc, [, v]) => acc + v.count, 0);

const describe = (list) =>
  [...list]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([ch, v]) => `  ${JSON.stringify(ch)} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} x${v.count}  first: ${v.first}`)
    .join('\n');

console.log(`docs: ${files.length} files scanned, ${filesWithHits} with violations`);
if (showAll || substitution.length) {
  console.log(`\nsubstitution needed: ${sum(substitution)} occurrences (${substitution.length} distinct)`);
  if (showAll) console.log(describe(substitution));
}
if (showAll || corruption.length) {
  console.log(`\ncorruption (fix the sentence, do not exempt): ${sum(corruption)} occurrences (${corruption.length} distinct)`);
  if (showAll) console.log(describe(corruption));
}
if (!substitution.length && !corruption.length) {
  console.log('OK: every character is Shift-JIS, an enumerated emoji, or a quoted product glyph');
  process.exit(0);
}
process.exit(1);
