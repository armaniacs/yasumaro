// ============================================================================
// History Panel
// ============================================================================

import { getSavedUrlsWithTimestamps, getSavedUrlEntries, removeSavedUrl, getSavedUrlCount, setUrlTags } from '../utils/storageUrls.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { getMessage } from '../popup/i18n.js';
import { extractDomain, isDomainAllowed } from '../utils/domainUtils.js';
import { DEFAULT_CATEGORIES, getAllCategories } from '../utils/tagUtils.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { TIMEOUTS, UI_COLORS } from '../constants/appConstants.js';
import { computeCleansingStats, renderStatsSummary, renderFunnelChart, makeCleansingProgressBar } from './cleansingStatsView.js';
import type { TagCategory } from '../utils/types.js';


function showRecordError(info: HTMLElement, error: unknown): void {
  const errorMsg = error instanceof Error 
    ? error.message 
    : (error as { error?: string })?.error 
    || getMessage('recordError') 
    || '記録に失敗しました';
  console.error('[Dashboard] Manual record error:', error);
  const errorEl = document.createElement('div');
  errorEl.className = 'record-error-message';
  errorEl.textContent = errorMsg;
  info.appendChild(errorEl);
  // エラーメッセージ表示時間後に自動消去
  setTimeout(() => { errorEl.remove(); }, TIMEOUTS.ERROR_MESSAGE_DISPLAY);
}

/**
 * Check if Service Worker is alive
 * @returns Promise<boolean> - true if Service Worker responds
 */
async function checkServiceWorkerAlive(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'PING' });
    return response?.success === true;
  } catch (error) {
    console.error('[Dashboard] Service Worker not responding:', error);
    return false;
  }
}

