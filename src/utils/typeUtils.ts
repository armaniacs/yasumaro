/**
 * typeUtils.ts
 * Reusable advanced TypeScript utility types.
 */

/**
 * DeepReadonly<T>
 * Recursively makes all properties of T readonly, including nested objects.
 * Functions are preserved as-is (not wrapped in readonly).
 */
export type DeepReadonly<T> = {
    readonly [P in keyof T]: T[P] extends object
        ? T[P] extends Function
            ? T[P]
            : DeepReadonly<T[P]>
        : T[P];
};

/**
 * ErrorCodePattern
 * Enforces the structured error code format used across the extension.
 * Examples: STRG_RD_001, API_REQ_001, CRYPTO_HMAC_001
 */
export type ErrorCodePattern = `${string}_${string}_${number}`;
