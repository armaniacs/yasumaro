// @layer 0 — Foundation: SVG namespace constant (SSOT)
/**
 * svgNamespace.ts
 * The one SVG namespace every `createElementNS` call site passes.
 *
 * Lives in utils rather than next to a single renderer because the namespace
 * is DOM-free (a plain string) and the draw sites are spread across layers:
 * a dashboard-root file importing from `dashboard/panels/` would invert the
 * layer direction (dev-docs/LAYERS.md).
 */
export const SVG_NS = 'http://www.w3.org/2000/svg';
