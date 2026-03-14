export class BloomFilter {
    static fromJSON(value: any): BloomFilter;
    static union(a: any, b: any): BloomFilter;
    static intersection(a: any, b: any): BloomFilter;
    static withTargetError(n: any, error: any): BloomFilter;
    /**
     * @param {number|ArrayLike} m - Number of bits, or an array of integers to load.
     * @param {number} k - Number of hashing functions.
     */
    constructor(m: number | ArrayLike<any>, k: number);
    m: number;
    k: number;
    buckets: Uint32Array<ArrayBuffer>;
    _locations: Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
    locations(v: any): Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
    add(v: any): void;
    test(v: any): boolean;
    size(): number;
    countBits(): number;
    error(): number;
    toJSON(): {
        version: number;
        m: number;
        k: number;
        buckets: number[];
    };
}
//# sourceMappingURL=bloomfilter.d.mts.map