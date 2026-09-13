/**
 * Detects tautological assertions banned by dev-docs/TEST_RULE.md:
 *   expect(true).toBe(true), expect(x).toBe(x), expect(a.b).toBe(a.b), ...
 * A comparison between two identical literals or two identical pure
 * identifier/member chains can never fail, so the assertion carries no
 * regression signal.
 */
const COMPARISON_METHODS = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toBeStrictEqual']);

function getExpectCall(node) {
  // expect(...) may be wrapped in .not/.resolves/.rejects member chains
  let current = node;
  while (current && current.type === 'MemberExpression') {
    current = current.object;
  }
  if (
    current &&
    current.type === 'CallExpression' &&
    current.callee.type === 'Identifier' &&
    current.callee.name === 'expect'
  ) {
    return current;
  }
  return null;
}

function isPureMemberChain(node) {
  // Identifier or a member chain over identifiers only (no calls, no
  // arithmetic) — identical source text implies an identical read.
  if (node.type === 'Identifier') return true;
  if (node.type === 'MemberExpression' && !node.optional) {
    if (node.computed) {
      return node.property.type === 'Literal' && typeof node.property.value === 'string' && isPureMemberChain(node.object);
    }
    return node.property.type === 'Identifier' && isPureMemberChain(node.object);
  }
  return false;
}

function isSameLiteral(a, b) {
  if (a.type !== 'Literal' || b.type !== 'Literal') return false;
  return typeof a.value === typeof b.value && a.value === b.value;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow tautological expect() assertions (dev-docs/TEST_RULE.md)',
    },
    schema: [],
    messages: {
      tautological:
        'Tautological assertion: expect(A).{{method}}(A) can never fail. Assert a real result, state change, or call effect (dev-docs/TEST_RULE.md).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        const method = callee.property.name;
        if (!COMPARISON_METHODS.has(method)) return;

        const expectCall = getExpectCall(callee.object);
        if (!expectCall || expectCall.arguments.length === 0) return;
        const expected = node.arguments[0];
        if (!expected) return;

        const actual = expectCall.arguments[0];
        const sameLiteral = isSameLiteral(actual, expected);
        const samePureExpression =
          !sameLiteral &&
          isPureMemberChain(actual) &&
          isPureMemberChain(expected) &&
          context.sourceCode.getText(actual) === context.sourceCode.getText(expected);

        if (sameLiteral || samePureExpression) {
          context.report({ node, messageId: 'tautological', data: { method } });
        }
      },
    };
  },
};
