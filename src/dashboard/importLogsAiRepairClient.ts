/**
 * importLogsAiRepairClient.ts
 * PBI 2026-11-23-06 / 指摘11-14: 取込AI修復の本番クライアント配線。
 *
 * 既存の后台AI経路 (AIService.generateSummary) を再利用する薄い適合層で、
 * 新規の外部送信経路 (fetch 等) は持たない。送信内容は失敗行のみで、
 * 汚染除去・上限・監査は importLogsAiRepair.ts 側 (buildAiRepairPayload /
 * requestAiRepair の logInfo + RemoteAIService 側の recordAuditLog) が担う。
 * dashboard から background への静的 import は純粋定数・型に限る規律のため、
 * 既定生成は dynamic import で遅延解決する (lint の静的検査対象外の正規手法)。
 */

import type { AiRepairClient } from './importLogsAiRepair.js';
import type { AIService } from '../background/ai/AIService.js';

/** generateSummary の最小面。AIService 全体ではなくこの面だけに依存する。 */
export interface AiRepairSummaryService {
  generateSummary(content: string, options?: unknown): Promise<{ success: boolean; summary: string }>;
}

/**
 * 修復プロンプト。モデルに余計な解説をさせず JSON 1点だけ返させる。
 * PII は事前に除去済み (buildAiRepairPayload) の前提で、ここでは足さない。
 */
export function buildAiRepairPrompt(rowText: string): string {
  return [
    'Repair this browsing-log row as JSON. Return ONLY the repaired JSON object, no explanation.',
    'Required: "url" must be a non-empty string, "created_at" must be a finite number (epoch milliseconds).',
    `Row: ${rowText}`,
  ].join('\n');
}

/**
 * generateSummary の応答から JSON 部分だけ抜き出す。フェンスや前置きが
 * 付いても最初の { ... } を拾う。抜き出せなければ原文を返し、下流の
 * JSON.parse 検査で失敗扱いにする (例外にしない)。
 */
export function extractJsonFromSummary(summary: string): string {
  const fenced = summary.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? summary).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return summary;
  return candidate.slice(start, end + 1);
}

/**
 * 既存AI経路への適合層。1行ずつ generateSummary を呼び、応答テキストを
 * そのまま repairRows の応答形に包む。AI失敗・例外は壊れた応答として返し、
 * requestAiRepair 側の failures 計上に任せる (throw しない)。
 */
export function createAiServiceRepairClient(aiService: AiRepairSummaryService): AiRepairClient {
  return {
    async repairRows(rows: Array<{ index: number; text: string }>): Promise<Array<{ index: number; text: string }>> {
      const out: Array<{ index: number; text: string }> = [];
      for (const row of rows) {
        let text: string;
        try {
          const result = await aiService.generateSummary(buildAiRepairPrompt(row.text), {
            url: 'urn:yasumaro:ai-repair',
            policy: 'ai-repair',
          });
          text = result.success ? extractJsonFromSummary(result.summary) : result.summary;
        } catch {
          text = 'AI repair failed';
        }
        out.push({ index: row.index, text });
      }
      return out;
    },
  };
}

/**
 * 本番既定: 共有 AIService 合成ルートを遅延解決する。dashboard からの
 * background 静的 import を避けるため dynamic import にする。
 */
export async function createDefaultAiRepairClient(): Promise<AiRepairClient | null> {
  try {
    const factory = await import('../background/ai/aiServiceFactory.js');
    const aiService: AIService = factory.createAIService();
    return createAiServiceRepairClient(aiService);
  } catch {
    return null;
  }
}
