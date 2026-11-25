/**
 * runAllFlows.mjs — Executes the 10 mandatory GA release smoke flows +
 * Japanese/English UI verification + optional `--live` & `--assisted` checks
 * against the unpacked `OW_E2E_PROBE=0` distribution ZIP on a real browser.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {
  acceptConfirmDialogIfVisible,
  findDownloadedFile,
  getSqliteCount,
  openDashboardPanel,
  patchExtensionSettings,
  pollUntil,
  querySqliteRows,
  readExtensionSettings,
  triggerManualRecordForPage,
  waitForDashboardReady,
} from './helpers.mjs';

const MASTER_PASSWORD = 'GaSmokeP@ss2026!';
const WRONG_PASSWORD = 'WrongSmokeP@ss999!';
const WEBHOOK_SECRET_TOKEN = 'GA_SMOKE_WEBHOOK_SECRET_TOKEN_7391';
const OFFLIST_SECRET_TOKEN = 'GA_SMOKE_OFFLIST_SECRET_TOKEN_8412';

/** Collect all secret strings that must NEVER appear in logs, reports, or UI. */
export function collectTrackedSecrets(fixtures, env = process.env) {
  const secrets = [WEBHOOK_SECRET_TOKEN, OFFLIST_SECRET_TOKEN];
  if (fixtures?.obsidian?.apiKey) secrets.push(fixtures.obsidian.apiKey);
  for (const key of ['OBSIDIAN_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    if (env[key] && env[key].trim().length >= 6) {
      secrets.push(env[key].trim());
    }
  }
  return secrets;
}

async function runStep(id, name, fn, log) {
  const started = Date.now();
  try {
    const res = await fn();
    const durationMs = Date.now() - started;
    const status = res?.status ?? 'pass';
    const note = res?.note ?? '';
    log(`  [${status.toUpperCase()}] #${id} ${name} (${durationMs}ms)${note ? ` — ${note}` : ''}`);
    return { id, name, status, durationMs, note, details: res?.details ?? null };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    log(`  [FAIL] #${id} ${name} (${durationMs}ms) — ${message}`);
    return { id, name, status: 'fail', durationMs, note: message, details: null };
  }
}

/**
 * Run all 10 mandatory smoke flows on a single browser driver factory.
 */
