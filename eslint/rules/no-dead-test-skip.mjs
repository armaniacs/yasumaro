/**
 * Reports a permanently-skipped test: a declaration-form `X.skip('name', fn)` or
 * `X.fixme('name', fn)`.
 *
 * A declaration-form skip never runs, so it keeps the suite green while its
 * coverage silently disappears — no failure notification, no TODO/FIXME marker
 * and no PBI picks it up. Ten such skips accumulated between 2026-03 and
 * 2026-10 (PBI 2026-10-12-02/03); the suite stayed green the whole time.
 *
 * What stays allowed (runtime-conditional forms — the skip is a real decision,
 * not a name on a dead body):
 *   test.skip(testInfo.project.name !== 'firefox', 'firefox-only smoke')
 *   test.skip(true, HEADLESS_FIXME_MESSAGE)
 *   if (!process.env.CI && !process.env.DISPLAY) { test.skip(true, '...'); }
 *   describe.skipIf(!distExists)('WXT Build Output', () => {})
 *   test.skip('requires headed Chrome with display')  // Playwright runtime form
 *
 * Discriminator: the reported call must be static in both shape and name.
 * `it`/`test` are reported only when the first argument is a string literal
 * AND the call has two or more arguments, so the single-string Playwright
 * runtime form (`test.skip('reason')`) and the conditional form
 * (`test.skip(cond, reason)`) stay valid. `describe` suites are reported when
 * the first argument is a string literal (a suite has no runtime single-string
 * form). `skipIf` is a different method and never matches; `describe.skip` as a
 * property reference (not a call) is not this rule's business; a `.skip()` on a
 * non-test object (arrays, streams) is never reported because the receiver must
 * be the `it` / `test` / `describe` root.
 *
 * Limitation: the receiver is matched by its literal name, so an aliased import
 * (`import { test as t }`) would slip past. Local shadowing is the same kind of
 * literal-name limitation: a variable named `it`, `test` or `describe` (e.g.
 * `for (const it of items) { it.skip('x', fn); }`) matches by name just the
 * same, so a shadowed binding can draw a false report or hide a genuine skip.
 * The repo imports test APIs under their literal names and shadows none of
 * them; revisit if that changes.
 *
 * To allow a genuine declaration-form skip at this site, opt out on the line
 * above the call:
 *   // eslint-disable-next-line local/no-dead-test-skip -- <why this stays dead>
 */

const TEST_API_ROOTS = new Set(['it', 'test', 'describe']);

/**
 * Walks the callee's member chain and returns { root, members }.
 * `it.skip.each([...])(...)` -> { root: 'it', members: ['skip', 'each'] }
 * `test.describe.skip(...)`  -> { root: 'test', members: ['skip', 'describe'] }
 * Returns null when the chain is not rooted at an identifier (e.g. a bare
 * `skip()` call or a computed member).
 */
function classifyCallee(callee) {
  // `it.skip.each([...])(...)`: the each() wrapper is a CallExpression whose
  // callee carries the member chain — unwrap the chained calls first.
  while (callee.type === 'CallExpression') {
    callee = callee.callee;
  }
  if (callee.type !== 'MemberExpression') return null;

  const members = [];
  let node = callee;
  while (node.type === 'MemberExpression') {
    if (node.property.type !== 'Identifier') return null;
    members.unshift(node.property.name);
    node = node.object;
  }
  if (node.type !== 'Identifier' || members.length === 0) return null;
  return { root: node.name, members };
}

/** A static first argument: a string literal or an expression-less template. */
function isStaticStringName(arg) {
  if (arg === undefined) return false;
  if (arg.type === 'Literal') return typeof arg.value === 'string';
  if (arg.type === 'TemplateLiteral') return arg.expressions.length === 0;
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow declaration-form test skips (X.skip("name", fn) / X.fixme("name", fn)); they never run and hide their coverage behind a green suite.',
    },
    schema: [],
    messages: {
      deadTestSkip:
        'This declaration-form {{method}} never runs: the suite stays green while its coverage disappears, and no failure notification or cleanup marker picks it up. Rewrite the test to match the current contract, delete it when the contract is gone, or disable it with a runtime condition and a reason (test.skip(condition, reason)) so the skip is a real decision. To allow it here anyway, put `// eslint-disable-next-line local/no-dead-test-skip -- <reason>` on the line above this call.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const classified = classifyCallee(node.callee);
        if (!classified) return;

        const { root, members } = classified;
        if (!TEST_API_ROOTS.has(root)) return;

        const skipIndex = members.findIndex((name) => name === 'skip' || name === 'fixme');
        if (skipIndex === -1) return;
        const method = members[skipIndex];
        const isSuiteSkip = members.includes('describe');

        // `it`/`test`: only the declaration form (static name + a body) is
        // reported, so the single-string Playwright runtime form
        // (`test.skip('reason')`) and the conditional form
        // (`test.skip(cond, reason)`) stay valid. A suite skip has no runtime
        // form, so a static name is enough.
        const isDeclarationForm = isSuiteSkip
          ? isStaticStringName(node.arguments[0])
          : node.arguments.length >= 2 && isStaticStringName(node.arguments[0]);
        if (!isDeclarationForm) return;

        context.report({ node, messageId: 'deadTestSkip', data: { method } });
      },
    };
  },
};
