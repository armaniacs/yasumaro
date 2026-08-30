/**
 * computeLimits.ts
 * Input caps for O(n^2) computations over stored data (VULN-041/051/053, CWE-400).
 *
 * Stored tag strings and extracted sentences flow into double-loop / similarity-matrix
 * computations with no upper bound. Uncapped, a bloated or hostile page can push a single
 * record into hundreds of tags (C(n,2) edges) or thousands of sentences (n^2 similarity
 * matrix), making the dashboard freeze. These caps bound each such computation.
 *
 * Values match existing precedent (MAX_TAGS_AFTER_TRUNCATION = 50 in
 * pendingChromeStorageQueue.ts, MAX_NODES = 50 in tagClusterPanel.ts).
 */

/**
 * Max unique tags considered per record in tag-cooccurrence.
 * Bounds the per-record double loop to C(50, 2) = 1225 iterations.
 * Tags kept: first N in original parse order (per-record, frequency-agnostic —
 * cross-record frequency is handled later by limitToTopNodes / top-N narrowing).
 */
export const MAX_TAGS_PER_RECORD = 50;

/**
 * Max sentences fed into TextRank. Bounds the similarity matrix to 200^2.
 * Applied after the minLength filter, preferring minLength-passing sentences.
 */
export const MAX_SENTENCES_FOR_TEXTRANK = 200;

/**
 * Max unique tags fed into tag-cooccurrence for the tag-cluster panel,
 * selected by cross-record frequency BEFORE cooccurrence runs. Matches the
 * downstream MAX_NODES render cap so no work is done on nodes that would be dropped.
 */
export const MAX_TAG_CLUSTER_TAGS = 50;
