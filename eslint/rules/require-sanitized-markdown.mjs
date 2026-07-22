/**
 * ESLint rule: require-sanitized-markdown
 *
 * Detects template literals that produce markdown output without
 * sanitizing interpolated variables via sanitizeForObsidian() or
 * sanitizeUrlForMarkdownTarget().
 *
 * Works by:
 * 1. Finding CallExpression to sanitizeForObsidian/sanitizeUrlForMarkdownTarget
 * 2. Recording which variables have been sanitized
 * 3. Checking TemplateLiterals containing both `\${...}` and markdown syntax
 * 4. Reporting unsanitized variable usage
 */

const MARKDOWN_PATTERNS = /\[.*?\]\(.*?\)/;
const SANITIZE_FUNCTIONS = new Set(['sanitizeForObsidian', 'sanitizeUrlForMarkdownTarget']);
const INTERNAL_VARS = new Set([
  'timestamp', 'date', 'time', 'tagPrefix', 'finalSanitizedSummary',
  'periodLabel', 'dateStr', 'domain', 'i', 'e',
  'undefined', 'null', 'true', 'false', 'Number', 'String', 'Boolean', 'Date',
]);

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require sanitizeForObsidian() on variables used in markdown template literals',
    },
    messages: {
      unsanitizedMarkdown:
        "Variable '{{name}}' is used in a markdown template literal but not passed through sanitizeForObsidian() or sanitizeUrlForMarkdownTarget().",
      missingImport:
        "File uses markdown template patterns but does not import sanitizeForObsidian from markdownSanitizer.js.",
    },
    schema: [],
  },

  create(context) {
    const sanitizedVars = new Set();
    const unusedSanitizedVars = new Set();
    let hasMarkdownTemplate = false;
    let importsSanitize = false;
    let importNode = null;

    return {
      /** Track import of sanitizeForObsidian */
      ImportDeclaration(node) {
        if (node.source.value.endsWith('markdownSanitizer.js')) {
          const importedNames = node.specifiers
            .filter(s => s.type === 'ImportSpecifier')
            .map(s => s.imported.name);
          if (importedNames.some(name => SANITIZE_FUNCTIONS.has(name))) {
            importsSanitize = true;
            importNode = node;
          }
        }
      },

      /** Track sanitize calls: result variable name */
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && SANITIZE_FUNCTIONS.has(node.callee.name)) {
          // Case 1: VariableDeclarator - const x = sanitizeForObsidian(y)
          const parent = node.parent;
          if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') {
            sanitizedVars.add(parent.id.name);
            return;
          }
          // Case 2: Assignment - x = sanitizeForObsidian(y)
          if (parent && parent.type === 'AssignmentExpression' && parent.left && parent.left.type === 'Identifier') {
            sanitizedVars.add(parent.left.name);
            return;
          }
          // Case 3: Argument tracking (fallback - counts arg variable)
          const arg = node.arguments[0];
          if (arg && arg.type === 'Identifier') {
            sanitizedVars.add(arg.name);
          }
        }
      },

      /** Check template literals for markdown patterns */
      TemplateLiteral(node) {
        const raw = context.sourceCode.getText(node);
        // Skip if no markdown link pattern and no Obsidian wikilink pattern
        if (!raw.includes('- [') && !raw.includes('![') && !raw.includes('[[') && !raw.includes('](')) {
          return;
        }
        hasMarkdownTemplate = true;

        // Check each expression in the template
        node.expressions.forEach((expr) => {
          if (expr.type === 'Identifier') {
            const varName = expr.name;
            // Skip if variable is already sanitized or is an internal var
            if (sanitizedVars.has(varName) || INTERNAL_VARS.has(varName) || varName.startsWith('sanitized') || varName.startsWith('safe')) {
              return;
            }
            // Skip primitive/type-like names
            if (['undefined', 'null', 'true', 'false', 'Number', 'String', 'Boolean', 'Date'].includes(varName)) {
              return;
            }
            // Report unsanitized usage
            context.report({
              node: expr,
              messageId: 'unsanitizedMarkdown',
              data: { name: varName },
            });
          }
        });
      },

      /** Report if file has markdown templates but no sanitize import */
      'Program:exit'() {
        if (hasMarkdownTemplate && !importsSanitize) {
          // Check if it's a test file (test files excluded from rule)
          const filename = context.filename || context.getFilename();
          if (filename.includes('__tests__') || filename.includes('.test.')) {
            return;
          }
          context.report({
            node: context.sourceCode.ast,
            messageId: 'missingImport',
          });
        }
      },
    };
  },
};
