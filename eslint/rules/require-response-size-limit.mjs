/**
 * ESLint rule: require-response-size-limit
 *
 * Detects response.text() calls that are not preceded by a
 * Content-Length check or size limit guard.
 *
 * Works by finding CallExpression where:
 *   - callee.object.name === 'response' (or similar)
 *   - callee.property.name === 'text'
 * Then checks if the preceding statements contain size validation.
 */

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require size limit check before response.text() calls',
    },
    messages: {
      missingSizeLimit:
        'response.text() at line {{line}} is called without a preceding Content-Length check or size limit guard.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    function hasSizeLimitCheck(node) {
      const ancestors = sourceCode.getAncestors(node);
      // Find the enclosing function or block
      const block = ancestors.find(a =>
        a.type === 'FunctionDeclaration' ||
        a.type === 'FunctionExpression' ||
        a.type === 'ArrowFunctionExpression' ||
        a.type === 'BlockStatement' ||
        a.type === 'Program'
      );

      if (!block) return false;

      // Get all tokens in the enclosing scope before this node
      const blockTokens = sourceCode.getTokens(block);
      const nodeStart = node.range ? node.range[0] : 0;
      const precedingTokens = blockTokens.filter(t => t.range && t.range[1] <= nodeStart);
      const precedingText = precedingTokens.map(t => t.value).join(' ');

      // Check for size limit patterns
      const limitPatterns = [
        /content.?length/i,
        /contentLength/i,
        /maxSize/i,
        /MAX_SIZE/i,
        /sizeLimit/i,
        /MAX.*SIZE/i,
        /\d+\s*\*\s*1024\s*\*\s*1024/, // e.g. 5 * 1024 * 1024
        /\.length\s*[<>]/,
        /\.byteLength\s*[<>]/,
      ];

      return limitPatterns.some(p => p.test(precedingText));
    }

    return {
      CallExpression(node) {
        // Match: <something>.text()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'text' &&
          node.callee.object
        ) {
          const objName = node.callee.object.type === 'Identifier' ? node.callee.object.name : '';

          // Skip if not a response-like object
          if (!objName.toLowerCase().includes('response') && objName !== 'res') {
            return;
          }

          if (!hasSizeLimitCheck(node)) {
            const filename = context.filename || context.getFilename();
            // Skip test files
            if (filename.includes('__tests__') || filename.includes('.test.')) {
              return;
            }
            // Skip if this is a mocked response (in test context)
            if (filename.includes('mock') || filename.includes('__mocks__')) {
              return;
            }

            context.report({
              node,
              messageId: 'missingSizeLimit',
              data: { line: node.loc ? node.loc.start.line : 0 },
            });
          }
        }
      },
    };
  },
};
