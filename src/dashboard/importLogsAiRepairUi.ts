/**
 * importLogsAiRepairUi.ts
 * PBI 2026-11-23-06 / 指摘11-14: 却下行の収集→AI提案→差分確認→選択取込の
 * 画面入口。importLogsAiRepair.ts 本体の振舞いは変えず、ここで4関数を
 * 明示操作で順に呼ぶだけにする。
 *
 * - 自動送信・自動取込はしない。送信 (request) と取込 (apply) は各ボタンの
 *   明示操作でのみ実行する。
 * - AI呼出しは既存の后台AI経路への適合層 (importLogsAiRepairClient.ts) を
 *   既定とし、新規の外部送信経路 (fetch 等) を持たない。
 * - 鍵の施錠中は使えない案内を出し、送信も取込もしない。
 */

import {
  collectAiRepairTargets,
  requestAiRepair,
  applyAiRepairProposals,
  formatAiRepairDiff,
} from './importLogsAiRepair.js';
import type {
  AiRepairClient,
  AiRepairProposal,
  AiRepairTarget,
} from './importLogsAiRepair.js';
import type { ImportLogsResult } from './importLogsService.js';
import { isLocked } from '../utils/storage/authGuard.js';
import { getMessageOr } from '../utils/i18n.js';
import { clearElement } from '../utils/domClear.js';

export interface AiRepairUiOptions {
  /** 取込ファイルの解析済み内容を返す。収集は入口ボタン押下時に行う。 */
  getParsed: () => unknown;
  /** 明示操作時にだけ使われる AI クライアントの生成。既定は遅延解決の本番適合層。 */
  clientFactory?: () => AiRepairClient | null | Promise<AiRepairClient | null>;
  /** 送信シーム。既定は requestAiRepair (現状APIのまま使う)。 */
  requestFn?: (
    targets: AiRepairTarget[],
    opts: { client: AiRepairClient | null; lockCheck?: (() => Promise<boolean>) | undefined }
  ) => Promise<{ proposals: AiRepairProposal[]; failures: Array<{ index: number; reason: string }> } | { error: string }>;
  /** 取込シーム。既定は applyAiRepairProposals (現状APIのまま使う)。 */
  applyFn?: (
    proposals: AiRepairProposal[],
    selectedIndexes: number[]
  ) => Promise<{ applied: number; rejected: Array<{ index: number; reason: string }> } | { error: string }>;
  /** 施錠判定シーム。既定は authGuard.isLocked。 */
  lockCheck?: () => Promise<boolean>;
  /** 差分整形シーム。既定は formatAiRepairDiff。 */
  formatDiffFn?: (proposal: AiRepairProposal) => string;
}

export interface AiRepairUi {
  mount(container: HTMLElement): void;
  showForResult(result: ImportLogsResult): void;
  destroy(): void;
}

async function defaultClientFactory(): Promise<AiRepairClient | null> {
  const mod = await import('./importLogsAiRepairClient.js');
  return mod.createDefaultAiRepairClient();
}

function isErrorResult(
  result: ImportLogsResult
): result is Extract<ImportLogsResult, { error: string }> {
  return 'error' in result;
}

