/**
 * ast-walk.mjs - shared pre-order AST walk for the local rules.
 *
 * One implementation of the "visit every AST node in a subtree" loop that was
 * previously duplicated inline in no-vacuous-negative-wait.mjs,
 * no-test-sleep.mjs, and twice in require-response-size-limit.mjs.
 *
 * - Pre-order: `visit(node)` runs before the children.
 * - `parent`, `range`, and `loc` are skipped: they are bookkeeping, never
 *   match targets, and descending into them only wastes work.
 * - Only nodes carrying a string `type` are visited; array items and
 *   descendants without one are bypassed.
 * - `visit` cannot stop the walk: callers that short-circuit keep their own
 *   flag and no-op inside the callback (the result is the same pre-order
 *   first match).
 */

/**
 * Walk `node` pre-order, calling `visit` on every AST node below it
 * (including `node` itself when it carries a string `type`).
 * @param {unknown} node - AST node (or anything; non-nodes are ignored).
 * @param {(node: object) => void} visit - Called once per AST node.
 */
export function walkAst(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'range' || key === 'loc') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walkAst(c, visit));
    else if (child && typeof child.type === 'string') walkAst(child, visit);
  }
}
