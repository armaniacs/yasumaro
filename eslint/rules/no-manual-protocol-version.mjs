/**
 * protocolVersion must be stamped by MessageTransport.send(), never by hand.
 *
 * Hand-stamped envelopes bypass validation and retry, and drift from the
 * single protocol source (src/messaging/protocol.ts). Senders use the seam:
 * `messageTransport.send({ type, payload })`.
 *
 * Exemptions, both deliberate:
 * - src/messaging/messageTransport.ts stamps the version itself.
 * - Test files (`__tests__`, `.test.`) construct raw envelopes to exercise
 *   the receiving side (router dispatch, validators); they are the harness,
 *   not production senders.
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'forbid hand-stamped protocolVersion in sendMessage calls',
    },
    messages: {
      noManualVersion:
        'Do not stamp protocolVersion by hand; send through MessageTransport.send() which stamps and validates it. See PBI 2026-09-28-29.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getPhysicalFilename?.() ?? '';
    if (filename.endsWith('src/messaging/messageTransport.ts')) return {};
    if (filename.includes('__tests__') || filename.endsWith('.test.ts')) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        const isSendMessage =
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'sendMessage';
        if (!isSendMessage) return;
        const [firstArg] = node.arguments;
        if (firstArg?.type !== 'ObjectExpression') return;
        const stamped = firstArg.properties.some(
          (p) =>
            p.type === 'Property' &&
            ((p.key.type === 'Identifier' && p.key.name === 'protocolVersion') ||
              (p.key.type === 'Literal' && p.key.value === 'protocolVersion')),
        );
        if (stamped) {
          context.report({ node: firstArg, messageId: 'noManualVersion' });
        }
      },
    };
  },
};
