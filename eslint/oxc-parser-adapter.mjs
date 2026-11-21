/**
 * oxc-parser-adapter.mjs
 *
 * Adapts oxc-parser (Rust, ESTree-compatible) into an ESLint parser so the
 * RuleTester suites for the local rules run without @typescript-eslint/parser.
 *
 * Goal: TypeScript 7 drops the `typescript` CJS export that @typescript-eslint/
 * parser (typescript-estree) requires, and its peer pins `typescript <6.1.0`, so
 * keeping typescript-eslint blocks `npm install` on TS7. oxc-parser is already in
 * the tree (via knip) and parses TS natively, so it can replace the TS parser for
 * the rule tests. eslint core itself does not peer on typescript, so ESLint stays
 * as the RuleTester runner; only the TS parser dependency goes away.
 *
 * Two gaps oxc-parser leaves that ESLint's SourceCode requires are filled here:
 *  - loc: oxc emits start/end offsets only. ESLint rules and SourceCode need
 *    `node.loc` (line/column) and `node.range`, so loc is reconstructed from a
 *    line-offset table.
 *  - tokens/comments: ESLint's SourceCode expects `ast.tokens` / `ast.comments`.
 *    The 12 local rules query scope, text, ancestors, parent, options and filename
 *    only — none call the token APIs — so empty tokens are sufficient. A rule that
 *    starts using sourceCode.getTokens* would need a real tokenizer here.
 */
import { parseSync, visitorKeys } from 'oxc-parser';

/** Map a 1-based line start offsets table for loc reconstruction. */
function buildLineMap(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Convert an absolute offset to { line, column } using the line map. */
function locFromOffset(offset, lineMap) {
  let lo = 0;
  let hi = lineMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineMap[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineMap[lo] };
}

/**
 * Decorate every node with `range` and `loc` derived from its start/end offsets.
 * `parent` is intentionally not set: ESLint wires the parent chain itself during
 * traversal, and the local rules read `node.parent` through that, not from the
 * parser output.
 */
function decorate(node, lineMap) {
  if (!node || typeof node.type !== 'string') return;
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    node.range = [node.start, node.end];
    node.loc = {
      start: locFromOffset(node.start, lineMap),
      end: locFromOffset(node.end, lineMap),
    };
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => decorate(c, lineMap));
    else if (child && typeof child.type === 'string') decorate(child, lineMap);
  }
}

/** Pick the oxc language mode from the file extension (default ts). */
function langFor(filePath) {
  if (/\.tsx$/i.test(filePath)) return 'tsx';
  if (/\.jsx$/i.test(filePath)) return 'jsx';
  if (/\.[mc]?js$/i.test(filePath)) return 'js';
  return 'ts';
}

export function parseForESLint(code, options = {}) {
  const filePath = options.filePath || 'file.ts';
  const result = parseSync(filePath, code, { lang: langFor(filePath), range: true });
  if (result.errors && result.errors.length > 0) {
    const first = result.errors[0];
    const err = new Error(`oxc parse error: ${first.message || first}`);
    if (first.start) err.lineNumber = first.start.line;
    throw err;
  }
  const lineMap = buildLineMap(code);
  const program = result.program;
  decorate(program, lineMap);
  // ESLint SourceCode reads these unconditionally; the 12 rules need no tokens.
  program.tokens = program.tokens || [];
  program.comments = (result.comments || []).map((c) => {
    decorate(c, lineMap);
    return c;
  });
  return { ast: program, visitorKeys, services: {}, scopeManager: null };
}

export default { parseForESLint };