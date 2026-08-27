/**
 * similarity.ts
 * Shared Jaccard similarity for word sets produced by tokenizer.ts.
 */

/**
 * Calculate Jaccard similarity between two word sets.
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}
