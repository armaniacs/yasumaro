/**
 * piiStripper.ts — Deprecated shim.
 * PII stripping now lives in src/background/pipeline/piiBoundary.ts (single boundary).
 * This file re-exports from piiBoundary for backward compatibility and will be
 * removed after one release.
 * @deprecated Use `src/background/pipeline/piiBoundary.js` instead.
 */

export { stripPiiFromMaskedItems, stripPiiFromMaskedItem } from '../background/pipeline/piiBoundary.js';