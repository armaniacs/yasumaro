/**
 * Reports a wait whose only condition is a negative assertion.
 *
 * `vi.waitFor` evaluates its callback synchronously before installing a timer, so
 *   await waitForMock(() => expect(mockSetAll).not.toHaveBeenCalled());
 * returns immediately. The test asserts its own precondition: it passes whether
 * the guard under test held or the handler simply has not run yet, so deleting
 * the guard leaves the suite green. The elapsed wait the condition is wrapped in
 * is what used to give the handler time to finish.
 *
 * A callback that also contains a positive assertion is left alone — the
 * positive anchors the negative, so the pair is a real assertion.
 *
 * A negative that means "wait until this stops being X" is a legitimate retry
 * loop, but no syntactic rule can tell it apart from the defect above. Opt out
 * on the line above the wait itself (the report is anchored to the call, not to
 * the assertion inside it):
 *   // eslint-disable-next-line local/no-vacuous-negative-wait -- <why this is a change-detection wait>
 *   await vi.waitFor(() => expect(el.textContent).not.toBe(marker));
 */
const WAIT_NAMES = new Set(['waitFor', 'waitForMock', 'waitUntil', 'until', 'eventually']);

function isWaitCall(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;

  // vi.waitFor(...) / expect.poll(...) style
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    if (callee.object.type === 'Identifier' && callee.object.name === 'vi' && WAIT_NAMES.has(callee.property.name)) {
      return true;
    }
    if (callee.object.type === 'Identifier' && callee.object.name === 'expect' && callee.property.name === 'poll') {
      return true;
    }
  }

  // bare waitForMock(...) / waitFor(...) imported from a policy helper
  return callee.type === 'Identifier' && WAIT_NAMES.has(callee.name);
}

/**
 * Classifies a matcher call: `expect(x).toBe(y)` is positive,
 * `expect(x).not.toBe(y)` is negative. `expect.soft` is the same shape with one
 * more link in the chain, so the chain is walked down to the expect call and
 * every member name on the way is inspected for `not`.
 */
function classifyMatcher(callee) {
  if (callee.type !== 'MemberExpression') return null;

  const names = [];
  let base = callee;
  while (base.type === 'MemberExpression') {
    if (base.property.type !== 'Identifier') return null;
    names.push(base.property.name);
    base = base.object;
  }
  if (base.type !== 'CallExpression') return null;
  if (names.length === 0) return null;

  const isExpect =
    (base.callee.type === 'Identifier' && base.callee.name === 'expect') ||
    (base.callee.type === 'MemberExpression' &&
      base.callee.object.type === 'Identifier' &&
      base.callee.object.name === 'expect' &&
      base.callee.property.type === 'Identifier' &&
      base.callee.property.name === 'soft');
  if (!isExpect) return null;

  return names.includes('not') ? 'negative' : 'positive';
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
    else if (child && typeof child.type === 'string') walk(child, visit);
  }
}

/** Classifies the assertions inside a wait callback as negative / positive counts. */
function classifyCallback(body) {
  const counts = { negative: 0, positive: 0 };
  walk(body, (node) => {
    if (node.type !== 'CallExpression') return;
    const kind = classifyMatcher(node.callee);
    if (kind) counts[kind] += 1;
  });
  return counts;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow waits whose only condition is a negative assertion; they resolve before anything can change.',
    },
    schema: [],
    messages: {
      vacuousNegativeWait:
        'This wait resolves immediately because its only condition ({{count}} negative assertion(s), no positive anchor) already holds when the callback runs, so it cannot detect a missing guard. Settle first with `await drainMacrotask()` and assert outside the wait, add a positive assertion in the same test, or drive the clock with useTimerClock() + vi.advanceTimersByTimeAsync(). To allow a genuine change-detection wait, put `// eslint-disable-next-line local/no-vacuous-negative-wait -- <reason>` on the line above this call.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isWaitCall(node)) return;
        const callback = node.arguments[0];
        if (!callback) return;
        if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') return;

        const { negative, positive } = classifyCallback(callback.body);
        if (negative === 0 || positive > 0) return;

        context.report({ node, messageId: 'vacuousNegativeWait', data: { count: negative } });
      },
    };
  },
};
