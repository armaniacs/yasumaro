/**
 * cspStyleUtils.ts
 * Safe CSS manipulation utilities for dashboard UI.
 * Prevents CSS injection via elementId or color/width values (H7).
 */

const CSS_IDENTIFIER_ALLOWED = /[^a-zA-Z0-9_-]/g;
const CSS_VALUE_DANGEROUS = /[<>"'`{};()\\]/g;

export function escapeCssIdentifier(value: string): string {
  return value.replace(CSS_IDENTIFIER_ALLOWED, '');
}

export function escapeCssValue(value: string): string {
  return value.replace(CSS_VALUE_DANGEROUS, '');
}

export function setElementColor(elementId: string, color: string): void {
  const safeId = escapeCssIdentifier(elementId);
  const safeColor = escapeCssValue(color);
  const el = document.getElementById(safeId);
  if (!el) return;
  el.style.setProperty('color', safeColor);
}

export function setElementWidth(elementId: string, width: string): void {
  const safeId = escapeCssIdentifier(elementId);
  const safeWidth = escapeCssValue(width);
  const el = document.getElementById(safeId);
  if (!el) return;
  el.style.setProperty('width', safeWidth);
}
