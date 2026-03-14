/**
 * Type declarations for bloomfilter npm package
 * Global module declaration
 */

declare module 'bloomfilter' {
  /**
   * Bloom Filter implementation
   */
  export class BloomFilter {
    constructor(m: number | ArrayLike<number>, k: number);
    add(element: string | number): void;
    test(element: string | number): boolean;
    size(): number;
    countBits(): number;
    error(): number;
    toJSON(): { version: number; m: number; k: number; buckets: number[] };
    static fromJSON(value: string | { version?: number; m?: number; k: number; buckets: number[] }): BloomFilter;
    static union(a: BloomFilter, b: BloomFilter): BloomFilter;
    static intersection(a: BloomFilter, b: BloomFilter): BloomFilter;
    static withTargetError(n: number, error: number): BloomFilter;

    /**
     * Internal bucket array (Uint32Array - accessible for serialization)
     */
    buckets: Uint32Array;

    /**
     * Internal bit size
     */
    m: number;

    /**
     * Internal hash count
     */
    k: number;
  }
}