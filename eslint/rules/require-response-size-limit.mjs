/**
 * ESLint rule: require-response-size-limit
 *
 * Detects response.text() calls that are not preceded by a
 * Content-Length check or size limit guard.
 *
 * Uses AST-based detection to find size validation patterns in preceding statements.
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

    /**
     * Check if a node is a statement type
     */
    function isStatement(node) {
      return (
        node.type === 'VariableDeclaration' ||
        node.type === 'ExpressionStatement' ||
        node.type === 'IfStatement' ||
        node.type === 'ReturnStatement' ||
        node.type === 'ThrowStatement' ||
        node.type === 'ForStatement' ||
        node.type === 'WhileStatement' ||
        node.type === 'DoWhileStatement' ||
        node.type === 'SwitchStatement' ||
        node.type === 'TryStatement'
      );
    }

    /**
     * Find the enclosing block (function or block statement)
     */
    function findEnclosingBlock(ancestors) {
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const ancestor = ancestors[i];
        if (
          ancestor.type === 'FunctionDeclaration' ||
          ancestor.type === 'FunctionExpression' ||
          ancestor.type === 'ArrowFunctionExpression' ||
          ancestor.type === 'BlockStatement' ||
          ancestor.type === 'Program'
        ) {
          return ancestor;
        }
      }
      return null;
    }

    /**
     * Recursively collect all statements that appear before the target node
     */
    function collectPrecedingStatements(node, targetStart, statements) {
      if (!node || typeof node !== 'object') return;

      // If this node is a statement and it's before the target
      if (isStatement(node) && node.range && node.range[1] <= targetStart) {
        statements.push(node);
      }

      // Recurse into child nodes
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && item.type) {
              collectPrecedingStatements(item, targetStart, statements);
            }
          }
        } else if (child && typeof child === 'object' && child.type) {
          collectPrecedingStatements(child, targetStart, statements);
        }
      }
    }

    /**
     * Recursively check if an AST node contains size-related patterns
     */
    function hasSizePattern(node) {
      if (!node || typeof node !== 'object') return false;

      // Check for content-length string literal
      if (node.type === 'Literal' && typeof node.value === 'string') {
        if (/content.?length/i.test(node.value)) return true;
      }

      // Check for identifier names (contentLength, maxSize, sizeLimit, MAX_SIZE)
      if (node.type === 'Identifier') {
        if (/^contentLength$/i.test(node.name)) return true;
        if (/^maxSize$/i.test(node.name)) return true;
        if (/^sizeLimit$/i.test(node.name)) return true;
        if (/^MAX_SIZE$/i.test(node.name)) return true;
        if (/MAX.*SIZE/i.test(node.name)) return true;
      }

      // Check for member expression property names (byteLength)
      if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
        if (/^byteLength$/i.test(node.property.name)) return true;
      }

      // Check for numeric literals that look like byte sizes (1024, 1024*1024, etc.)
      if (node.type === 'Literal' && typeof node.value === 'number') {
        if (node.value === 1024 || node.value >= 1024 * 1024) return true;
      }

      // Recurse into child nodes
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && item.type) {
              if (hasSizePattern(item)) return true;
            }
          }
        } else if (child && typeof child === 'object' && child.type) {
          if (hasSizePattern(child)) return true;
        }
      }

      return false;
    }

    /**
     * Check if there's a size limit check in preceding statements
     */
    function hasSizeLimitCheck(node) {
      const ancestors = sourceCode.getAncestors(node);
      const block = findEnclosingBlock(ancestors);

      if (!block) return false;

      const targetStart = node.range ? node.range[0] : 0;
      const precedingStatements = [];
      collectPrecedingStatements(block, targetStart, precedingStatements);

      // Check each preceding statement for size patterns
      for (const stmt of precedingStatements) {
        if (hasSizePattern(stmt)) return true;
      }

      return false;
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