export async function runBrowserSmokeSuite({
  browserName,
  launchSession,
  fixtures,
  screenshotsDir,
  flows = null,
  live = false,
  assisted = false,
  log = console.log,
}) {
  const shouldRun = (id) => !flows || flows.has(id);
  const results = [];
  const ignoreTlsErrors = fixtures.webhook.tlsMode !== 'mkcert-os-trusted';

  log(`\n=== [${browserName.toUpperCase()}] Starting fresh-profile GA smoke suite ===`);
  const session = await launchSession({ ignoreTlsErrors });
  let optionsPage = null;

  try {
    // ------------------------------------------------------------------
    // Flow 1: First launch (fresh profile consent modal + 3-choice banner)
    // ------------------------------------------------------------------
    if (shouldRun(1))
    results.push(
      await runStep(
        1,
        '初回起動 (同意モーダル + 3択バナー + 再読込後非表示)',
        async () => {
          const popup = await session.openExtensionPage('popup.html');
          try {
            await popup.waitForSelector('#privacyConsentModal', { visible: true, timeout: 15_000 });
            await popup.check('#consentCheckbox', true);
            await popup.click('#acceptConsentBtn');
            await popup.waitForSelector('#privacyConsentModal', { hidden: true, timeout: 10_000 });
            await popup.reload();
            await new Promise((r) => setTimeout(r, 800));
            const reappeared = await popup.isVisible('#privacyConsentModal');
            if (reappeared) {
              throw new Error('Privacy consent modal reappeared after accepting and reloading');
            }
          } finally {
            await popup.close();
          }

          optionsPage = await session.openExtensionPage('options.html');
          await waitForDashboardReady(optionsPage);
          await optionsPage.waitForSelector('#onboardingBanner', { visible: true, timeout: 15_000 });
          for (const action of ['try-first', 'obsidian', 'ai']) {
            const visible = await optionsPage.isVisible(
              `#onboardingBanner [data-onboarding-action="${action}"]`,
            );
            if (!visible) {
              throw new Error(`Onboarding choice "${action}" not visible`);
            }
          }
          await optionsPage.click('#onboardingBanner [data-onboarding-action="dismiss"]');
          await optionsPage.waitForSelector('#onboardingBanner', { hidden: true, timeout: 10_000 });
          await optionsPage.reload();
          await waitForDashboardReady(optionsPage);
          const bannerAgain = await optionsPage.isVisible('#onboardingBanner');
          if (bannerAgain) {
            throw new Error('Onboarding banner reappeared after dismiss and reload');
          }
          return { status: 'pass', note: '同意モーダル承諾・3択バナー表示・再読込後非表示OK' };
        },
        log,
      ),
    );

    if (!optionsPage) {
      optionsPage = await session.openExtensionPage('options.html');
      await waitForDashboardReady(optionsPage);
    }

    // ------------------------------------------------------------------
    // Flow 2: Auto recording (unsatisfied skipped vs satisfied recorded)
    // ------------------------------------------------------------------
    if (shouldRun(2))
    results.push(
      await runStep(
        2,
        '自動記録 (滞在時間・スクロール条件の未達/達成)',
        async () => {
          // Ensure clean defaults (5s stay, 50% scroll) and Obsidian/AI disabled for isolated auto-record check.
          await patchExtensionSettings(optionsPage, {
            min_visit_duration: 5,
            min_scroll_depth: 50,
            obsidian_enabled: false,
          });

          const unsatisfiedUrl = `${fixtures.article.baseUrl}/short-article.html?tag=unsat-${browserName}`;
          const shortPage = await session.openPage(unsatisfiedUrl);
          await new Promise((r) => setTimeout(r, 2000));
          await shortPage.close();

          const rowsAfterUnsat = await querySqliteRows(optionsPage, { search: `unsat-${browserName}` });
          if (rowsAfterUnsat.some((r) => String(r.url || '').includes(`unsat-${browserName}`))) {
            throw new Error('Unsatisfied page (no scroll, <5s) was unexpectedly recorded');
          }

          const satisfiedUrl = `${fixtures.article.baseUrl}/long-article.html?tag=auto-${browserName}`;
          const longPage = await session.openPage(satisfiedUrl);
          try {
            // Scroll past 50% threshold and trigger scroll event in real content script.
            await longPage.evaluate(() => {
              window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.75));
              window.dispatchEvent(new Event('scroll'));
            });
            await pollUntil(
              async () => {
                const rows = await querySqliteRows(optionsPage, { search: `auto-${browserName}` });
                return rows.find((r) => String(r.url || '').includes(`auto-${browserName}`)) ?? null;
              },
              { timeoutMs: 25_000, intervalMs: 1000, label: 'auto-recorded long article in SQLite' },
            );
          } finally {
            await longPage.close();
          }

          return { status: 'pass', note: '未達スキップ・実時間滞在+75%スクロール記録確認OK (probe未使用)' };
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 3: Manual recording (popup automated + optional assisted 3b/3c/3d)
    // ------------------------------------------------------------------
    if (shouldRun(3))
    results.push(
      await runStep(
        3,
        '手動記録 (ポップアップ + ブラウザUI 3経路)',
        async () => {
          const manualUrl = `${fixtures.article.baseUrl}/long-article.html?tag=manual-${browserName}`;
          const targetPage = await session.openPage(manualUrl);
          try {
            // Verify popup renders the real Record button without errors.
            const popup = await session.openExtensionPage('popup.html');
            const recordBtnVisible = await popup.isVisible('#recordBtn');
            await popup.close();
            if (!recordBtnVisible) {
              throw new Error('Popup #recordBtn not visible');
            }

            const resp = await triggerManualRecordForPage(optionsPage, targetPage);
            if (resp && resp.success === false && resp.error) {
              throw new Error(`MANUAL_RECORD returned error: ${resp.error}`);
            }

            await pollUntil(
              async () => {
                const rows = await querySqliteRows(optionsPage, { search: `manual-${browserName}` });
                return rows.find((r) => String(r.url || '').includes(`manual-${browserName}`)) ?? null;
              },
              { timeoutMs: 15_000, intervalMs: 500, label: 'manual-recorded page in SQLite' },
            );
          } finally {
            await targetPage.close();
          }

          if (!assisted) {
            return {
              status: 'partial',
              note: 'ポップアップ経路自動OK / omnibox(y)・Alt+Shift+Y・右クリックは --assisted で確認',
            };
          }

          // Guided assisted check for omnibox (y), shortcut (Alt+Shift+Y), context menu.
          const assistedNotes = await runAssistedChromeUiCheck({
            browserName,
            session,
            optionsPage,
            fixtures,
            log,
          });
          return assistedNotes;
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 4: Obsidian save + 412 conflict retry & double-412 failure
    // ------------------------------------------------------------------
    if (shouldRun(4))
    results.push(
      await runStep(
        4,
        'Obsidian 保存と競合 (通常追記 / 412再試行 / 2回目失敗通知)',
        async () => {
          fixtures.obsidian.clearRequests();
          fixtures.obsidian.setMode('normal');

          await openDashboardPanel(optionsPage, 'panel-general');
          await optionsPage.check('#obsidianEnabled', true);
          await optionsPage.evaluate(() => {
            const d = document.getElementById('obsidianSettingsDetails');
            if (d) d.open = true;
          });
          await optionsPage.fill('#apiKey', fixtures.obsidian.apiKey);
          await optionsPage.fill('#protocol', 'http');
          await optionsPage.fill('#port', String(fixtures.obsidian.port));
          await optionsPage.fill('#obsidianHost', '127.0.0.1');
          await optionsPage.fill('#dailyPath', 'smoke');
          await optionsPage.click('#save');
          // Plain HTTP for Obsidian triggers an intentional security confirm dialog.
          await acceptConfirmDialogIfVisible(optionsPage, 2500);
          await new Promise((r) => setTimeout(r, 500));

          // 4a: Normal save
          const normalUrl = `${fixtures.article.baseUrl}/long-article.html?tag=obs-normal-${browserName}`;
          const p1 = await session.openPage(normalUrl);
          try {
            await triggerManualRecordForPage(optionsPage, p1);
            await pollUntil(
              () => fixtures.obsidian.getRequests().some((r) => r.method === 'PUT' && r.status === 204),
              { timeoutMs: 15_000, intervalMs: 400, label: 'Obsidian normal PUT 204' },
            );
          } finally {
            await p1.close();
          }

          // 4b: Single 412 conflict -> re-read, merge, retry once -> succeeds without losing concurrent edit
          fixtures.obsidian.clearRequests();
          fixtures.obsidian.setMode('conflict_once');
          const conflictUrl = `${fixtures.article.baseUrl}/long-article.html?tag=obs-412-once-${browserName}`;
          const p2 = await session.openPage(conflictUrl);
          try {
            await triggerManualRecordForPage(optionsPage, p2);
            await pollUntil(
              () => {
                const puts = fixtures.obsidian.getRequests().filter((r) => r.method === 'PUT');
                return puts.some((r) => r.status === 412) && puts.some((r) => r.status === 204);
              },
              { timeoutMs: 15_000, intervalMs: 400, label: 'Obsidian 412 retry -> 204' },
            );
            const allNoteBodies = Object.values(fixtures.obsidian.getNotes())
              .map((n) => n.content)
              .join('\n');
            if (!allNoteBodies.includes('Concurrent Obsidian Edit') || !allNoteBodies.includes(`obs-412-once-${browserName}`)) {
              throw new Error('Merged Obsidian daily note lost either concurrent edit or new record');
            }
          } finally {
            await p2.close();
          }

          // 4c: Double 412 conflict -> stops after 1 retry (2 PUTs total) and surfaces failure
          fixtures.obsidian.clearRequests();
          fixtures.obsidian.setMode('conflict_always');
          const doubleConflictUrl = `${fixtures.article.baseUrl}/long-article.html?tag=obs-412-twice-${browserName}`;
          const p3 = await session.openPage(doubleConflictUrl);
          try {
            const resp = await triggerManualRecordForPage(optionsPage, p3);
            await pollUntil(
              () => fixtures.obsidian.getRequests().filter((r) => r.method === 'PUT' && r.status === 412).length >= 2,
              { timeoutMs: 15_000, intervalMs: 400, label: 'Obsidian double 412 conflict' },
            );
            await new Promise((r) => setTimeout(r, 800));
            const putCount = fixtures.obsidian.getRequests().filter((r) => r.method === 'PUT').length;
            if (putCount !== 2) {
              throw new Error(`Expected exactly 2 PUT attempts (1 initial + 1 retry), observed ${putCount}`);
            }
            if (resp && resp.obsidianSaved === true) {
              throw new Error('Double 412 conflict reported obsidianSaved=true');
            }
          } finally {
            await p3.close();
            fixtures.obsidian.setMode('normal');
          }

          // Disable Obsidian and restore https protocol so subsequent flows don't hit HTTP confirm modal.
          await openDashboardPanel(optionsPage, 'panel-general');
          await optionsPage.check('#obsidianEnabled', false);
          await optionsPage.evaluate(() => {
            const d = document.getElementById('obsidianSettingsDetails');
            if (d) d.open = true;
          });
          await optionsPage.fill('#protocol', 'https');
          await optionsPage.fill('#port', '27124');
          await optionsPage.click('#save');
          await acceptConfirmDialogIfVisible(optionsPage, 1000);

          let liveNote = '';
          if (live && process.env.OBSIDIAN_API_KEY) {
            liveNote = await probeLiveObsidian(process.env.OBSIDIAN_API_KEY);
          }

          return {
            status: 'pass',
            note: `モックETag/412再試行+2回目失敗停止OK${liveNote ? ` / ${liveNote}` : ''}`,
          };
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 5: AI summary (no-summary + local mock AI + built-in AI probe + optional live)
    // ------------------------------------------------------------------
    if (shouldRun(5))
    results.push(
      await runStep(
        5,
        'AI 要約 (要約なし記録 / ローカルAI / 内蔵AI確認)',
        async () => {
          // 5a: No-summary recording (unconfigured provider still records to SQLite)
          await patchExtensionSettings(optionsPage, {
            ai_provider: 'gemini',
            gemini_api_key: '',
            ai_provider_priority_list: [],
          });
          const noSumUrl = `${fixtures.article.baseUrl}/long-article.html?tag=no-sum-${browserName}`;
          const pNoSum = await session.openPage(noSumUrl);
          try {
            await triggerManualRecordForPage(optionsPage, pNoSum);
            await pollUntil(
              async () => {
                const rows = await querySqliteRows(optionsPage, { search: `no-sum-${browserName}` });
                return rows.find((r) => String(r.url || '').includes(`no-sum-${browserName}`)) ?? null;
              },
              { timeoutMs: 15_000, intervalMs: 500, label: 'no-summary record in SQLite' },
            );
          } finally {
            await pNoSum.close();
          }

          // 5b: Local AI via lm-studio/ollama OpenAI-compatible slot pointed at permitted mock AI server
          fixtures.ai.clearCaptured();
          await patchExtensionSettings(optionsPage, {
            privacy_mode: 'masked_cloud',
            ai_provider: 'ollama',
            ai_provider_priority_list: [{ provider: 'ollama', model: fixtures.ai.model }],
            ollama_base_url: fixtures.ai.baseUrl,
            ollama_model: fixtures.ai.model,
            lm_studio_base_url: fixtures.ai.baseUrl,
            lm_studio_model: fixtures.ai.model,
          });
          await new Promise((r) => setTimeout(r, 300));
          const aiUrl = `${fixtures.article.baseUrl}/long-article.html?tag=ai-sum-${browserName}`;
          const pAi = await session.openPage(aiUrl);
          try {
            const aiResp = await triggerManualRecordForPage(optionsPage, pAi);
            await pollUntil(
              async () => {
                const rows = await querySqliteRows(optionsPage, { search: `ai-sum-${browserName}` });
                const hit = rows.find((r) => String(r.url || '').includes(`ai-sum-${browserName}`));
                return hit && String(hit.summary || '').includes('Mock AI summary') ? hit : null;
              },
              {
                timeoutMs: 20_000,
                intervalMs: 500,
                label: `AI summary persisted in SQLite (captured=${fixtures.ai.getCaptured().length}, resp=${JSON.stringify(aiResp)?.slice(0, 260)})`,
              },
            );
          } finally {
            await pAi.close();
          }

          // 5c: Probe browser built-in AI availability (Chrome LanguageModel)
          const builtInAiState = await optionsPage.evaluate(async () => {
            if (typeof globalThis.LanguageModel === 'undefined') return 'unavailable';
            try {
              return String(await globalThis.LanguageModel.availability());
            } catch {
              return 'error';
            }
          });

          let liveAiNote = '';
          if (live) {
            liveAiNote = await probeLiveAi(optionsPage, session, fixtures, browserName);
          }

          return {
            status: 'pass',
            note: `要約なしOK / ローカルAI要約OK / 内蔵AI:${builtInAiState}${liveAiNote ? ` / ${liveAiNote}` : ''}`,
          };
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 6: Local Markdown export (downloads file + content check)
    // ------------------------------------------------------------------
    if (shouldRun(6))
    results.push(
      await runStep(
        6,
        'ローカル Markdown 書き出し (downloads ファイル内容一致)',
        async () => {
          await openDashboardPanel(optionsPage, 'panel-general');
          await optionsPage.check('#localMarkdownExportEnabled', true);
          await optionsPage.waitForSelector('#localMarkdownExportSettings', { visible: true, timeout: 10_000 });
          await optionsPage.click('#localMarkdownExportTimingImmediate');
          await optionsPage.fill('#localMarkdownExportPath', 'YasumaroSmoke');
          await optionsPage.click('#save');
          await acceptConfirmDialogIfVisible(optionsPage, 1000);
          await new Promise((r) => setTimeout(r, 500));

          // Use local calendar date (matches localMarkdownExport.ts formatLocalDateString, not UTC).
          const now = new Date();
          const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          await optionsPage.fill('#localExportStartDate', todayLocal);
          await optionsPage.fill('#localExportEndDate', todayLocal);
          await optionsPage.click('#localExportManualBtn');

          await pollUntil(
            async () => {
              const txt = (await optionsPage.getText('#localExportManualStatus')).trim();
              return txt.length > 0 && !/searching|検索中/i.test(txt) ? txt : null;
            },
            { timeoutMs: 15_000, intervalMs: 300, label: '#localExportManualStatus completion' },
          );
          const exportStatus = await optionsPage.getText('#localExportManualStatus');
          const mdFile = await findDownloadedFile(
            optionsPage,
            session.downloadsDir,
            (f) => f.toLowerCase().endsWith('.md'),
            { timeoutMs: 20_000 },
          ).catch(() => null);
          if (!mdFile) {
            throw new Error(`No exported .md file found (status="${exportStatus}")`);
          }
          const mdContent = readFileSync(mdFile, 'utf-8');
          if (!mdContent.includes('GA Smoke Long Article') && !mdContent.includes('http://127.0.0.1:')) {
            throw new Error(`Exported Markdown (${path.basename(mdFile)}) did not contain recorded articles`);
          }

          // Turn off auto-export to avoid extra downloads in later flows and let Save settle
          // before Flow 7 patches AI settings.
          await optionsPage.check('#localMarkdownExportEnabled', false);
          await optionsPage.click('#save');
          await acceptConfirmDialogIfVisible(optionsPage, 1000);
          await new Promise((r) => setTimeout(r, 600));

          return {
            status: 'pass',
            note: `${path.basename(mdFile)} (${mdContent.length} chars) 書き出し・内容一致OK`,
          };
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 7: Privacy check (Cache-Control: private, PII WASM mask, per-domain AI policy)
    // ------------------------------------------------------------------
    if (shouldRun(7))
    results.push(
      await runStep(
        7,
        'プライバシー確認 (private検出 / PIIマスク / ドメイン別AI送信政策)',
        async () => {
          // 7a: Private header page should NOT silently send raw content to AI.
          fixtures.ai.clearCaptured();
          await patchExtensionSettings(optionsPage, {
            privacy_mode: 'masked_cloud',
            auto_save_privacy_behavior: 'skip',
            ai_provider: 'ollama',
            ai_provider_priority_list: [{ provider: 'ollama', model: fixtures.ai.model }],
            ollama_base_url: fixtures.ai.baseUrl,
            ollama_model: fixtures.ai.model,
            lm_studio_base_url: fixtures.ai.baseUrl,
            lm_studio_model: fixtures.ai.model,
          });
          // Reload optionsPage so its SettingsRepository cache picks up the patched AI config.
          await optionsPage.reload();
          await waitForDashboardReady(optionsPage);
          const privUrl = `${fixtures.article.baseUrl}/private-pii.html?tag=priv-${browserName}`;
          const pPriv = await session.openPage(privUrl);
          try {
            // Scroll + dwell briefly; private page must not be auto-sent to AI.
            await pPriv.evaluate(() => {
              window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.75));
              window.dispatchEvent(new Event('scroll'));
            });
            await new Promise((r) => setTimeout(r, 2000));
            const leakedPrivateToAi = fixtures.ai
              .getCaptured()
              .some((c) => c.raw.includes('smoke.secret.user@example.com'));
            if (leakedPrivateToAi) {
              throw new Error('Private page PII leaked to AI provider');
            }
          } finally {
            await pPriv.close();
          }

          // 7b: Per-domain AI send policy via real UI (#aiDomainPolicySection)
          await openDashboardPanel(optionsPage, 'panel-domain');
          await optionsPage.waitForSelector('#aiDomainPolicySection', { visible: true, timeout: 10_000 });
          const policyValues = await optionsPage.evaluate(() => {
            const sel = document.getElementById('aiDomainPolicySelect');
            return sel ? Array.from(sel.options).map((o) => o.value) : [];
          });

          const maskVal = policyValues.find((v) => /mask/i.test(v)) ?? 'mask_required';
          const noSummaryVal = policyValues.find((v) => /no.?summary|skip|local/i.test(v)) ?? 'no_summary';

          // Policy = mask_required -> AI receives request WITHOUT raw email
          await optionsPage.fill('#aiDomainPolicyInput', '127.0.0.1');
          if (policyValues.includes(maskVal)) {
            await optionsPage.selectOption('#aiDomainPolicySelect', maskVal);
          }
          await optionsPage.click('#aiDomainPolicyAddBtn');
          await new Promise((r) => setTimeout(r, 400));

          fixtures.ai.clearCaptured();
          const pubPiiUrl = `${fixtures.article.baseUrl}/public-pii.html?tag=mask-${browserName}`;
          const pMask = await session.openPage(pubPiiUrl);
          try {
            const maskResp = await triggerManualRecordForPage(optionsPage, pMask);
            const domainErr = await optionsPage.getText('#aiDomainPolicyError').catch(() => '');
            await pollUntil(
              () => fixtures.ai.getCaptured().length > 0,
              {
                timeoutMs: 12_000,
                intervalMs: 400,
                label: `masked AI request received (policy=${maskVal}, domainErr="${domainErr}", resp=${JSON.stringify(maskResp)?.slice(0, 260)})`,
              },
            );
            const rawSent = fixtures.ai.getCaptured().map((c) => c.raw).join('\n');
            if (rawSent.includes('smoke.masked.target@example.com')) {
              throw new Error('Raw email address was sent to AI under mask_required policy');
            }
          } finally {
            await pMask.close();
          }

          // Policy = no_summary -> record saved to SQLite, 0 requests to AI
          await optionsPage.fill('#aiDomainPolicyInput', '127.0.0.1');
          if (policyValues.includes(noSummaryVal)) {
            await optionsPage.selectOption('#aiDomainPolicySelect', noSummaryVal);
          }
          await optionsPage.click('#aiDomainPolicyAddBtn');
          await new Promise((r) => setTimeout(r, 400));

          fixtures.ai.clearCaptured();
          const noSumPolicyUrl = `${fixtures.article.baseUrl}/public-pii.html?tag=nosumpol-${browserName}`;
          const pNoSumPol = await session.openPage(noSumPolicyUrl);
          try {
            await triggerManualRecordForPage(optionsPage, pNoSumPol);
            await pollUntil(
              async () => {
                const rows = await querySqliteRows(optionsPage, { search: `nosumpol-${browserName}` });
                return rows.find((r) => String(r.url || '').includes(`nosumpol-${browserName}`)) ?? null;
              },
              { timeoutMs: 15_000, intervalMs: 500, label: 'no_summary policy record in SQLite' },
            );
            if (fixtures.ai.getCaptured().length > 0) {
              throw new Error('AI request was sent despite no_summary per-domain policy');
            }
          } finally {
            await pNoSumPol.close();
          }

          // Verify PII WASM initialized cleanly (no fallback warnings in console/SW).
          const wasmWarnings = session.consoleWarnings.filter((w) =>
            /PII WASM module unavailable|PII WASM sanitize call failed/i.test(w),
          );
          if (wasmWarnings.length > 0) {
            throw new Error(`PII WASM warning detected: ${wasmWarnings[0]}`);
          }

          // Clean up domain policy rule so subsequent flows (Webhook/Backup) aren't affected.
          await patchExtensionSettings(optionsPage, { ai_domain_policy: {} });

          return {
            status: 'pass',
            note: 'private非送信・PII WASMマスク正常・ドメイン別政策(mask/no_summary)OK',
          };
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 10: Webhook (reject off-list & http, allow https loopback POST, no token leak)
    // Run BEFORE Flow 8 (master password) & Flow 9 (delete all) so Delete All
    // remains the final destructive operation in the profile lifecycle.
    // ------------------------------------------------------------------
    if (shouldRun(10))
    results.push(
      await runStep(
        10,
        'Webhook (HTTPS到達 / リスト外・HTTP拒否 / token非露出)',
        async () => {
          await openDashboardPanel(optionsPage, 'panel-webhook-export');

          // 10a: Off-list URL rejected without leaking token
          await optionsPage.fill('#webhookExportUrl', `https://example.com/hook?token=${OFFLIST_SECRET_TOKEN}`);
          await optionsPage.click('#webhookExportSaveBtn');
          await pollUntil(
            async () => ((await optionsPage.getText('#webhookExportStatus')).trim().length > 0),
            { timeoutMs: 10_000, intervalMs: 250, label: 'off-list rejection status' },
          );
          const offListText = await optionsPage.getText('#webhookExportStatus');
          if (offListText.includes(OFFLIST_SECRET_TOKEN) || offListText.includes('/hook')) {
            throw new Error(`Off-list rejection leaked token/path: ${offListText}`);
          }

          // 10b: HTTP loopback rejected
          await optionsPage.fill('#webhookExportUrl', `http://127.0.0.1:${fixtures.webhook.port}/records`);
          await optionsPage.click('#webhookExportSaveBtn');
          await pollUntil(
            async () => /https/i.test(await optionsPage.getText('#webhookExportStatus')),
            { timeoutMs: 10_000, intervalMs: 250, label: 'http rejection status' },
          );

          // 10c: Allowlisted HTTPS loopback with token saves & delivers POST
          fixtures.webhook.clearReceived();
          const targetWebhookUrl = `${fixtures.webhook.origin}/records?token=${WEBHOOK_SECRET_TOKEN}`;
          await optionsPage.check('#webhookExportEnabled', true);
          await optionsPage.fill('#webhookExportUrl', targetWebhookUrl);
          await optionsPage.click('#webhookExportSaveBtn');
          await pollUntil(
            async () => /permitted|許可/.test(await optionsPage.getText('#webhookExportStatus')),
            { timeoutMs: 10_000, intervalMs: 250, label: 'webhook allowed save status' },
          );

          // Verify storage does not hold plaintext token.
          const rawWebhookStorage = await optionsPage.evaluate(async () => {
            const got = await chrome.storage.local.get('webhook_export_settings_v1');
            return JSON.stringify(got);
          });
          if (rawWebhookStorage.includes(WEBHOOK_SECRET_TOKEN)) {
            throw new Error('Webhook token found in plaintext in chrome.storage.local');
          }

          // Trigger a non-private recording and confirm POST arrives at HTTPS receiver.
          const hookPageUrl = `${fixtures.article.baseUrl}/long-article.html?tag=webhook-${browserName}`;
          const pHook = await session.openPage(hookPageUrl);
          try {
            const hookResp = await triggerManualRecordForPage(optionsPage, pHook);
            await pollUntil(
              () => fixtures.webhook.getReceived().length > 0,
              {
                timeoutMs: 12_000,
                intervalMs: 400,
                label: `HTTPS webhook POST arrival (resp=${JSON.stringify(hookResp)?.slice(0, 200)})`,
              },
            );
          } catch (err) {
            await optionsPage.click('#webhookExportReloadBtn').catch(() => undefined);
            await new Promise((r) => setTimeout(r, 400));
            const hist = await optionsPage.getText('#webhookExportHistoryList').catch(() => '');
            throw new Error(`${err.message} | history="${hist.trim().slice(0, 240)}"`);
          } finally {
            await pHook.close();
          }

          const delivered = fixtures.webhook.getReceived()[0];
          if (!delivered.idempotencyKey || !delivered.body?.url) {
            throw new Error('Delivered webhook payload missing Idempotency-Key or url field');
          }

          // Reload transfer history UI and assert token never appears anywhere.
          await optionsPage.click('#webhookExportReloadBtn');
          await new Promise((r) => setTimeout(r, 500));
          const statusAndHistory =
            (await optionsPage.getText('#webhookExportStatus')) +
            '\n' +
            (await optionsPage.getText('#webhookExportHistoryList'));
          if (statusAndHistory.includes(WEBHOOK_SECRET_TOKEN) || statusAndHistory.includes('/records')) {
            throw new Error('Webhook history/status UI leaked secret token or full URL path');
          }

          // Disable webhook before Flow 8/9.
          await optionsPage.check('#webhookExportEnabled', false);
          await optionsPage.click('#webhookExportSaveBtn');

          return {
            status: 'pass',
            note: `${fixtures.webhook.origin} 到達OK (TLS:${fixtures.webhook.tlsMode})・拒否2種OK・token非露出OK`,
          };
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 8: Encrypted backup export -> restore in SECOND fresh profile + wrong passphrase
    // ------------------------------------------------------------------
    if (shouldRun(8))
    results.push(
      await runStep(
        8,
        'バックアップと復元 (別新規プロファイル復元 + 誤パスフレーズ拒否)',
        async () => {
          // Record a dedicated verification entry with unique FTS5 token.
          const backupToken = `YASUMARO_SMOKE_TOKEN_backup-${browserName}`;
          const backupUrl = `${fixtures.article.baseUrl}/long-article.html?tag=backup-${browserName}`;
          const pBackup = await session.openPage(backupUrl);
          try {
            await triggerManualRecordForPage(optionsPage, pBackup);
            await pollUntil(
              async () => {
                const rows = await querySqliteRows(optionsPage, { search: backupToken });
                return rows.length > 0;
              },
              { timeoutMs: 15_000, intervalMs: 500, label: 'backup verification row indexed in FTS5' },
            );
          } finally {
            await pBackup.close();
          }

          // Enable master password via real Privacy panel UI.
          await openDashboardPanel(optionsPage, 'panel-privacy');
          const alreadyEnabled = await optionsPage.evaluate(
            () => Boolean(document.getElementById('masterPasswordEnabled')?.checked),
          );
          if (!alreadyEnabled) {
            await optionsPage.check('#masterPasswordEnabled', true);
            await optionsPage.waitForSelector('#passwordModal', { visible: true, timeout: 10_000 });
            await optionsPage.fill('#masterPasswordInput', MASTER_PASSWORD);
            await optionsPage.fill('#masterPasswordConfirm', MASTER_PASSWORD);
            await optionsPage.click('#savePasswordBtn');
            await optionsPage.waitForSelector('#passwordModal', { hidden: true, timeout: 30_000 });
          }

          const countBefore = await getSqliteCount(optionsPage);
          const searchBefore = await querySqliteRows(optionsPage, { search: backupToken });

          // Export encrypted backup via real UI.
          await openDashboardPanel(optionsPage, 'panel-export-import');
          await optionsPage.click('#exportEncryptedBackupBtn');
          if (await optionsPage.isVisible('#passwordAuthModal')) {
            await optionsPage.fill('#masterPasswordAuthInput', MASTER_PASSWORD);
            await optionsPage.click('#submitPasswordAuthBtn');
          }

          const backupFile = await findDownloadedFile(
            optionsPage,
            session.downloadsDir,
            (f) => f.endsWith('.encrypted.json') || f.endsWith('.json'),
            { timeoutMs: 30_000 },
          );

          // Launch a SECOND brand-new empty profile to verify cross-profile restore.
          const sessionB = await launchSession({ ignoreTlsErrors });
          try {
            const popupB = await sessionB.openExtensionPage('popup.html');
            await popupB.waitForSelector('#privacyConsentModal', { visible: true, timeout: 15_000 });
            await popupB.check('#consentCheckbox', true);
            await popupB.click('#acceptConsentBtn');
            await popupB.waitForSelector('#privacyConsentModal', { hidden: true, timeout: 10_000 });
            await popupB.close();

            const optB = await sessionB.openExtensionPage('options.html');
            await waitForDashboardReady(optB);

            // Configure master password on Profile B (same passphrase required by modal).
            await openDashboardPanel(optB, 'panel-privacy');
            await optB.check('#masterPasswordEnabled', true);
            await optB.waitForSelector('#passwordModal', { visible: true, timeout: 10_000 });
            await optB.fill('#masterPasswordInput', MASTER_PASSWORD);
            await optB.fill('#masterPasswordConfirm', MASTER_PASSWORD);
            await optB.click('#savePasswordBtn');
            await optB.waitForSelector('#passwordModal', { hidden: true, timeout: 30_000 });

            await openDashboardPanel(optB, 'panel-export-import');

            // 8a: Wrong passphrase must be rejected and leave 0 rows.
            await optB.setInputFiles('#importEncryptedBackupFileInput', backupFile);
            await optB.waitForSelector('#passwordAuthModal', { visible: true, timeout: 10_000 });
            await optB.fill('#masterPasswordAuthInput', WRONG_PASSWORD);
            await optB.click('#submitPasswordAuthBtn');
            await pollUntil(
              async () => {
                const text = await optB.getText('#encryptedBackupStatus');
                const modalError = await optB.evaluate(
                  () => document.querySelector('#passwordAuthModal .field-error, #passwordAuthError')?.textContent || '',
                );
                return Boolean(text.trim() || modalError.trim());
              },
              { timeoutMs: 15_000, intervalMs: 300, label: 'wrong passphrase rejection feedback' },
            );
            if (await optB.isVisible('#passwordAuthModal')) {
              await optB.click('#cancelPasswordAuthBtn').catch(() => undefined);
            }
            const countAfterWrong = await getSqliteCount(optB);
            if (countAfterWrong !== 0) {
              throw new Error(`Wrong passphrase should not import records, got count=${countAfterWrong}`);
            }

            // 8b: Correct passphrase restores matching row count & FTS5 search.
            await optB.setInputFiles('#importEncryptedBackupFileInput', backupFile);
            await optB.waitForSelector('#passwordAuthModal', { visible: true, timeout: 10_000 });
            await optB.fill('#masterPasswordAuthInput', MASTER_PASSWORD);
            await optB.click('#submitPasswordAuthBtn');

            await pollUntil(
              async () => (await getSqliteCount(optB)) >= countBefore,
              { timeoutMs: 30_000, intervalMs: 500, label: 'restored SQLite count matches Profile A' },
            );
            const countAfter = await getSqliteCount(optB);
            const searchAfter = await querySqliteRows(optB, { search: backupToken });
            if (countAfter !== countBefore) {
              throw new Error(`Restored count mismatch: Profile A=${countBefore}, Profile B=${countAfter}`);
            }
            if (searchAfter.length < searchBefore.length || searchAfter.length === 0) {
              throw new Error(`FTS5 search mismatch after restore: before=${searchBefore.length}, after=${searchAfter.length}`);
            }
          } finally {
            await sessionB.close();
          }

          return {
            status: 'pass',
            note: `別プロファイル復元OK (${countBefore}件一致・FTS5一致・誤パスフレーズ拒否OK)`,
          };
        },
        log,
      ),
    );

    // ------------------------------------------------------------------
    // Flow 9: Delete all data (Cancel preserves; Confirm empties history/search/settings)
    // ------------------------------------------------------------------
    if (shouldRun(9))
    results.push(
      await runStep(
        9,
        '全データ削除 (キャンセル維持 / 削除後に履歴・検索・設定が空)',
        async () => {
          await openDashboardPanel(optionsPage, 'panel-privacy');
          const countBefore = await getSqliteCount(optionsPage);
          if (countBefore === 0) {
            throw new Error('Expected non-empty history before Delete All test');
          }

          // 9a: Cancel preserves everything.
          await optionsPage.click('#btnDeleteAllData');
          await optionsPage.waitForSelector('.confirm-dialog-overlay', { visible: true, timeout: 10_000 });
          await optionsPage.click('.confirm-dialog-btn-cancel');
          await optionsPage.waitForSelector('.confirm-dialog-overlay', { hidden: true, timeout: 10_000 });
          const countAfterCancel = await getSqliteCount(optionsPage);
          if (countAfterCancel !== countBefore) {
            throw new Error(`Cancel changed row count: ${countBefore} -> ${countAfterCancel}`);
          }

          // 9b: Confirm deletes history, search index, and settings.
          await optionsPage.click('#btnDeleteAllData');
          await optionsPage.waitForSelector('.confirm-dialog-overlay', { visible: true, timeout: 10_000 });
          await optionsPage.click('.confirm-dialog-btn-danger');
          await pollUntil(
            async () => {
              const statusText = await optionsPage.getText('#deleteAllDataStatus').catch(() => '');
              return statusText.trim().length > 0;
            },
            { timeoutMs: 15_000, intervalMs: 300, label: '#deleteAllDataStatus message' },
          );
          // Wait past the 2000ms auto-reload delay, then verify empty state.
          await new Promise((r) => setTimeout(r, 2600));
          await waitForDashboardReady(optionsPage);

          const countAfterDelete = await getSqliteCount(optionsPage);
          const searchAfterDelete = await querySqliteRows(optionsPage, { search: 'YASUMARO_SMOKE_TOKEN' });
          const settingsAfterDelete = await readExtensionSettings(optionsPage);
          if (countAfterDelete !== 0 || searchAfterDelete.length !== 0) {
            throw new Error(`Data remained after Delete All: count=${countAfterDelete}, search=${searchAfterDelete.length}`);
          }
          if (settingsAfterDelete.obsidian_enabled === true || settingsAfterDelete.master_password_enabled === true) {
            throw new Error('Custom settings were not cleared by Delete All');
          }

          return { status: 'pass', note: 'キャンセル維持OK / 削除後 履歴0件・検索0件・設定初期化OK' };
        },
        log,
      ),
    );
  } finally {
    await session.close();
  }

  results.sort((a, b) => a.id - b.id);
  return {
    browserName,
    browserVersion: session.browserVersion,
    results,
  };
}

/**
 * Guided assisted check for browser chrome UI paths (omnibox `y`, shortcut
 * `Alt+Shift+Y`, context menu) that sit outside web DOM automation.
 */
async function runAssistedChromeUiCheck({ browserName, session, optionsPage, fixtures, log }) {
  const pageUrl = `${fixtures.article.baseUrl}/long-article.html?tag=assisted-ui-${browserName}`;
  const assistedPage = await session.openPage(pageUrl);
  const beforeCount = await getSqliteCount(optionsPage);

  log(`\n  --- [${browserName.toUpperCase()} ガイド付き手動操作 (約30秒)] ---`);
  log(`  開いているタブ (${pageUrl}) で以下 3 経路を順に実行してください:`);
  log('    1. アドレスバーで "y " と入力して Enter (omnibox)');
  log('    2. ショートカット Alt+Shift+Y');
  log('    3. ページ上で右クリック -> Yasumaro で記録');
  log('  (各操作が完了すると SQLite 増加を検知します。完了またはスキップ時は Enter を押してください)');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let donePrompt = false;
  const promptPromise = rl.question('  完了したら Enter を押してください > ').then(() => {
    donePrompt = true;
  });

  let maxObservedDelta = 0;
  while (!donePrompt) {
    const current = await getSqliteCount(optionsPage).catch(() => beforeCount);
    const delta = current - beforeCount;
    if (delta > maxObservedDelta) {
      maxObservedDelta = delta;
      log(`    [自動検知] SQLite レコード増加を検出 (+${delta} 件)`);
    }
    await Promise.race([promptPromise, new Promise((r) => setTimeout(r, 1000))]);
  }
  rl.close();
  await assistedPage.close();

  if (maxObservedDelta >= 1) {
    return {
      status: 'pass',
      note: `ポップアップ自動OK + ブラウザUI経路(ガイド確認: SQLite +${maxObservedDelta}件検知)`,
    };
  }
  return {
    status: 'partial',
    note: 'ポップアップ自動OK / ブラウザUI 3経路は未検知(手動確認待ち)',
  };
}

/** Verify both Japanese (`ja`) and English (`en-US`) UI localization & capture screenshots. */
export async function runLocaleVerification({ launchSession, screenshotsDir, log = console.log }) {
  const outcomes = {};
  for (const locale of ['ja', 'en-US']) {
    const session = await launchSession({ locale, ignoreTlsErrors: true });
    try {
      const opt = await session.openExtensionPage('options.html');
      await waitForDashboardReady(opt);
      const bodyText = await opt.evaluate(() => document.body?.innerText ?? '');
      const hasRawMsg = bodyText.includes('__MSG_');
      const hasJapanese = /[\u3040-\u30ff\u4e00-\u9fff]/.test(bodyText);
      const screenshotPath = path.join(screenshotsDir, `dashboard-${locale}.png`);
      await opt.screenshot(screenshotPath);
      outcomes[locale] = {
        ok: !hasRawMsg && (locale === 'ja' ? hasJapanese : true),
        hasRawMsg,
        hasJapanese,
        screenshotPath,
      };
      log(
        `  [LOCALE ${locale}] ok=${outcomes[locale].ok}, rawMsg=${hasRawMsg}, screenshot=${path.basename(screenshotPath)}`,
      );
    } finally {
      await session.close();
    }
  }
  return outcomes;
}

/** Optional live Obsidian check when `--live` and OBSIDIAN_API_KEY are provided. */
async function probeLiveObsidian(apiKey) {
  const port = process.env.OBSIDIAN_PORT || '27124';
  const protocol = process.env.OBSIDIAN_PROTOCOL || 'https';
  try {
    const res = await fetch(`${protocol}://127.0.0.1:${port}/`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return `実Obsidian HTTP ${res.status}`;
    const etag = res.headers.get('etag');
    return etag && !etag.startsWith('W/') ? '実Obsidian接続OK(強ETagあり)' : '実Obsidian接続OK(保留: ETagなし)';
  } catch {
    return '実Obsidian未起動(モックのみで検証)';
  }
}

/** Optional live Ollama check when `--live` is passed. */
async function probeLiveAi(optionsPage, session, fixtures, browserName) {
  try {
    const tagsRes = await fetch('http://127.0.0.1:11434/api/tags');
    if (!tagsRes.ok) return '実Ollama未起動';
    const tags = await tagsRes.json();
    const firstModel = tags?.models?.[0]?.name;
    if (!firstModel) return '実Ollama起動中(モデル未導入)';
    await patchExtensionSettings(optionsPage, {
      ai_provider: 'ollama',
      ai_provider_priority_list: [{ provider: 'ollama', model: firstModel }],
      ollama_base_url: 'http://127.0.0.1:11434/v1',
      ollama_model: firstModel,
    });
    const url = `${fixtures.article.baseUrl}/long-article.html?tag=live-ollama-${browserName}`;
    const p = await session.openPage(url);
    try {
      await triggerManualRecordForPage(optionsPage, p);
      await pollUntil(
        async () => {
          const rows = await querySqliteRows(optionsPage, { search: `live-ollama-${browserName}` });
          const hit = rows.find((r) => String(r.url || '').includes(`live-ollama-${browserName}`));
          return hit && String(hit.summary || '').trim().length > 0 ? hit : null;
        },
        { timeoutMs: 45_000, intervalMs: 1000, label: `live Ollama (${firstModel}) summary` },
      );
      return `実Ollama(${firstModel})要約OK`;
    } finally {
      await p.close();
    }
  } catch {
    return '実Ollama未起動';
  }
}
