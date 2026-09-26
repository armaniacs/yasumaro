/**
 * Reports `vi.useFakeTimers()` with a `toFake` set that also replaces
 * `setImmediate` or `queueMicrotask`.
 *
 * Vitest's default `toFake` covers both, and that starves its own module
 * runner: a test that awaits a dynamic import under a default fake clock hangs
 * until the test timeout. testDir/waitPolicy.ts exports `useTimerClock()` for
 * the narrow fake set that keeps dynamic imports resolvable.
 *
 * Deliberately warn-level, not error. Converting every existing call site is a
 * separate migration, and until it lands an error here would just break the
 * build for code nobody has touched. The point of the warning is to stop the
 * default spelling from spreading further while the backlog is worked down.
 */
const HUNGRY_TIMERS = new Set(['setImmediate', 'queueMicrotask']);

function isViFakeTimersCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'vi' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'useFakeTimers'
  );
}

/** Reads the `toFake` list out of a `vi.useFakeTimers(...)` call, or null when absent. */
function toFakeList(callNode) {
  const options = callNode.arguments[0];
  if (!options || options.type !== 'ObjectExpression') return null;
  const toFake = options.properties.find(
    (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'toFake'
  );
  if (!toFake || toFake.type !== 'Property') return null;
  const value = toFake.value;
  if (!value || value.type !== 'ArrayExpression') return null;
  return value.elements.filter((e) => e && e.type === 'Literal' && typeof e.value === 'string').map((e) => e.value);
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer useTimerClock() over vi.useFakeTimers() with its default toFake.',
    },
    schema: [],
    messages: {
      greedyFakeTimers:
        "vi.useFakeTimers() with its default toFake also replaces setImmediate/queueMicrotask, which hangs any dynamic import awaited under it. Use useTimerClock() from testDir/waitPolicy.ts, or pass an explicit toFake list.",
      greedyFakeTimersMember:
        "toFake includes {{names}}, which starves Vitest's module runner and hangs any dynamic import awaited under it. Use useTimerClock() from testDir/waitPolicy.ts.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isViFakeTimersCall(node)) return;
        const toFake = toFakeList(node);
        if (toFake === null) {
          context.report({ node, messageId: 'greedyFakeTimers' });
          return;
        }
        const greedy = toFake.filter((name) => HUNGRY_TIMERS.has(name));
        if (greedy.length > 0) {
          context.report({ node, messageId: 'greedyFakeTimersMember', data: { names: greedy.join('/') } });
        }
      },
    };
  },
};
