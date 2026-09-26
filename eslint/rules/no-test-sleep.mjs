/**
 * Bans fixed-duration sleeps in test files:
 *
 *   await new Promise((resolve) => setTimeout(resolve, 50));
 *
 * A sleep cannot fail, so it proves nothing; it only burns wall time, and on a
 * loaded machine it is the difference between green and flaky. Tests must wait
 * for a condition instead (vi.waitFor for a mock to be called, or a fake clock
 * when a production timer is the subject).
 *
 * The delay is resolved through const bindings, so the `const DELAY_MS = 30;
 * setTimeout(fn, DELAY_MS)` spelling is caught as well. Anything that cannot be
 * resolved to a number (a parameter, a mutable `let`, a computed value) is
 * left alone rather than guessed at.
 *
 * Opt out only with a stated reason, per AGENTS.md:
 *   // eslint-disable-next-line local/no-test-sleep -- <why no condition exists>
 *
 * See dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md
 */
const DEFAULT_THRESHOLD_MS = 20;

function isPromiseConstructor(node) {
  return node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'Promise';
}

/**
 * Resolves a numeric delay through local const bindings. `const` cannot be
 * reassigned, so the binding's value is exactly its initialiser by the time
 * the delay is read.
 *
 * The memo is keyed by identifier NODE, not by name. Two same-named consts in
 * one file (`const DELAY_MS = 5` in one function, `const DELAY_MS = 50` in
 * another) are different bindings, and keying by name let the first resolution
 * stand in for the second — which hid a real 50ms sleep entirely.
 */
function createDelayResolver(sourceCode) {
  const cache = new Map();

  function lookup(identifier) {
    for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
      const variable = scope.set.get(identifier.name);
      if (!variable) continue;

      const definition = variable.defs[0];
      const init = definition?.type === 'Variable' ? definition.node.init : null;
      const isConst = variable.defs.length === 1 && definition.parent?.kind === 'const';
      return isConst && init?.type === 'Literal' && typeof init.value === 'number' ? init.value : undefined;
    }
    return undefined;
  }

  return function resolveDelay(node) {
    if (!node) return undefined;
    if (node.type === 'Literal') return typeof node.value === 'number' ? node.value : undefined;
    if (node.type !== 'Identifier') return undefined;
    if (!cache.has(node)) cache.set(node, lookup(node));
    return cache.get(node);
  };
}

/** Finds `setTimeout(<resolver>, <resolvable literal>)` anywhere inside a function body. */
function findFixedSleep(fnNode, resolveDelay) {
  let found = null;
  const visit = (node) => {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'setTimeout') {
      const delay = resolveDelay(node.arguments[1]);
      if (delay !== undefined && delay >= DEFAULT_THRESHOLD_MS) {
        found = node;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  for (const param of fnNode.params) {
    if (param && typeof param.type === 'string') visit(param);
  }
  if (fnNode.body) visit(fnNode.body);
  return found;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow fixed-duration sleeps in tests; wait for a condition instead.',
    },
    schema: [],
    messages: {
      fixedSleep:
        'Fixed sleep of {{ms}}ms in a test cannot fail and only costs wall time. Wait for the condition (waitForMock / useTimerClock / drainMacrotask from testDir/waitPolicy.ts), or disable this line with a stated reason.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const resolveDelay = createDelayResolver(sourceCode);

    return {
      NewExpression(node) {
        if (!isPromiseConstructor(node)) return;
        const factory = node.arguments[0];
        if (!factory || (factory.type !== 'ArrowFunctionExpression' && factory.type !== 'FunctionExpression')) return;
        const sleep = findFixedSleep(factory, resolveDelay);
        if (!sleep) return;
        context.report({ node: sleep, messageId: 'fixedSleep', data: { ms: resolveDelay(sleep.arguments[1]) } });
      },
    };
  },
};
