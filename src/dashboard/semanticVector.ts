/**
 * semanticVector.ts
 *
 * Tiny local vectorizer (PBI 2026-10-22-03, slice: embedding selection).
 * No WASM embedding asset exists in the tree and external APIs are forbidden,
 * so semantic recall rides on character-trigram SET vectors with cosine
 * similarity: fully local, zero asset, deterministic, dependency-free.
 *
 * Why sets, not hashed fixed-dim vectors (selection record lives in the PBI):
 * the first cut hashed trigrams into 512 FNV-1a buckets, but short Japanese
 * queries (~10 trigrams) are collision-dominated — long unrelated English
 * docs outscored the relevant docs by chance bucket hits (q-resume ranked
 * both relevant docs 8th-9th of 12 on the vector side, demoting the FTS hit
 * out of the fused top 3). Title+summary yields at most ~200 trigrams, so
 * exact sets cost nothing and remove the noise entirely. Trigrams still give
 * the paraphrase tolerance Jaccard lacks (WASM vs WebAssembly share "was" /
 * "asm"; unspaced Japanese shares substrings where token-exact overlap
 * scores 0). Empty text maps to the empty set and every similarity against
 * it is 0 (never NaN).
 */

export type SemanticVector = ReadonlySet<string>;

export function normalizeSemanticText(value: string): string {
  return value.toLowerCase().replace(/[\s\-_・、。,.!?()（）「」『』:：;；/／|｜\[\]【】…―]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Character 1-3 grams of normalized text (shared with the eval FTS proxy). */
export function semanticCharGrams(value: string): string[] {
  const spaceless = normalizeSemanticText(value).replace(/\s+/g, '');
  const units = Array.from(spaceless);
  if (units.length === 0) return [];
  const out = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    if (units.length < n) {
      out.add(units.join(''));
      continue;
    }
    for (let i = 0; i + n <= units.length; i++) {
      out.add(units.slice(i, i + n).join(''));
    }
  }
  return Array.from(out);
}

/**
 * Vectorizes title + summary text into a character-gram set.
 * Fail closed: empty text yields the empty set (never a throw).
 */
export function vectorizeSemanticText(title: string, summary: string): SemanticVector {
  return new Set(semanticCharGrams(`${title} ${summary}`));
}

/** Cosine similarity of two character-gram sets (empty set -> 0, never NaN). */
export function cosineSimilarity(a: SemanticVector, b: SemanticVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection++;
  }
  return intersection / (Math.sqrt(a.size) * Math.sqrt(b.size));
}
