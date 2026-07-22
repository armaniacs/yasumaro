import { getMessage } from '../utils/i18n.js';
import { removeSavedUrl } from '../utils/storageUrls.js';
import type { SavedUrlEntry } from '../utils/storageUrls.js';
import { makeCleansingProgressBar } from './cleansingStatsView.js';
import { makeRecordTypeBadge, makeMaskBadge, makeCleansedBadge } from './historyBadges.js';
import { openTagEditModal } from './historyTagEditModal.js';
import { getCachedMessage } from './historyState.js';
import type { HistoryPanelState, TagEditElements } from './historyState.js';

const _cleanseReasonLabels: Record<string, string> = {
  alt:      getCachedMessage('historyAiSummaryCleansedReasonAlt', '画像alt属性'),
  metadata: getCachedMessage('historyAiSummaryCleansedReasonMetadata', 'メタデータ'),
  ads:      getCachedMessage('historyAiSummaryCleansedReasonAds', '広告'),
  nav:      getCachedMessage('historyAiSummaryCleansedReasonNav', 'ナビゲーション'),
  social:   getCachedMessage('historyAiSummaryCleansedReasonSocial', 'ソーシャル'),
  deep:     getCachedMessage('historyAiSummaryCleansedReasonDeep', 'ディープ'),
};

function makeTagBadges(
  tags: string[] | undefined,
  url: string,
  state: HistoryPanelState,
  onTagFilterChange: () => void,
): HTMLElement | null {
  if (!tags || tags.length === 0) return null;

  const container = document.createElement('div');
  container.className = 'tag-badges';

  tags.forEach(function createTagBadge(tag: string): void {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'tag-badge';
    badge.textContent = `#${tag}`;
    badge.setAttribute('aria-label', getMessage('tagFilterAriaLabel', [tag]) || `#${tag}`);

    const isActive = state.activeTagFilter === tag;
    if (isActive) badge.classList.add('filter-active');
    badge.setAttribute('aria-pressed', isActive ? 'true' : 'false');

    badge.addEventListener('click', function handleTagClick(e: MouseEvent): void {
      e.preventDefault();
      e.stopPropagation();
      state.activeTagFilter = state.activeTagFilter === tag ? null : tag;
      state.historyCurrentPage = 0;
      onTagFilterChange();
    });

    container.appendChild(badge);
  });

  return container;
}

function createContentToggle(
  id: string,
  showLabel: string,
  hideLabel: string,
  content: string,
  info: HTMLElement,
): void {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'content-toggle-btn';
  toggle.textContent = showLabel;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', id);

  const area = document.createElement('div');
  area.className = 'content-preview hidden';
  area.id = id;
  area.textContent = content;

  toggle.addEventListener('click', function handleToggle(): void {
    const isHidden = area.classList.toggle('hidden');
    toggle.setAttribute('aria-expanded', String(!isHidden));
    toggle.textContent = isHidden ? showLabel : hideLabel;
  });

  info.appendChild(toggle);
  info.appendChild(area);
}

