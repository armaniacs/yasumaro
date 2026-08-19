/**
 * pipeline/mappers/RecordingContextFieldMapper.ts
 * Shared field inventory for storage-bound mappers.
 * Extracted from saveMetadataStep / BrowsingLogRecordMapper duplication (PBI-02).
 */

import type { RecordingContext } from '../types.js';

export interface CommonStorageFields {
    url: string;
    title: string | null;
    content: string | null;
    summary: string | null;
    tagsArray: string[] | null;
    providerName: string | null;
    modelName: string | null;
    privacyMode: string | null;
    maskedCount: number | null;
    maskedCountForPatch: number | undefined;
    sentTokens: number | null;
    receivedTokens: number | null;
    originalTokens: number | null;
    cleansedTokens: number | null;
    pageBytes: number | null;
    candidateBytes: number | null;
    originalBytes: number | null;
    cleansedBytes: number | null;
    aiSummaryOriginalBytes: number | null;
    aiSummaryCleansedBytes: number | null;
    aiSummaryCleansedElements: number | null;
    aiSummaryCleansedReason: string | null;
    aiSummaryCleansedReasons: string[] | null;
    fallbackTriggered: boolean;
    fallbackTriggeredInt: 0 | 1;
    aiDuration: number | null;
    obsidianDuration: number | null;
    extractedSentencesBytes: number | null;
    extractedSentencesOriginalBytes: number | null;
    cleansedReason: string | null;
    recordType: string;
}

export function extractCommonStorageFields(context: RecordingContext): CommonStorageFields {
    const { data, privacyResult, aiDuration, obsidianDuration, extractedSentencesBytes, extractedSentencesOriginalBytes } = context;
    const privacy = privacyResult as unknown as Record<string, unknown> | undefined;
    const d = data as unknown as Record<string, unknown>;

    const rawMasked = (d.precomputedMaskedCount as number | undefined)
        ?? (d.maskedCount as number | undefined)
        ?? (privacy?.maskedCount as number | undefined)
        ?? null;

    return {
        url: d.url as string,
        title: (d.title as string) || null,
        content: (d.content as string) || null,
        summary: (privacy?.summary as string) || null,
        tagsArray: (privacy?.tags as string[] | undefined) && (privacy?.tags as string[]).length > 0 ? (privacy?.tags as string[]) : null,
        providerName: (privacy?.providerName as string) ?? null,
        modelName: (privacy?.modelName as string) ?? null,
        privacyMode: (privacy?.mode as string) ?? null,
        maskedCount: rawMasked || null,
        maskedCountForPatch: rawMasked && rawMasked > 0 ? rawMasked : undefined,
        sentTokens: (privacy?.sentTokens as number) ?? null,
        receivedTokens: (privacy?.receivedTokens as number) ?? null,
        originalTokens: (privacy?.originalTokens as number) ?? null,
        cleansedTokens: (privacy?.cleansedTokens as number) ?? null,
        pageBytes: (d.pageBytes as number) ?? null,
        candidateBytes: (d.candidateBytes as number) ?? null,
        originalBytes: (d.originalBytes as number) ?? null,
        cleansedBytes: (d.cleansedBytes as number) ?? null,
        aiSummaryOriginalBytes: (d.aiSummaryOriginalBytes as number) ?? null,
        aiSummaryCleansedBytes: (d.aiSummaryCleansedBytes as number) ?? null,
        aiSummaryCleansedElements: (d.aiSummaryCleansedElements as number) ?? null,
        aiSummaryCleansedReason: (d.aiSummaryCleansedReason as string) ?? null,
        aiSummaryCleansedReasons: (d.aiSummaryCleansedReasons as string[] | undefined) && (d.aiSummaryCleansedReasons as string[]).length > 0 ? (d.aiSummaryCleansedReasons as string[]) : null,
        fallbackTriggered: !!d.fallbackTriggered,
        fallbackTriggeredInt: d.fallbackTriggered ? 1 : 0 as 0 | 1,
        aiDuration: (aiDuration as number) ?? null,
        obsidianDuration: (obsidianDuration as number) ?? null,
        extractedSentencesBytes: (extractedSentencesBytes as number) ?? null,
        extractedSentencesOriginalBytes: (extractedSentencesOriginalBytes as number) ?? null,
        cleansedReason: (d.cleansedReason as string) ?? null,
        recordType: (d.recordType as string) ?? 'auto',
    };
}