export function createAiRepairUi(options: AiRepairUiOptions): AiRepairUi {
  const requestFn =
    options.requestFn ??
    ((targets: AiRepairTarget[], opts: { client: AiRepairClient | null; lockCheck?: (() => Promise<boolean>) | undefined }) =>
      requestAiRepair(targets, opts));
  const applyFn = options.applyFn ?? applyAiRepairProposals;
  const lockCheck = options.lockCheck ?? isLocked;
  const formatDiffFn = options.formatDiffFn ?? formatAiRepairDiff;
  const clientFactory = options.clientFactory ?? defaultClientFactory;

  let container: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let lastProposals: AiRepairProposal[] = [];
  let pendingTargets: AiRepairTarget[] = [];

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  function clearBody(): void {
    if (!container) return;
    clearElement(container);
    statusEl = null;
    listEl = null;
    lastProposals = [];
    pendingTargets = [];
  }

  function renderFailures(failures: Array<{ index: number; reason: string }>): void {
    if (!container || failures.length === 0) return;
    const note = document.createElement('div');
    note.className = 'diag-result';
    note.textContent = failures.map((f) => `row ${f.index}: ${f.reason}`).join('; ');
    container.appendChild(note);
  }

  function renderProposals(proposals: AiRepairProposal[]): void {
    if (!container || !listEl) return;
    clearElement(listEl);
    for (const proposal of proposals) {
      const row = document.createElement('label');
      row.className = 'ai-repair-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('data-ai-repair-select', '');
      checkbox.value = String(proposal.index);
      checkbox.checked = false;
      row.appendChild(checkbox);

      const diff = document.createElement('pre');
      diff.setAttribute('data-ai-repair-diff', '');
      diff.textContent = formatDiffFn(proposal);
      row.appendChild(diff);

      listEl.appendChild(row);
    }

    if (proposals.length > 0 && container) {
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'secondary-btn';
      applyBtn.setAttribute('data-ai-repair-apply', '');
      applyBtn.textContent = getMessageOr('aiRepairApplySelected', 'Import selected repairs');
      applyBtn.addEventListener('click', () => {
        void handleApply();
      });
      container.appendChild(applyBtn);
    }
  }

  async function handleRequest(): Promise<void> {
    if (await lockCheck()) {
      setStatus(
        getMessageOr(
          'aiRepairLocked',
          'AI repair is unavailable while the session is locked. Unlock first.'
        )
      );
      return;
    }
    setStatus(getMessageOr('aiRepairCollecting', 'Collecting rejected rows...'));
    const collected = collectAiRepairTargets(options.getParsed());
    if ('error' in collected) {
      setStatus(collected.error);
      return;
    }
    pendingTargets = collected.targets;
    if (pendingTargets.length === 0) {
      setStatus(getMessageOr('aiRepairNoTargets', 'No rejected rows to repair.'));
      return;
    }
    const client = await clientFactory();
    if (!client) {
      setStatus(getMessageOr('aiRepairNoClient', 'AI repair client is not configured.'));
      return;
    }
    setStatus(getMessageOr('aiRepairRequesting', 'Requesting AI proposals...'));
    const requested = await requestFn(pendingTargets, { client });
    if ('error' in requested) {
      setStatus(requested.error);
      return;
    }
    lastProposals = requested.proposals;
    if (lastProposals.length === 0) {
      setStatus(getMessageOr('aiRepairNoProposals', 'No AI proposals were returned.'));
      renderFailures(requested.failures);
      return;
    }
    setStatus(
      getMessageOr('aiRepairReview', 'Review the proposals and import the selected rows.')
    );
    renderProposals(lastProposals);
    renderFailures(requested.failures);
  }

  async function handleApply(): Promise<void> {
    if (!container) return;
    const checked = [...container.querySelectorAll<HTMLInputElement>('[data-ai-repair-select]')]
      .filter((el) => el.checked)
      .map((el) => Number(el.value))
      .filter((n) => Number.isFinite(n));
    const applied = await applyFn(lastProposals, checked);
    if ('error' in applied) {
      setStatus(applied.error);
      return;
    }
    const done = getMessageOr('aiRepairApplied', 'AI repair applied: %{applied} rows.')
      .replace('%{applied}', String(applied.applied));
    const rejected = applied.rejected.length > 0
      ? ` (${applied.rejected.map((r) => `row ${r.index}: ${r.reason}`).join('; ')})`
      : '';
    setStatus(`${done}${rejected}`);
  }

  return {
    mount(host: HTMLElement): void {
      container = host;
      clearBody();
    },
    showForResult(result: ImportLogsResult): void {
      if (!container) return;
      clearBody();
      if (isErrorResult(result)) return;
      if (!result.invalid || result.invalid <= 0) return;

      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'secondary-btn';
      entry.setAttribute('data-ai-repair-entry', '');
      entry.textContent = getMessageOr(
        'aiRepairEntry',
        'Propose AI repairs (%{invalid} rows)'
      ).replace('%{invalid}', String(result.invalid));
      entry.addEventListener('click', () => {
        void handleRequest();
      });
      container.appendChild(entry);

      statusEl = document.createElement('div');
      statusEl.className = 'diag-result';
      statusEl.setAttribute('aria-live', 'polite');
      container.appendChild(statusEl);

      listEl = document.createElement('div');
      container.appendChild(listEl);
    },
    destroy(): void {
      if (container) clearBody();
      container = null;
    },
  };
}
