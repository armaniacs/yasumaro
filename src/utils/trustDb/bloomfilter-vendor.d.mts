/**
 * Type declarations for bloomfilter-vendor.mjs
 * Vendored from the bloomfilter npm package.
 */
export class BloomFilter {
  /** Number of bits in the filter */
  m: number;
  /** Number of hash functions */
  k: number;
  /** Bucket array (Uint32Array internally) */
  buckets: Uint32Array;

  /**
   * @param m - Number of bits, or an array of integers to load.
   * @param k - Number of hashing functions.
   */
  constructor(m: number | ArrayLike<number>, k: number);

  /** Add an element to the filter */
  add(value: string): void;

  /** Test if an element might be in the set (may return false positives) */
  test(value: string): boolean;
}
