/**
 * reporter.mjs — Stage 5 of the GA Release Smoke Runner.
 *
 * Generates:
 *  - `report.json` (machine-readable full trace)
 *  - `report.md` (Shift-JIS-compliant summary + ready-to-paste tables matching
 *    `dev-docs/manual-tests/release-ga-smoke.md`)
 *  - Secret-leak guard: refuses to emit a report if any tracked secret string
 *    appears anywhere in the serialized output.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Map internal step status to Shift-JIS-safe Japanese checklist label. */
export function formatStatusLabel(status) {
  switch (status) {
    case 'pass':
      return '合格(自動)';
    case 'partial':
      return '一部自動(UI手動待ち)';
    case 'skipped':
      return '保留';
    case 'fail':
      return '不合格';
    default:
      return '未';
  }
}

/**
 * Sanitize text so generated Markdown obeys the repo's Shift-JIS docs rule
 * (`scripts/check-docs-chars.mjs`): replaces EM DASH and common out-of-range
 * punctuation with JIS equivalents.
 */
export function sanitizeForShiftJisDocs(text) {
  return String(text)
    .replaceAll('\u2014', '―')
    .replaceAll('\u2013', '-')
    .replaceAll('\u2264', '≦')
    .replaceAll('\u2265', '≧')
    .replaceAll('\u2248', '≒')
    .replaceAll('\u2022', '・');
}

/**
 * Verify that none of the tracked secrets (API keys, Obsidian key, webhook
 * tokens) appear in the report text. Throws loudly on any leak.
 */
export function assertNoSecretLeak(text, secrets = []) {
  for (const secret of secrets) {
    if (secret && secret.length >= 6 && text.includes(secret)) {
      throw new Error('Secret leak detected in smoke report output — aborting write');
    }
  }
}

/**
 * Render the Markdown report (10-flow result matrix + run log section).
 */
export function renderMarkdownReport({ metadata, suitesByBrowser, localeResults }) {
  const browsers = ['chrome', 'edge', 'firefox'];
  const flowIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const rows = flowIds.map((id) => {
    const cells = browsers.map((b) => {
      const suite = suitesByBrowser[b];
      if (!suite) return '未';
      const step = suite.results.find((r) => r.id === id);
      return step ? formatStatusLabel(step.status) : '未';
    });
    const notes = browsers
      .map((b) => {
        const step = suitesByBrowser[b]?.results.find((r) => r.id === id);
        return step?.note ? `${b}: ${step.note}` : '';
      })
      .filter(Boolean)
      .join(' / ');
    return `| ${id} | ${cells.join(' | ')} | ${sanitizeForShiftJisDocs(notes).replaceAll('|', '/')} |`;
  });

  const browserSummary = (b) => {
    const suite = suitesByBrowser[b];
    const ver = suite?.browserVersion || metadata.browsers?.[b]?.version || '未実施';
    if (!suite) return `${ver} / 未実施`;
    const failed = suite.results.filter((r) => r.status === 'fail').length;
    const partial = suite.results.filter((r) => r.status === 'partial').length;
    const passed = suite.results.filter((r) => r.status === 'pass').length;
    return `${ver} / 合格 ${passed}・一部自動 ${partial}・不合格 ${failed}`;
  };

  const localeNote = localeResults
    ? Object.entries(localeResults)
        .map(([loc, info]) => `${loc}: ${info.ok ? '合格' : '不合格'} (rawMsg=${info.hasRawMsg})`)
        .join(', ')
    : '未実施';

  const lines = [
    `# GA スモーク自動テスト結果 (${metadata.extensionVersion})`,
    '',
    '## 結果記録表',
    '',
    '| # | Chrome | Edge | Firefox | 備考 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## 実施ログ',
    '',
    `- 実施日: ${metadata.date}`,
    `- 拡張の版: ${metadata.extensionVersion} (manifest: ${metadata.manifestVersion}, git: ${metadata.gitSha})`,
    `- OS: ${metadata.os}`,
    `- Chrome の版 / 結果: ${browserSummary('chrome')}`,
    `- Edge の版 / 結果: ${browserSummary('edge')}`,
    `- Firefox の版 / 結果: ${browserSummary('firefox')}`,
    `- 日本語 UI / 英語 UI の確認: ${localeNote}`,
    '- 不合格と修正 PBI へのリンク: なし',
    '',
  ];

  return sanitizeForShiftJisDocs(lines.join('\n'));
}

/** Write `report.json` and `report.md` into `reportDir` after secret checking. */
export function writeSmokeReports({ reportDir, metadata, suitesByBrowser, localeResults, secrets = [] }) {
  mkdirSync(reportDir, { recursive: true });

  const jsonPayload = JSON.stringify({ metadata, suitesByBrowser, localeResults }, null, 2);
  const markdownPayload = renderMarkdownReport({ metadata, suitesByBrowser, localeResults });

  assertNoSecretLeak(jsonPayload, secrets);
  assertNoSecretLeak(markdownPayload, secrets);

  const jsonPath = path.join(reportDir, 'report.json');
  const mdPath = path.join(reportDir, 'report.md');
  writeFileSync(jsonPath, jsonPayload, 'utf-8');
  writeFileSync(mdPath, markdownPayload, 'utf-8');

  return { jsonPath, mdPath, markdownPayload };
}

/**
 * Append a versioned run log entry to `dev-docs/manual-tests/release-ga-smoke.md`
 * when `--write-log` is explicitly requested.
 */
export function appendRunLogToChecklist(checklistPath, markdownPayload) {
  const current = readFileSync(checklistPath, 'utf-8');
  const logStart = markdownPayload.indexOf('## 実施ログ');
  const logSection = logStart >= 0 ? markdownPayload.slice(logStart) : markdownPayload;
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const separator = `\n\n### 自動実行記録 (${localDate})\n\n`;
  const bodyWithoutHeading = logSection.replace(/^## 実施ログ\s*\n*/, '');
  writeFileSync(checklistPath, `${current.trimEnd()}${separator}${bodyWithoutHeading.trimEnd()}\n`, 'utf-8');
}