export function makeHistoryEntryRow(
  entry: SavedUrlEntry,
  index: number,
  start: number,
  state: HistoryPanelState,
  tagEditElements: TagEditElements,
  onTagFilterChange: () => void,
  onApplyFilters: (resetPage?: boolean) => void,
): HTMLElement {
  const {
    url, timestamp, recordType, maskedCount, tags, content, cleansedReason,
    aiSummary, sentTokens, receivedTokens, originalTokens, cleansedTokens,
    pageBytes, candidateBytes, originalBytes, cleansedBytes,
    aiSummaryOriginalBytes, aiSummaryCleansedBytes, aiSummaryCleansedElements,
    aiSummaryCleansedReason, aiSummaryCleansedReasons,
    aiProvider, aiModel, aiDuration,
  } = entry;

  const row = document.createElement('div');
  row.className = 'history-entry';

  const info = document.createElement('div');
  info.className = 'history-entry-info';

  const topRow = document.createElement('div');
  topRow.className = 'history-entry-top';

  const urlEl = document.createElement('a');
  urlEl.className = 'history-entry-url';
  urlEl.href = url;
  urlEl.target = '_blank';
  urlEl.rel = 'noopener noreferrer';
  urlEl.textContent = url;

  topRow.appendChild(makeRecordTypeBadge(recordType));
  const maskBadge = makeMaskBadge(maskedCount);
  if (maskBadge) topRow.appendChild(maskBadge);
  const cleansedBadge = makeCleansedBadge(cleansedReason);
  if (cleansedBadge) topRow.appendChild(cleansedBadge);
  topRow.appendChild(urlEl);

  const timeEl = document.createElement('div');
  timeEl.className = 'history-entry-time';
  timeEl.textContent = new Date(timestamp).toLocaleString();

  info.appendChild(topRow);
  info.appendChild(timeEl);

  if (aiSummary && aiSummary.trim().length > 0) {
    const aiSummaryEl = document.createElement('div');
    aiSummaryEl.className = 'history-entry-ai-summary';
    const aiSummaryLabel = getMessage('historyAiSummary') || 'AI要約';
    aiSummaryEl.textContent = `${aiSummaryLabel}: ${aiSummary}`;
    info.appendChild(aiSummaryEl);
  }

  if (sentTokens !== undefined || receivedTokens !== undefined) {
    const tokensEl = document.createElement('div');
    tokensEl.className = 'history-entry-tokens';
    const tokenParts: string[] = [];
    const sentLabel = getMessage('historySentTokens') || '送信';
    const receivedLabel = getMessage('historyReceivedTokens') || '受信';
    if (sentTokens !== undefined) tokenParts.push(`${sentLabel}: ${sentTokens}`);
    if (receivedTokens !== undefined) tokenParts.push(`${receivedLabel}: ${receivedTokens}`);
    const tokensLabel = getMessage('historyTokens') || 'トークン数';
    let tokensText = `${tokensLabel}: ${tokenParts.join(', ')}`;
    if (aiDuration !== undefined) tokensText += `, 処理時間 ${(aiDuration / 1000).toFixed(1)}秒`;
    if (aiProvider !== undefined) {
      const aiParts = [aiProvider];
      if (aiModel) aiParts.push(aiModel);
      tokensText += ` (AI: ${aiParts.join(' / ')})`;
    }
    tokensEl.textContent = tokensText;
    info.appendChild(tokensEl);
  } else if (aiProvider !== undefined) {
    const aiProviderEl = document.createElement('div');
    aiProviderEl.className = 'history-entry-tokens';
    const parts = [aiProvider];
    if (aiModel) parts.push(aiModel);
    let providerText = `AI: ${parts.join(' / ')}`;
    if (aiDuration !== undefined) providerText += `, 処理時間 ${(aiDuration / 1000).toFixed(1)}秒`;
    aiProviderEl.textContent = providerText;
    info.appendChild(aiProviderEl);
  }

  if (pageBytes !== undefined && candidateBytes !== undefined) {
    const extractEl = document.createElement('div');
    extractEl.className = 'history-entry-token-reduction';
    const reduction = pageBytes - candidateBytes;
    const reductionPercent = ((reduction / pageBytes) * 100).toFixed(1);
    extractEl.textContent = `コンテンツ抽出 — バイト: ${pageBytes} → ${candidateBytes} (削減 ${reduction} / ${reductionPercent}%)`;
    info.appendChild(extractEl);
  }

  if (originalBytes !== undefined || cleansedBytes !== undefined) {
    const contentOriginalB = originalBytes || candidateBytes;
    const contentCleansedB = cleansedBytes || originalBytes || candidateBytes;
    if (contentOriginalB !== undefined && contentCleansedB !== undefined) {
      const reduction = contentOriginalB - contentCleansedB;
      const reductionPercent = contentOriginalB > 0 ? ((reduction / contentOriginalB) * 100).toFixed(1) : '0.0';
      const cleansingEl = document.createElement('div');
      cleansingEl.className = 'history-entry-token-reduction';
      cleansingEl.textContent = `${getCachedMessage('historyContentCleansing', 'Content Cleansing')} — バイト: ${contentOriginalB} → ${contentCleansedB} (削減 ${reduction} / ${reductionPercent}%)`;
      info.appendChild(cleansingEl);
    }
  }

  if (originalTokens !== undefined && cleansedTokens !== undefined) {
    const maskingEl = document.createElement('div');
    maskingEl.className = 'history-entry-token-reduction';
    maskingEl.textContent = `${getCachedMessage('historyPiiMasking', 'PIIマスキング')} — トークン: ${originalTokens} → ${cleansedTokens}`;
    info.appendChild(maskingEl);
  }

  if (entry.fallbackTriggered) {
    const fallbackEl = document.createElement('div');
    fallbackEl.className = 'history-entry-ai-summary-cleansing history-entry-fallback';
    fallbackEl.textContent = '⚠️ フォールバック発動: クレンジング後のテキストが短すぎたため、処理を破棄して元のテキストを利用しました';
    info.appendChild(fallbackEl);
  }

  if (!entry.fallbackTriggered && (aiSummaryCleansedBytes !== undefined || aiSummaryCleansedElements !== undefined || aiSummaryCleansedReason !== undefined)) {
    const aiSummaryCleansingEl = document.createElement('div');
    aiSummaryCleansingEl.className = 'history-entry-ai-summary-cleansing';
    const cleansingParts: string[] = [];
    const aiBase = aiSummaryOriginalBytes || cleansedBytes || originalBytes || candidateBytes;
    if (aiBase && aiSummaryCleansedBytes !== undefined) {
      const reduction = aiBase - aiSummaryCleansedBytes;
      const reductionPercent = aiBase > 0 ? ((reduction / aiBase) * 100).toFixed(1) : '0.0';
      cleansingParts.push(`バイト: ${aiBase} → ${aiSummaryCleansedBytes} (削減 ${reduction} / ${reductionPercent}%)`);
    }
    if (aiSummaryCleansedElements !== undefined && aiSummaryCleansedElements > 0) {
      cleansingParts.push(`${aiSummaryCleansedElements}要素削除`);
    }
    if (aiSummaryCleansedReason !== undefined && aiSummaryCleansedReason !== 'none') {
      const labelMap: Record<string, string> = {
        alt:      getMessage('historyAiSummaryCleansedReasonAlt') || '画像alt属性',
        metadata: getMessage('historyAiSummaryCleansedReasonMetadata') || 'メタデータ',
        ads:      getMessage('historyAiSummaryCleansedReasonAds') || '広告',
        nav:      getMessage('historyAiSummaryCleansedReasonNav') || 'ナビゲーション',
        social:   getMessage('historyAiSummaryCleansedReasonSocial') || 'ソーシャル',
        deep:     getMessage('historyAiSummaryCleansedReasonDeep') || 'ディープ',
      };
      let reasonText = '';
      if (aiSummaryCleansedReason === 'multiple') {
        reasonText = aiSummaryCleansedReasons && aiSummaryCleansedReasons.length > 0
          ? aiSummaryCleansedReasons.slice(0, 3).map(r => labelMap[r] || r).join(', ')
          : '複数';
      } else {
        reasonText = labelMap[aiSummaryCleansedReason] || aiSummaryCleansedReason;
      }
      cleansingParts.push(`理由: ${reasonText}`);
    }
    if (cleansingParts.length > 0) {
      aiSummaryCleansingEl.textContent = `AI要約クレンジング — ${cleansingParts.join(', ')}`;
      info.appendChild(aiSummaryCleansingEl);
    }
  }

  const progressBar = makeCleansingProgressBar(entry);
  if (progressBar) info.appendChild(progressBar);

  const tagBadges = makeTagBadges(tags, url, state, onTagFilterChange);
  if (tagBadges) {
    info.appendChild(tagBadges);
  } else {
    const noTagRow = document.createElement('div');
    noTagRow.className = 'tag-badges tag-badges-empty';
    const addTagLink = document.createElement('button');
    addTagLink.className = 'tag-add-inline-btn';
    addTagLink.textContent = '+ タグを追加';
    addTagLink.addEventListener('click', () => openTagEditModal(state, tagEditElements, url, []));
    noTagRow.appendChild(addTagLink);
    info.appendChild(noTagRow);
  }

  if (content && content.trim().length > 0) {
    const contentId = `content-entry-${start + index}`;
    createContentToggle(
      contentId,
      getMessage('historyShowSentData') || 'AIへ送信したデータ',
      getMessage('historyHideSentData') || 'データを非表示',
      content,
      info,
    );
  }

  if (aiSummary && aiSummary.trim().length > 0) {
    const summaryId = `summary-entry-${start + index}`;
    createContentToggle(
      summaryId,
      getMessage('historyShowReceivedData') || 'AIから受信したデータ',
      getMessage('historyHideReceivedData') || 'データを非表示',
      aiSummary,
      info,
    );
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'history-entry-delete';
  deleteBtn.textContent = '×';
  deleteBtn.setAttribute('aria-label', getMessage('deleteEntry') || 'Delete');
  deleteBtn.addEventListener('click', async () => {
    await removeSavedUrl(url);
    const idx = state.entries.findIndex(e => e.url === url);
    if (idx !== -1) state.entries.splice(idx, 1);
    onApplyFilters(false);
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'history-entry-edit-btn';
  editBtn.textContent = '✎';
  editBtn.setAttribute('aria-label', getMessage('editTags') || 'タグを編集');
  editBtn.title = getMessage('editTags') || 'タグを編集';
  editBtn.addEventListener('click', () => {
    openTagEditModal(state, tagEditElements, url, tags || []);
  });

  row.appendChild(info);
  row.appendChild(editBtn);
  row.appendChild(deleteBtn);

  return row;
}
