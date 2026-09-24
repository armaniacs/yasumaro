/**
 * tagClusterColor.ts
 * Stable per-tag hue for the tag-cluster time-compare panel
 * (PBI 2026-09-24-08). A tag string always maps to the same hue, so a tag
 * common to both snapshots renders in the same color on the left and right.
 */

/**
 * WHY these fixed S/L values: the dashboard panel background is #ffffff in
 * light scheme (--color-bg-white). The contrast worst case across hues is
 * yellow (~60°); hsl(60, 65%, 28%) measures 4.81:1 on white and every other
 * hue is darker, so all hues clear the WCAG AA 4.5:1 requirement. The dark
 * scheme (--color-bg-white: #0d1117) inverts the constraint: 72% lightness
 * keeps the same hue family readable there (hsl(60, 55%, 72%) ≈ 14:1 on
 * #0d1117; the worst dark-scheme hue is blue at ~5.6:1). Saturation stays
 * fixed per scheme; only lightness flips, so a tag keeps its hue identity.
 */
export const TAG_COMPARE_SATURATION_LIGHT = 65;
export const TAG_COMPARE_LIGHTNESS_LIGHT = 28;
export const TAG_COMPARE_SATURATION_DARK = 55;
export const TAG_COMPARE_LIGHTNESS_DARK = 72;

/**
 * FNV-1a 32-bit string hash. Deterministic across sessions and platforms;
 * Math.imul keeps the 32-bit multiply exact for any input length.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Maps a tag to a stable hue in [0, 360). Same tag → same hue, always. */
export function tagHue(tag: string): number {
  return fnv1a32(tag) % 360;
}

/**
 * Light-scheme fill for a tag. The panel sets the hue as a CSS custom
 * property (--tag-hue) so dashboard.css can pick the scheme-appropriate
 * lightness; this string form exists for callers that need the resolved
 * light-mode color directly (e.g. tests, non-CSS contexts).
 */
export function tagHslColor(tag: string): string {
  return `hsl(${tagHue(tag)}, ${TAG_COMPARE_SATURATION_LIGHT}%, ${TAG_COMPARE_LIGHTNESS_LIGHT}%)`;
}