async function initHistoryPanel(): Promise<void> {
  const historySearchInput = document.getElementById('historySearch') as HTMLInputElement | null;
  const historyList = document.getElementById('historyList') as HTMLElement | null;
  const historyStats = document.getElementById('historyStats') as HTMLElement | null;
  const pendingSection = document.getElementById('pendingSection') as HTMLElement | null;
  const pendingList = document.getElementById('pendingList') as HTMLElement | null;
  const filterBtns = document.querySelectorAll<HTMLButtonElement>('.history-filter-btn');

  // タグ編集モーダル要素
  const tagEditModal = document.getElementById('tagEditModal') as HTMLElement | null;
  const closeTagEditModalBtn = document.getElementById('closeTagEditModalBtn') as HTMLButtonElement | null;
  const tagEditUrl = document.getElementById('tagEditUrl') as HTMLElement | null;
  const currentTagsList = document.getElementById('currentTagsList') as HTMLElement | null;
  const noCurrentTagsMsg = document.getElementById('noCurrentTagsMsg') as HTMLElement | null;
  const tagCategorySelect = document.getElementById('tagCategorySelect') as HTMLSelectElement | null;
  const addTagBtn = document.getElementById('addTagBtn') as HTMLButtonElement | null;
  const saveTagEditsBtn = document.getElementById('saveTagEditsBtn') as HTMLButtonElement | null;

  if (!historyList) return;

  // タグ編集モーダルの状態
  let editingUrl: string | null = null;
  let editingTags: string[] = [];
  let tagEditTrapId: string | null = null;

  // 記録済みエントリ（recordType付き）を取得
  const rawEntries = await getSavedUrlEntries();
  // pending URLセットを取得（スキップ表示に使う）
  const pendingPages = await getPendingPages();
  const pendingUrlSet = new Set(pendingPages.map(p => p.url));

  let entries = rawEntries.slice().sort((a, b) => b.timestamp - a.timestamp);

  let activeFilter: 'all' | 'auto' | 'manual' | 'skipped' | 'masked' | 'cleansed' = 'all';
  let activeTagFilter: string | null = null;  // タグフィルター用
  const HISTORY_PAGE_SIZE = 10;
  let historyCurrentPage = 0;

  // ストレージ変化を監視してリアルタイム更新
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;

    const savedChanged = 'savedUrlsWithTimestamps' in changes;
    // pendingPages は chrome.storage.local の独立キー 'osh_pending_pages' に保存される
    const pendingChanged = 'osh_pending_pages' in changes;

    if (!savedChanged && !pendingChanged) return;

    const updatePromises: Promise<void>[] = [];

    if (savedChanged) {
      updatePromises.push(
        getSavedUrlEntries().then(updated => {
          entries = updated.slice().sort((a, b) => b.timestamp - a.timestamp);
        })
      );
    }

    if (pendingChanged) {
      updatePromises.push(
        getPendingPages().then(updated => {
          pendingPages.length = 0;
          pendingPages.push(...updated);
          pendingUrlSet.clear();
          updated.forEach(p => pendingUrlSet.add(p.url));
        })
      );
    }

    Promise.all(updatePromises).then(() => applyFilters());
  };
  chrome.storage.onChanged.addListener(onStorageChanged);

  function makeRecordTypeBadge(recordType?: string): HTMLElement {
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

  function makeMaskBadge(maskedCount: number | undefined): HTMLSpanElement | null {
    if (!maskedCount || maskedCount === 0) return null;
    const badge = document.createElement('span');
    badge.className = 'history-badge history-badge-masked';
    const label = getMessage('maskedBadge', { count: String(maskedCount) }) || `🔒 ${maskedCount}`;
    badge.textContent = label;
    badge.title = getMessage('maskedBadgeTitle', { count: String(maskedCount) }) || `${maskedCount}件の個人情報をマスクしてAIに送信しました`;
    return badge;
  }

  function makeCleansedBadge(cleansedReason: import('../utils/storageUrls.js').CleansedReason | undefined): HTMLSpanElement | null {
    if (!cleansedReason || cleansedReason === 'none') return null;
    const badge = document.createElement('span');
    badge.className = 'history-badge history-badge-cleansed';

    let label = '';
    let title = '';

    switch (cleansedReason) {
      case 'hard':
        label = getMessage('cleansedBadgeHard') || '🧹 Hard';
        title = getMessage('cleansedBadgeHardTitle') || 'タグ・属性ベース削除';
        break;
      case 'keyword':
        label = getMessage('cleansedBadgeKeyword') || '🧹 Keyword';
        title = getMessage('cleansedBadgeKeywordTitle') || 'キーワードベース削除';
        break;
      case 'both':
        label = getMessage('cleansedBadgeBoth') || '🧹 Both';
        title = getMessage('cleansedBadgeBothTitle') || 'Hard Strip + Keyword Strip';
        break;
    }

    badge.textContent = label;
    badge.title = title;
    return badge;
  }

  /**
   * タグバッジコンテナを作成
   * @param {string[] | undefined} tags - タグ配列
   * @param {string} url - 対象URL（タグクリック時に使用）
   * @returns {HTMLElement | null} タグバッジコンテナ
   */
  function makeTagBadges(tags: string[] | undefined, url: string): HTMLElement | null {
    if (!tags || tags.length === 0) return null;

    const container = document.createElement('div');
    container.className = 'tag-badges';

    tags.forEach(tag => {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'tag-badge';
      badge.textContent = `#${tag}`;
      badge.setAttribute('aria-label', getMessage('tagFilterAriaLabel', [tag]) || `#${tag}`);

      // アクティブなフィルターと同じタグの場合はハイライト
      const isActive = activeTagFilter === tag;
      if (isActive) {
        badge.classList.add('filter-active');
      }
      badge.setAttribute('aria-pressed', isActive ? 'true' : 'false');

      // タグクリックでフィルター切り替え
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTagFilter === tag) {
          // 同じタグをクリックした場合はフィルター解除
          activeTagFilter = null;
        } else {
          // 新しいタグでフィルター
          activeTagFilter = tag;
        }
        historyCurrentPage = 0;
        applyFilters(false);
        updateTagFilterIndicator();
      });

      container.appendChild(badge);
    });

    return container;
  }

  /**
   * タグフィルターインジケーターを更新
   */
  function updateTagFilterIndicator(): void {
    // 既存のインジケーターを削除
    const existingIndicator = document.getElementById('tagFilterIndicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }

    // アクティブなタグフィルターがない場合は何もしない
    if (!activeTagFilter) return;

    // 履歴コントロールの後にインジケーターを追加
    const controls = document.querySelector('.history-controls');
    if (!controls) return;

    const indicator = document.createElement('div');
    indicator.id = 'tagFilterIndicator';
    indicator.className = 'tag-filter-indicator';

    const filterLabel = document.createElement('span');
    filterLabel.className = 'tag-filter-label';
    filterLabel.textContent = 'フィルター:';

    const filterValue = document.createElement('span');
    filterValue.className = 'tag-filter-value';
    filterValue.textContent = `#${activeTagFilter}`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tag-filter-close';
    closeBtn.title = 'フィルター解除';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      activeTagFilter = null;
      historyCurrentPage = 0;
      applyFilters(false);
      updateTagFilterIndicator();
    });

    indicator.append(filterLabel, filterValue, closeBtn);

    controls.appendChild(indicator);
  }

  function applyFilters(resetPage = true): void {
    if (!historyList) return;

    const searchText = (historySearchInput?.value || '').toLowerCase();

    // フィルター適用: activeFilter が 'skipped' のときは pendingUrlSet から表示
    if (activeFilter === 'skipped') {
      renderSkippedMode(searchText);
      return;
    }

    const filtered = entries.filter(e => {
      const matchesSearch = !searchText || e.url.toLowerCase().includes(searchText);
      const matchesType =
        activeFilter === 'all' ||
        (activeFilter === 'auto' && (!e.recordType || e.recordType === 'auto')) ||
        (activeFilter === 'manual' && e.recordType === 'manual') ||
        (activeFilter === 'masked' && !!e.maskedCount && e.maskedCount > 0) ||
        (activeFilter === 'cleansed' && !!e.cleansedReason && e.cleansedReason !== 'none');
      // タグフィルター
      const matchesTag = !activeTagFilter || (e.tags && e.tags.includes(activeTagFilter));
      return matchesSearch && matchesType && matchesTag;
    });

    if (resetPage) historyCurrentPage = 0;

    const totalPages = Math.ceil(filtered.length / HISTORY_PAGE_SIZE);
    if (historyCurrentPage >= totalPages && historyCurrentPage > 0) historyCurrentPage = totalPages - 1;

    if (historyStats) {
      historyStats.textContent = `${filtered.length} / ${entries.length}`;
    }

    if (filtered.length === 0) {
      historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
      return;
    }

    const start = historyCurrentPage * HISTORY_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + HISTORY_PAGE_SIZE);

    historyList.innerHTML = '';
    pageItems.forEach((entry, index) => {
      const contentId = `content-entry-${start + index}`;
      const { url, timestamp, recordType, maskedCount, tags, content, cleansedReason, aiSummary, sentTokens, receivedTokens, originalTokens, cleansedTokens, pageBytes, candidateBytes, originalBytes, cleansedBytes, aiSummaryOriginalBytes, aiSummaryCleansedBytes, aiSummaryCleansedElements, aiSummaryCleansedReason, aiSummaryCleansedReasons, extractedSentencesBytes, extractedSentencesOriginalBytes, aiProvider, aiModel, aiDuration } = entry;
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

      // AI要約を表示
      if (aiSummary && aiSummary.trim().length > 0) {
        const aiSummaryEl = document.createElement('div');
        aiSummaryEl.className = 'history-entry-ai-summary';
        const aiSummaryLabel = getMessage('historyAiSummary') || 'AI要約';
        aiSummaryEl.textContent = `${aiSummaryLabel}: ${aiSummary}`;
        info.appendChild(aiSummaryEl);
      }

      // トークン数を表示
      if (sentTokens !== undefined || receivedTokens !== undefined) {
        const tokensEl = document.createElement('div');
        tokensEl.className = 'history-entry-tokens';
        const tokenParts: string[] = [];
        const sentLabel = getMessage('historySentTokens') || '送信';
        const receivedLabel = getMessage('historyReceivedTokens') || '受信';
        if (sentTokens !== undefined) {
          tokenParts.push(`${sentLabel}: ${sentTokens}`);
        }
        if (receivedTokens !== undefined) {
          tokenParts.push(`${receivedLabel}: ${receivedTokens}`);
        }
        const tokensLabel = getMessage('historyTokens') || 'トークン数';
        let tokensText = `${tokensLabel}: ${tokenParts.join(', ')}`;
        if (aiDuration !== undefined) {
          tokensText += `, 処理時間 ${(aiDuration / 1000).toFixed(1)}秒`;
        }
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
        if (aiDuration !== undefined) {
          providerText += `, 処理時間 ${(aiDuration / 1000).toFixed(1)}秒`;
        }
        aiProviderEl.textContent = providerText;
        info.appendChild(aiProviderEl);
      }

      // ページ絞り込みバイト数を表示（pageBytes → candidateBytes）
      if (pageBytes !== undefined && candidateBytes !== undefined) {
        const extractEl = document.createElement('div');
        extractEl.className = 'history-entry-token-reduction';
        const reduction = pageBytes - candidateBytes;
        const reductionPercent = ((reduction / pageBytes) * 100).toFixed(1);
        extractEl.textContent = `コンテンツ抽出 — バイト: ${pageBytes} → ${candidateBytes} (削減 ${reduction} / ${reductionPercent}%)`;
        info.appendChild(extractEl);
      }

      // Content Cleansing 統計情報をまとめて1行で表示
      if (originalTokens !== undefined || cleansedTokens !== undefined || originalBytes !== undefined || cleansedBytes !== undefined) {
        const cleansingEl = document.createElement('div');
        cleansingEl.className = 'history-entry-token-reduction';
        const parts: string[] = [];

        // トークン情報があれば表示
        if (originalTokens !== undefined && cleansedTokens !== undefined) {
          parts.push(`トークン: ${originalTokens} → ${cleansedTokens}`);
        }

        // バイト情報があれば表示（0は無効値として扱い、candidateBytesをフォールバックとして使用）
        const contentOriginalB = originalBytes || candidateBytes;
        const contentCleansedB = cleansedBytes || originalBytes || candidateBytes;
        if (contentOriginalB !== undefined && contentCleansedB !== undefined) {
          const reduction = contentOriginalB - contentCleansedB;
          const reductionPercent = contentOriginalB > 0 ? ((reduction / contentOriginalB) * 100).toFixed(1) : '0.0';
          parts.push(`バイト: ${contentOriginalB} → ${contentCleansedB} (削減 ${reduction} / ${reductionPercent}%)`);
        }

        if (parts.length > 0) {
          cleansingEl.textContent = `Content Cleansing — ${parts.join(', ')}`;
          info.appendChild(cleansingEl);
        }
      }

      // フォールバックが発動した場合の表示
      if (entry.fallbackTriggered) {
        const fallbackEl = document.createElement('div');
        fallbackEl.className = 'history-entry-ai-summary-cleansing';
        fallbackEl.style.color = STATUS_COLORS.WARNING; // 警告色
        fallbackEl.style.fontWeight = 'bold';
        fallbackEl.innerHTML = '⚠️ フォールバック発動: クレンジング後のテキストが短すぎたため、処理を破棄して元のテキストを利用しました';
        info.appendChild(fallbackEl);
      }

      // AI要約クレンジングの統計情報を1行で表示
      if (!entry.fallbackTriggered && (aiSummaryCleansedBytes !== undefined || aiSummaryCleansedElements !== undefined || aiSummaryCleansedReason !== undefined)) {
        const aiSummaryCleansingEl = document.createElement('div');
        aiSummaryCleansingEl.className = 'history-entry-ai-summary-cleansing';
        const cleansingParts: string[] = [];

        // バイト情報があれば表示（AI要約クレンジング前のバイト数を優先、0は無効値として扱い candidateBytesを最終フォールバック）
        const aiBase = aiSummaryOriginalBytes || cleansedBytes || originalBytes || candidateBytes;
        if (aiBase && aiSummaryCleansedBytes !== undefined) {
          const reduction = aiBase - aiSummaryCleansedBytes;
          const reductionPercent = aiBase > 0 ? ((reduction / aiBase) * 100).toFixed(1) : '0.0';
          cleansingParts.push(`バイト: ${aiBase} → ${aiSummaryCleansedBytes} (削減 ${reduction} / ${reductionPercent}%)`);
        }

        // N要素削除
        if (aiSummaryCleansedElements !== undefined && aiSummaryCleansedElements > 0) {
          cleansingParts.push(`${aiSummaryCleansedElements}要素削除`);
        }

        // 理由
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
            if (aiSummaryCleansedReasons && aiSummaryCleansedReasons.length > 0) {
              reasonText = aiSummaryCleansedReasons.slice(0, 3).map(r => labelMap[r] || r).join(', ');
            } else {
              reasonText = '複数';
            }
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

      // プログレスバー追加（案C）— 既存テキスト行の下に追加
      const progressBar = makeCleansingProgressBar(entry);
      if (progressBar) {
        info.appendChild(progressBar);
      }

      // タグバッジを追加
      const tagBadges = makeTagBadges(tags, url);
      if (tagBadges) {
        info.appendChild(tagBadges);
      } else {
        const noTagRow = document.createElement('div');
        noTagRow.className = 'tag-badges tag-badges-empty';
        const addTagLink = document.createElement('button');
        addTagLink.className = 'tag-add-inline-btn';
        addTagLink.textContent = '+ タグを追加';
        addTagLink.addEventListener('click', () => openTagEditModal(url, []));
        noTagRow.appendChild(addTagLink);
        info.appendChild(noTagRow);
      }

      // AIへ送信したデータ（展開可能）
      if (content && content.trim().length > 0) {
        const contentToggle = document.createElement('button');
        contentToggle.className = 'content-toggle-btn';
        contentToggle.textContent = '📄 ';
        contentToggle.setAttribute('aria-expanded', 'false');
        contentToggle.setAttribute('aria-controls', contentId);

        const contentLabel = document.createElement('span');
        contentLabel.textContent = 'AIへ送信したデータ';
        contentToggle.appendChild(contentLabel);

        const contentArea = document.createElement('div');
        contentArea.className = 'content-preview hidden';
        contentArea.id = contentId;
        contentArea.textContent = content;

        contentToggle.addEventListener('click', () => {
          const isHidden = contentArea.classList.toggle('hidden');
          contentToggle.setAttribute('aria-expanded', (!isHidden).toString());
          contentLabel.textContent = isHidden ? 'AIへ送信したデータ' : 'データを非表示';
        });

        info.appendChild(contentToggle);
        info.appendChild(contentArea);
      }

      // AIから受信したデータ（展開可能）
      if (aiSummary && aiSummary.trim().length > 0) {
        const summaryId = `summary-entry-${start + index}`;
        const summaryToggle = document.createElement('button');
        summaryToggle.className = 'content-toggle-btn';
        summaryToggle.textContent = '📝 ';
        summaryToggle.setAttribute('aria-expanded', 'false');
        summaryToggle.setAttribute('aria-controls', summaryId);

        const summaryLabel = document.createElement('span');
        summaryLabel.textContent = 'AIから受信したデータ';
        summaryToggle.appendChild(summaryLabel);

        const summaryArea = document.createElement('div');
        summaryArea.className = 'content-preview hidden';
        summaryArea.id = summaryId;
        summaryArea.textContent = aiSummary;

        summaryToggle.addEventListener('click', () => {
          const isHidden = summaryArea.classList.toggle('hidden');
          summaryToggle.setAttribute('aria-expanded', (!isHidden).toString());
          summaryLabel.textContent = isHidden ? 'AIから受信したデータ' : 'データを非表示';
        });

        info.appendChild(summaryToggle);
        info.appendChild(summaryArea);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-entry-delete';
      deleteBtn.textContent = '×';
      deleteBtn.setAttribute('aria-label', getMessage('deleteEntry') || 'Delete');
      deleteBtn.addEventListener('click', async () => {
        await removeSavedUrl(url);
        const idx = entries.findIndex(e => e.url === url);
        if (idx !== -1) entries.splice(idx, 1);
        applyFilters(false);
      });

      // タグ編集ボタン
      const editBtn = document.createElement('button');
      editBtn.className = 'history-entry-edit-btn';
      editBtn.textContent = '✎';
      editBtn.setAttribute('aria-label', getMessage('editTags') || 'タグを編集');
      editBtn.title = getMessage('editTags') || 'タグを編集';
      editBtn.addEventListener('click', () => {
        openTagEditModal(url, tags || []);
      });

      row.appendChild(info);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      historyList.appendChild(row);
    });

    // ページネーションコントロール
    if (totalPages > 1) {
      const nav = document.createElement('div');
      nav.className = 'pending-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'secondary-btn';
      prevBtn.textContent = '←';
      prevBtn.disabled = historyCurrentPage === 0;
      prevBtn.addEventListener('click', () => { historyCurrentPage--; applyFilters(false); });

      const pageInfo = document.createElement('span');
      pageInfo.className = 'pending-page-info';
      pageInfo.textContent = `${historyCurrentPage + 1} / ${totalPages}`;

      const nextBtn = document.createElement('button');
      nextBtn.className = 'secondary-btn';
      nextBtn.textContent = '→';
      nextBtn.disabled = historyCurrentPage >= totalPages - 1;
      nextBtn.addEventListener('click', () => { historyCurrentPage++; applyFilters(false); });

      nav.appendChild(prevBtn);
      nav.appendChild(pageInfo);
      nav.appendChild(nextBtn);
      historyList.appendChild(nav);
    }
  }

  function renderPendingReason(reason: string): string {
    switch (reason) {
      case 'cache-control': return getMessage('pendingReasonCache') || 'Cache-Control ヘッダー';
      case 'set-cookie':    return getMessage('pendingReasonCookie') || 'Set-Cookie ヘッダー';
      case 'authorization': return getMessage('pendingReasonAuth') || 'Authorization ヘッダー';
      default:              return reason;
    }
  }

  function renderSkippedMode(searchText: string): void {
    if (!historyList) return;

    const filtered = pendingPages.filter(p =>
      !searchText ||
      p.url.toLowerCase().includes(searchText) ||
      (p.title || '').toLowerCase().includes(searchText)
    );

    if (historyStats) {
      historyStats.textContent = `${filtered.length} / ${pendingPages.length}`;
    }

    if (filtered.length === 0) {
      historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
      return;
    }

    historyList.innerHTML = '';
    for (const page of filtered) {
      const row = document.createElement('div');
      row.className = 'history-entry pending-entry-inline';

      const info = document.createElement('div');
      info.className = 'history-entry-info';

      const topRow = document.createElement('div');
      topRow.className = 'history-entry-top';

      const skipBadge = document.createElement('span');
      skipBadge.className = 'history-badge history-badge-skipped';
      skipBadge.textContent = getMessage('filterSkipped') || 'スキップ';
      topRow.appendChild(skipBadge);

      const urlEl = document.createElement('a');
      urlEl.className = 'history-entry-url';
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.textContent = page.title || page.url;
      topRow.appendChild(urlEl);

      const metaEl = document.createElement('div');
      metaEl.className = 'history-entry-time';
      metaEl.textContent = `${new Date(page.timestamp).toLocaleString()} — ${renderPendingReason(page.reason)}`;

      info.appendChild(topRow);
      info.appendChild(metaEl);

      const sendManualRecord = async (skipAi: boolean, btn: HTMLButtonElement): Promise<void> => {
        btn.disabled = true;
        btn.textContent = getMessage('processing') || '処理中...';
        let errorEl = row.querySelector('.record-error-message') as HTMLElement;
        if (errorEl) errorEl.remove();
        
        // タイムアウト付きでメッセージを送信
        const sendMessageWithTimeout = async (): Promise<any> => {
          const timeoutMs = 20000; // 20秒のタイムアウト（Service Workerの30秒制限を回避）
          const messagePromise = chrome.runtime.sendMessage({
            type: 'MANUAL_RECORD',
            payload: { title: page.title, url: page.url, content: '', force: true, skipAi }
          });
          
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out after 20 seconds. The page may be taking too long to load or process.')), timeoutMs);
          });
          
          return Promise.race([messagePromise, timeoutPromise]);
        };
        
        try {
          const result = await sendMessageWithTimeout();
          if (result?.success) {
            await removePendingPages([page.url]);
            const pIdx = pendingPages.findIndex(p => p.url === page.url);
            if (pIdx !== -1) pendingPages.splice(pIdx, 1);
            pendingUrlSet.delete(page.url);
            row.remove();
            if (historyList.children.length === 0) {
              historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
            }
            if (historyStats) historyStats.textContent = `${pendingPages.length} / ${pendingPages.length}`;
          } else {
            showRecordError(info, result);
            btn.disabled = false;
            btn.textContent = skipAi
              ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
              : (getMessage('recordNow') || '📝 今すぐ記録');
          }
        } catch (error) {
          // Check if Service Worker is alive
          const swAlive = await checkServiceWorkerAlive();
          if (!swAlive) {
            const swError = new Error(getMessage('serviceWorkerNotResponding') || 'Service Workerが応答しません。拡張機能を再読み込みしてください。');
            showRecordError(info, swError);
          } else {
            showRecordError(info, error);
          }
          btn.disabled = false;
          btn.textContent = skipAi
            ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
            : (getMessage('recordNow') || '📝 今すぐ記録');
        }
      };

      const btnGroup = document.createElement('div');
      btnGroup.className = 'pending-btn-group';

      const recordBtn = document.createElement('button');
      recordBtn.className = 'secondary-btn pending-record-btn';
      recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
      recordBtn.addEventListener('click', () => sendManualRecord(false, recordBtn));

      const recordNoAiBtn = document.createElement('button');
      recordNoAiBtn.className = 'secondary-btn pending-record-btn';
      recordNoAiBtn.textContent = getMessage('recordWithoutAi') || '📝 AI要約なしで記録';
      recordNoAiBtn.addEventListener('click', () => sendManualRecord(true, recordNoAiBtn));

      btnGroup.appendChild(recordBtn);
      btnGroup.appendChild(recordNoAiBtn);

      row.appendChild(info);
      row.appendChild(btnGroup);
      historyList.appendChild(row);
    }
  }

  // AI Summary Cleansingパネルの統計サマリー・ファネルチャートを更新
  function updateCleansingStatsPanel(panelEntries: import('../utils/storageUrls.js').SavedUrlEntry[]): void {
    const summaryEl = document.getElementById('cleansingStatsSummary') as HTMLElement | null;
    const chartEl = document.getElementById('cleansingFunnelChart') as HTMLCanvasElement | null;
    if (!summaryEl) return;
    const stats = computeCleansingStats(panelEntries);
    renderStatsSummary(summaryEl, stats);
    if (chartEl) {
      if (stats.count === 0) {
        chartEl.style.display = 'none';
      } else {
        chartEl.style.display = 'block';
        renderFunnelChart(chartEl, stats);
      }
    }
  }

  applyFilters();
  updateCleansingStatsPanel(entries);

  // タグパネルからのナビゲーションイベントを受信
  document.addEventListener('navigate-to-tag', (e: Event) => {
    const tag = (e as CustomEvent<string>).detail;
    activeTagFilter = tag;
    activeFilter = 'all';
    historyCurrentPage = 0;
    // 履歴パネルに切り替え
    document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll<HTMLElement>('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector<HTMLButtonElement>('[data-panel="panel-history"]')?.classList.add('active');
    document.getElementById('panel-history')?.classList.add('active');
    applyFilters(false);
    updateTagFilterIndicator();
  });

  historySearchInput?.addEventListener('input', () => {
    // 検索入力時にタグフィルターをリセット
    activeTagFilter = null;
    updateTagFilterIndicator();
    applyFilters();
  });

  // フィルターボタン
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      activeFilter = (btn.dataset['filter'] || 'all') as typeof activeFilter;
      // タグフィルターをリセット
      activeTagFilter = null;
      updateTagFilterIndicator();
      applyFilters();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 保留中ページ（記録できなかった）セクション — ページ上部の警告ボックス
  // ──────────────────────────────────────────────────────────────────────────
  if (!pendingSection || !pendingList) return;

  if (pendingPages.length === 0) {
    pendingSection.hidden = true;
    return;
  }

  pendingSection.hidden = false;

  // 最新順（timestamp降順）に並べる
  const sortedPending = [...pendingPages].sort((a, b) => b.timestamp - a.timestamp);

  const PENDING_PAGE_SIZE = 10;
  let pendingCurrentPage = 0;

  function renderPendingPage(): void {
    if (!pendingList) return;
    pendingList.innerHTML = '';

    const start = pendingCurrentPage * PENDING_PAGE_SIZE;
    const pageItems = sortedPending.slice(start, start + PENDING_PAGE_SIZE);

    for (const page of pageItems) {
      const row = document.createElement('div');
      row.className = 'pending-entry';

      const info = document.createElement('div');
      info.className = 'pending-entry-info';

      const urlEl = document.createElement('a');
      urlEl.className = 'history-entry-url';
      urlEl.href = page.url;
      urlEl.target = '_blank';
      urlEl.rel = 'noopener noreferrer';
      urlEl.textContent = page.title || page.url;

      const metaEl = document.createElement('div');
      metaEl.className = 'pending-entry-meta';
      metaEl.textContent = `${new Date(page.timestamp).toLocaleString()} — ${renderPendingReason(page.reason)}`;
      if (page.headerValue) {
        const headerEl = document.createElement('span');
        headerEl.className = 'pending-entry-header';
        headerEl.textContent = ` (${page.headerValue})`;
        metaEl.appendChild(headerEl);
      }

      info.appendChild(urlEl);
      info.appendChild(metaEl);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'pending-btn-group';

      const sendPendingRecord = async (skipAi: boolean, btn: HTMLButtonElement): Promise<void> => {
        btn.disabled = true;
        btn.textContent = getMessage('processing') || '処理中...';
        let errorEl = row.querySelector('.record-error-message') as HTMLElement;
        if (errorEl) errorEl.remove();
        
        // タイムアウト付きでメッセージを送信
        const sendMessageWithTimeout = async (): Promise<any> => {
          const timeoutMs = 20000; // 20秒のタイムアウト（Service Workerの30秒制限を回避）
          const messagePromise = chrome.runtime.sendMessage({
            type: 'MANUAL_RECORD',
            payload: { title: page.title, url: page.url, content: '', force: true, skipAi }
          });
          
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out after 20 seconds. The page may be taking too long to load or process.')), timeoutMs);
          });
          
          return Promise.race([messagePromise, timeoutPromise]);
        };
        
        try {
          const result = await sendMessageWithTimeout();
          if (result?.success) {
            await removePendingPages([page.url]);
            const pIdx = pendingPages.findIndex(p => p.url === page.url);
            if (pIdx !== -1) { pendingPages.splice(pIdx, 1); sortedPending.splice(sortedPending.findIndex(p => p.url === page.url), 1); }
            pendingUrlSet.delete(page.url);
            if (pendingCurrentPage > 0 && pendingCurrentPage * PENDING_PAGE_SIZE >= sortedPending.length) {
              pendingCurrentPage--;
            }
            if (sortedPending.length === 0) {
              pendingSection!.hidden = true;
            } else {
              renderPendingPage();
            }
            if (activeFilter === 'skipped') applyFilters();
          } else {
            showRecordError(info, result);
            btn.disabled = false;
            btn.textContent = skipAi
              ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
              : (getMessage('recordNow') || '📝 今すぐ記録');
          }
        } catch (error) {
          // Check if Service Worker is alive
          const swAlive = await checkServiceWorkerAlive();
          if (!swAlive) {
            const swError = new Error(getMessage('serviceWorkerNotResponding') || 'Service Workerが応答しません。拡張機能を再読み込みしてください。');
            showRecordError(info, swError);
          } else {
            showRecordError(info, error);
          }
          btn.disabled = false;
          btn.textContent = skipAi
            ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
            : (getMessage('recordNow') || '📝 今すぐ記録');
        }
      };

      const recordBtn = document.createElement('button');
      recordBtn.className = 'secondary-btn pending-record-btn';
      recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
      recordBtn.addEventListener('click', () => sendPendingRecord(false, recordBtn));

      const recordNoAiBtn = document.createElement('button');
      recordNoAiBtn.className = 'secondary-btn pending-record-btn';
      recordNoAiBtn.textContent = getMessage('recordWithoutAi') || '📝 AI要約なしで記録';
      recordNoAiBtn.addEventListener('click', () => sendPendingRecord(true, recordNoAiBtn));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger-btn pending-delete-btn';
      deleteBtn.textContent = getMessage('pendingDeleteForever') || '🗑 完全削除';
      deleteBtn.addEventListener('click', async () => {
        deleteBtn.disabled = true;
        try {
          await removePendingPages([page.url]);
          const pIdx = pendingPages.findIndex(p => p.url === page.url);
          if (pIdx !== -1) pendingPages.splice(pIdx, 1);
          sortedPending.splice(sortedPending.findIndex(p => p.url === page.url), 1);
          pendingUrlSet.delete(page.url);
          if (pendingCurrentPage > 0 && pendingCurrentPage * PENDING_PAGE_SIZE >= sortedPending.length) {
            pendingCurrentPage--;
          }
          if (sortedPending.length === 0) {
            pendingSection!.hidden = true;
          } else {
            renderPendingPage();
          }
          if (activeFilter === 'skipped') applyFilters();
        } catch {
          deleteBtn.disabled = false;
        }
      });

      btnGroup.appendChild(recordBtn);
      btnGroup.appendChild(recordNoAiBtn);
      btnGroup.appendChild(deleteBtn);
      row.appendChild(info);
      row.appendChild(btnGroup);
      pendingList!.appendChild(row);
    }

    // ページネーションコントロール
    const totalPages = Math.ceil(sortedPending.length / PENDING_PAGE_SIZE);
    if (totalPages > 1) {
      const nav = document.createElement('div');
      nav.className = 'pending-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'secondary-btn';
      prevBtn.textContent = '←';
      prevBtn.disabled = pendingCurrentPage === 0;
      prevBtn.addEventListener('click', () => { pendingCurrentPage--; renderPendingPage(); });

      const pageInfo = document.createElement('span');
      pageInfo.className = 'pending-page-info';
      pageInfo.textContent = `${pendingCurrentPage + 1} / ${totalPages}`;

      const nextBtn = document.createElement('button');
      nextBtn.className = 'secondary-btn';
      nextBtn.textContent = '→';
      nextBtn.disabled = pendingCurrentPage >= totalPages - 1;
      nextBtn.addEventListener('click', () => { pendingCurrentPage++; renderPendingPage(); });

      nav.appendChild(prevBtn);
      nav.appendChild(pageInfo);
      nav.appendChild(nextBtn);
      pendingList!.appendChild(nav);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // タグ編集モーダル
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * タグ編集モーダルを開く
   * @param {string} url - 編集対象URL
   * @param {string[]} currentTags - 現在のタグ
   */
  function openTagEditModal(url: string, currentTags: string[]): void {
    editingUrl = url;
    editingTags = [...currentTags];

    if (tagEditUrl) tagEditUrl.textContent = url;
    renderCurrentTags();
    updateTagCategorySelect();

    if (tagEditModal) {
      tagEditModal.classList.remove('hidden');
      tagEditModal.setAttribute('aria-hidden', 'false');
      tagEditTrapId = focusTrapManager.trap(tagEditModal, closeTagEditModal);
    }
  }

  /**
   * タグ編集モーダルを閉じる
   */
  function closeTagEditModal(): void {
    editingUrl = null;
    editingTags = [];
    if (tagEditTrapId) {
      focusTrapManager.release(tagEditTrapId);
      tagEditTrapId = null;
    }
    if (tagEditModal) {
      tagEditModal.classList.add('hidden');
      tagEditModal.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * 現在のタグリストをレンダリング
   */
  function renderCurrentTags(): void {
    if (!currentTagsList || !noCurrentTagsMsg) return;

    currentTagsList.innerHTML = '';

    if (editingTags.length === 0) {
      noCurrentTagsMsg.hidden = false;
      return;
    }

    noCurrentTagsMsg.hidden = true;

    editingTags.forEach(tag => {
      const tagItem = document.createElement('span');
      tagItem.className = 'current-tag-item';
      tagItem.textContent = `#${tag}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'current-tag-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        editingTags = editingTags.filter(t => t !== tag);
        renderCurrentTags();
        updateTagCategorySelect();
      });

      tagItem.appendChild(removeBtn);
      currentTagsList.appendChild(tagItem);
    });
  }

  /**
   * タグカテゴリセレクトボックスを更新
   */
  async function updateTagCategorySelect(): Promise<void> {
    if (!tagCategorySelect || !addTagBtn) return;

    const settings = await getSettings();
    const categories = getAllCategories(settings);

    // 既存のタグを除外
    const availableCategories = categories.filter(c => !editingTags.includes(c));

    tagCategorySelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = getMessage('selectCategory') || 'カテゴリを選択...';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    tagCategorySelect.appendChild(defaultOption);

    availableCategories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      tagCategorySelect.appendChild(option);
    });

    addTagBtn.disabled = availableCategories.length === 0;
  }

  /**
   * タグを追加
   */
  function addTag(): void {
    if (!tagCategorySelect || !tagCategorySelect.value) return;
    const newTag = tagCategorySelect.value;
    if (!editingTags.includes(newTag)) {
      editingTags.push(newTag);
      renderCurrentTags();
      updateTagCategorySelect();
    }
    tagCategorySelect.value = '';
  }

  /**
   * タグ編集を保存
   */
  async function saveTagEdits(): Promise<void> {
    if (!editingUrl) return;

    try {
      await setUrlTags(editingUrl, editingTags);

      // エントリの更新
      const entryIndex = entries.findIndex(e => e.url === editingUrl);
      if (entryIndex !== -1) {
        entries[entryIndex].tags = editingTags;
      }

      closeTagEditModal();
      applyFilters(false);
    } catch (error) {
      console.error('[Dashboard] Failed to save tags:', error);
      alert(getMessage('saveTagError') || 'タグの保存に失敗しました');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // タグ編集モーダルのイベントハンドラ
  // ─────────────────────────────────────────────────────────────────────────────

  closeTagEditModalBtn?.addEventListener('click', closeTagEditModal);

  tagEditModal?.addEventListener('click', (e) => {
    if (e.target === tagEditModal) {
      closeTagEditModal();
    }
  });

  tagCategorySelect?.addEventListener('change', () => {
    if (addTagBtn) addTagBtn.disabled = !tagCategorySelect.value;
  });

  addTagBtn?.addEventListener('click', addTag);

  saveTagEditsBtn?.addEventListener('click', saveTagEdits);

  renderPendingPage();
}

export { initHistoryPanel, showRecordError, checkServiceWorkerAlive };
