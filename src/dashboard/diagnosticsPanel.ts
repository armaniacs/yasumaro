// ============================================================================
// Diagnostics Panel
// ============================================================================

import { getMessage } from '../popup/i18n.js';
import { getSettings, StorageKeys } from '../utils/storage.js';
import { getSavedUrlCount } from '../utils/storageUrls.js';
import { UI_COLORS } from '../constants/appConstants.js';
import { getSqliteStatus } from './dashboardSqliteService.js';

/**
 * Creates a stat row element for the diagnostics panel
 * @param label - The label text for the stat
 * @param value - The value text for the stat
 * @param masked - Whether the value should be displayed as masked (for sensitive info)
 * @returns HTMLElement - The created stat row div
 */
function makeStatRow(label: string, value: string, masked = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'diag-stat-row';
  const valueHtml = masked
    ? `<span class="diag-stat-value diag-stat-masked">${value}</span>`
    : `<span class="diag-stat-value">${value}</span>`;
  row.innerHTML = `<span class="diag-stat-label">${label}</span>${valueHtml}`;
  return row;
}

/**
 * Initializes the diagnostics panel with storage stats, extension info,
 * Obsidian/AI settings display, and connection test functionality.
 */
async function initDiagnosticsPanel(): Promise<void> {
  const storageStats = document.getElementById('diagStorageStats') as HTMLElement | null;
  const extInfo = document.getElementById('diagExtInfo') as HTMLElement | null;
  const diagTestObsidianBtn = document.getElementById('diagTestObsidianBtn') as HTMLButtonElement | null;
  const diagTestAiBtn = document.getElementById('diagTestAiBtn') as HTMLButtonElement | null;
  const connectionResult = document.getElementById('diagConnectionResult') as HTMLElement | null;
  const obsidianSettingsEl = document.getElementById('diagObsidianSettings') as HTMLElement | null;
  const aiSettingsEl = document.getElementById('diagAiSettings') as HTMLElement | null;

  // Obsidian / AI 設定情報
  try {
    const settings = await getSettings();

    if (obsidianSettingsEl) {
      const protocol = (settings[StorageKeys.OBSIDIAN_PROTOCOL] as string) || 'https';
      const port = (settings[StorageKeys.OBSIDIAN_PORT] as string) || '27124';
      const apiKey = (settings[StorageKeys.OBSIDIAN_API_KEY] as string) || '';
      const dailyPath = (settings[StorageKeys.OBSIDIAN_DAILY_PATH] as string) || '';

      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagProtocol') || 'Protocol',
        protocol
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagPort') || 'Port',
        port
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagRestUrl') || 'REST API URL',
        `${protocol}://127.0.0.1:${port}`
      ));
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagDailyPath') || 'Daily Note Path',
        dailyPath || (getMessage('defaultValue') || '(default)')
      ));
      const configuredLabel = getMessage('configured') || '(configured)';
      const notSetLabel = getMessage('notSet') || '(not set)';
      obsidianSettingsEl.appendChild(makeStatRow(
        getMessage('diagApiKey') || 'API Key',
        apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
        !apiKey
      ));
    }

    if (aiSettingsEl) {
      const provider = (settings[StorageKeys.AI_PROVIDER] as string) || 'gemini';
      const providerLabels: Record<string, string> = {
        gemini: 'Google Gemini',
        openai: 'OpenAI Compatible',
        openai2: 'OpenAI Compatible 2',
      };
      aiSettingsEl.appendChild(makeStatRow(
        getMessage('diagProvider') || 'Provider',
        providerLabels[provider] || provider
      ));

      const configuredLabel = getMessage('configured') || '(configured)';
      const notSetLabel = getMessage('notSet') || '(not set)';

      if (provider === 'gemini') {
        const model = (settings[StorageKeys.GEMINI_MODEL] as string) || '';
        const key = (settings[StorageKeys.GEMINI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      } else if (provider === 'openai') {
        const baseUrl = (settings[StorageKeys.OPENAI_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagBaseUrl') || 'Base URL',
          baseUrl || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      } else if (provider === 'openai2') {
        const baseUrl = (settings[StorageKeys.OPENAI_2_BASE_URL] as string) || '';
        const model = (settings[StorageKeys.OPENAI_2_MODEL] as string) || '';
        const key = (settings[StorageKeys.OPENAI_2_API_KEY] as string) || '';
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagBaseUrl') || 'Base URL',
          baseUrl || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagModel') || 'Model',
          model || notSetLabel
        ));
        aiSettingsEl.appendChild(makeStatRow(
          getMessage('diagApiKey') || 'API Key',
          key ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel,
          !key
        ));
      }
    }
  } catch {
    if (obsidianSettingsEl) {
      obsidianSettingsEl.textContent = getMessage('diagLoadError') || '設定の読み込みに失敗しました。';
    }
  }

  // Storage stats
  if (storageStats) {
    try {
      const bytesUsed = await chrome.storage.local.getBytesInUse(null);
      const kb = (bytesUsed / 1024).toFixed(1);
      const urlCount = await getSavedUrlCount();

      storageStats.appendChild(makeStatRow(
        getMessage('diagStorageUsed') || 'Storage Used',
        `${kb} KB`
      ));
      storageStats.appendChild(makeStatRow(
        getMessage('diagSavedUrls') || 'Saved URLs',
        String(urlCount)
      ));
    } catch {
      storageStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
    }
  }

  // SQLite status
  const sqliteStats = document.getElementById('diagSqliteStats') as HTMLElement | null;
  const diagTestSqliteBtn = document.getElementById('diagTestSqliteBtn') as HTMLButtonElement | null;
  const sqliteResult = document.getElementById('diagSqliteResult') as HTMLElement | null;

  if (sqliteStats) {
    try {
      const status = await getSqliteStatus();
      if (status) {
        const initializedText = status.initialized
          ? (getMessage('diagSqliteAvailable') || 'Available')
          : (getMessage('diagSqliteUnavailable') || 'Unavailable');
        sqliteStats.appendChild(makeStatRow(
          getMessage('diagSqliteStatus') || 'Status',
          initializedText
        ));
        sqliteStats.appendChild(makeStatRow(
          getMessage('diagSqlitePath') || 'Path',
          status.path || '(none)'
        ));
        const fallbackText = status.fallback
          ? (getMessage('diagSqliteFallbackYes') || 'Yes (using fallback storage)')
          : (getMessage('diagSqliteFallbackNo') || 'No (native SQLite)');
        sqliteStats.appendChild(makeStatRow(
          getMessage('diagSqliteFallback') || 'Fallback Mode',
          fallbackText
        ));
      } else {
        sqliteStats.textContent = getMessage('diagSqliteCheckFailed') || 'Failed to check SQLite status.';
      }
    } catch {
      sqliteStats.textContent = getMessage('diagLoadError') || 'Failed to load storage info.';
    }
  }

  // Extension info
  if (extInfo) {
    const manifest = chrome.runtime.getManifest();
    extInfo.appendChild(makeStatRow(
      getMessage('diagVersion') || 'Version',
      manifest.version
    ));
    extInfo.appendChild(makeStatRow(
      getMessage('diagExtName') || 'Extension',
      manifest.name
    ));
  }

  // プレースホルダーテキストをdata属性にセット（CSS ::before で表示）
  if (connectionResult) {
    connectionResult.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
  }

  // Obsidian 接続テスト
  diagTestObsidianBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    diagTestObsidianBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_OBSIDIAN',
        payload: {}
      }) as { obsidian?: { success: boolean; message: string } };

      const obsidian = testResult?.obsidian;
      connectionResult.textContent = obsidian
        ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = obsidian?.success ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})` : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestObsidianBtn.disabled = false;
    }
  });

  // AI 接続テスト
  diagTestAiBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    diagTestAiBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_AI',
        payload: {}
      }) as { ai?: { success: boolean; message: string } };

      const ai = testResult?.ai;
      connectionResult.textContent = ai
        ? `AI: ${ai.success ? '✓' : '✗'} ${ai.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = ai?.success ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})` : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } catch (e) {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestAiBtn.disabled = false;
    }
  });

  // SQLite テスト
  diagTestSqliteBtn?.addEventListener('click', async () => {
    if (!sqliteResult) return;
    diagTestSqliteBtn.disabled = true;
    sqliteResult.textContent = getMessage('testing') || 'Testing...';
    sqliteResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'DASHBOARD_SQLITE',
        payload: { subtype: 'status' }
      }) as { success: boolean; initialized?: boolean; fallback?: boolean; error?: string };

      if (testResult.success) {
        const status = testResult.initialized
          ? (getMessage('diagSqliteTestOk') || 'SQLite is working correctly.')
          : (getMessage('diagSqliteTestInitFailed') || 'SQLite initialization failed.');
        sqliteResult.textContent = testResult.initialized ? `✓ ${status}` : `✗ ${status}`;
        sqliteResult.style.color = testResult.initialized
          ? `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`
          : `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
      } else {
        sqliteResult.textContent = `✗ ${testResult.error || 'SQLite test failed.'}`;
        sqliteResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
      }
    } catch (e) {
      sqliteResult.textContent = getMessage('testError') || 'Connection test failed.';
      sqliteResult.style.color = `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
    } finally {
      diagTestSqliteBtn.disabled = false;
    }
  });
}

export { initDiagnosticsPanel };
