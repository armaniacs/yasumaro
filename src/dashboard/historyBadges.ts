import { getMessage } from '../popup/i18n.js';
import type { CleansedReason } from '../utils/storageUrls.js';

export function makeRecordTypeBadge(recordType?: string): HTMLElement {
  const badge = document.createElement('span');
  if (recordType === 'manual') {
    badge.className = 'history-badge history-badge-manual';
    badge.textContent = getMessage('recordTypeManual') || '手動';
  } else {
    badge.className = 'history-badge history-badge-auto';
    badge.textContent = getMessage('recordTypeAuto') || '自動';
  }
  return badge;
}

export function makeMaskBadge(maskedCount: number | undefined): HTMLSpanElement | null {
  if (!maskedCount || maskedCount === 0) return null;
  const badge = document.createElement('span');
  badge.className = 'history-badge history-badge-masked';
  const label = getMessage('maskedBadge', { count: String(maskedCount) }) || `🔒 ${maskedCount}`;
  badge.textContent = label;
  badge.title =
    getMessage('maskedBadgeTitle', { count: String(maskedCount) }) ||
    `${maskedCount}件の個人情報をマスクしてAIに送信しました`;
  return badge;
}

interface CleansedBadgeConfig {
  label: string;
  title: string;
}

const CLEANSED_BADGE_CONFIG: Record<string, CleansedBadgeConfig> = {
  hard: {
    label: getMessage('cleansedBadgeHard') || '🧹 Hard',
    title: getMessage('cleansedBadgeHardTitle') || 'タグ・属性ベース削除',
  },
  keyword: {
    label: getMessage('cleansedBadgeKeyword') || '🧹 Keyword',
    title: getMessage('cleansedBadgeKeywordTitle') || 'キーワードベース削除',
  },
  both: {
    label: getMessage('cleansedBadgeBoth') || '🧹 Both',
    title: getMessage('cleansedBadgeBothTitle') || 'Hard Strip + Keyword Strip',
  },
};

export function makeCleansedBadge(cleansedReason: CleansedReason | undefined): HTMLSpanElement | null {
  if (!cleansedReason || cleansedReason === 'none') {
    return null;
  }

  const config = CLEANSED_BADGE_CONFIG[cleansedReason];
  if (!config) {
    return null;
  }

  const badge = document.createElement('span');
  badge.className = 'history-badge history-badge-cleansed';
  badge.textContent = config.label;
  badge.title = config.title;
  return badge;
}
