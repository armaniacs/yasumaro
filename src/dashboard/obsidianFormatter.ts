/**
 * obsidianFormatter.ts
 * Re-export from utils/markdownFormatter.ts for backward compatibility.
 * Background handlers use utils/markdownFormatter.ts directly to avoid
 * background->dashboard seam leak.
 */

export { formatEntriesToMarkdown } from '../utils/markdownFormatter.js';
