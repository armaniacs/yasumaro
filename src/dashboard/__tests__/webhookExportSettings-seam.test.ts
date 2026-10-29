// @vitest-environment jsdom
/**
 * webhookExportSettings-seam.test.ts
 * PBI 2026-10-22-05 boxes (a)(b) ― dashboard controller seam test: the
 * condition form persists through the injected store, history renders
 * textContent-only with origins (never full URLs), and resend flows through
 * the injected seams.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drainMacrotask, waitForMock } from '../../../testDir/waitPolicy.js';
import { createWebhookExportSettingsUi } from '../webhookExportSettings.js';
import type { WebhookExportHistoryStore } from '../../background/webhookExport/webhookExportHistory.js';
import type { WebhookExportStore } from '../../background/webhookExport/webhookExportSettings.js';

function setupDOM(): void {
  document.body.innerHTML = `
    <input type="checkbox" id="webhookExportEnabled" />
    <input type="text" id="webhookExportUrl" />
    <input type="text" id="webhookExportTag" />
    <input type="number" id="webhookExportMinScroll" />
    <input type="number" id="webhookExportMinDuration" />
    <button id="webhookExportSaveBtn">Save</button>
    <div id="webhookExportStatus"></div>
    <div id="webhookExportHistoryList"></div>
    <button id="webhookExportReloadBtn">Reload</button>
  `;
}

function memorySettingsStore(seed = ''): WebhookExportStore & { saved: string[] } {
  let value = seed;
  const saved: string[] = [];
  return {
    saved,
    get: async (_key: string): Promise<string | null> => (value === '' ? null : value),
    set: async (_key: string, next: string): Promise<void> => {
      value = next;
      saved.push(next);
    },
  };
}

function memoryHistoryStore(seed = ''): WebhookExportHistoryStore {
  let value = seed;
  return {
    get: async (_key: string): Promise<string | null> => (value === '' ? null : value),
    set: async (_key: string, next: string): Promise<void> => {
      value = next;
    },
  };
}

describe('webhookExportSettings dashboard seam', () => {
  beforeEach(() => {
    setupDOM();
  });

  it('loads persisted settings into the form and renders history origins', async () => {
    const settingsStore = memorySettingsStore(
      JSON.stringify({ enabled: true, url: 'https://hooks.example.com/h', condition: { tag: 'web' } }),
    );
    const historyStore = memoryHistoryStore(
      JSON.stringify([
        {
          key: 'yasumaro-r1-aa11bb22',
          recordId: 'r1',
          origin: 'https://hooks.example.com',
          status: 'sent',
          reason: 'delivered',
          charCount: 42,
          createdAt: 1700000000000,
          resentCount: 0,
        },
      ]),
    );
    const controller = createWebhookExportSettingsUi({ settingsStore, historyStore });
    controller.init();
    await controller.load();
    expect((document.getElementById('webhookExportEnabled') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('webhookExportUrl') as HTMLInputElement).value).toBe(
      'https://hooks.example.com/h',
    );
    expect((document.getElementById('webhookExportTag') as HTMLInputElement).value).toBe('web');
    const rows = document.querySelectorAll('#webhookExportHistoryList .webhook-export-history-row');
    expect(rows).toHaveLength(1);
    // Origin only — the token-bearing path never renders.
    expect(rows[0]?.textContent).toContain('https://hooks.example.com');
    expect(rows[0]?.textContent).not.toContain('hooks.example.com/h');
    // The record resolver is not wired here: the Resend button never renders
    // (it would always fail with "not wired in this view").
    expect(document.querySelectorAll('#webhookExportHistoryList .webhook-export-resend')).toHaveLength(0);
  });

  it('saves the transfer condition through the injected store', async () => {
    const settingsStore = memorySettingsStore();
    const controller = createWebhookExportSettingsUi({ settingsStore, historyStore: memoryHistoryStore() });
    controller.init();
    (document.getElementById('webhookExportEnabled') as HTMLInputElement).checked = true;
    (document.getElementById('webhookExportUrl') as HTMLInputElement).value = 'https://hooks.example.com/h';
    (document.getElementById('webhookExportTag') as HTMLInputElement).value = '#obsidian';
    (document.getElementById('webhookExportMinScroll') as HTMLInputElement).value = '50';
    document.getElementById('webhookExportSaveBtn')?.click();
    await waitForMock(() => {
      expect(settingsStore.saved).toHaveLength(1);
    });
    const saved = JSON.parse(settingsStore.saved[0] as string) as {
      enabled: boolean;
      url: string;
      condition: { tag?: string; minScrollDepth?: number };
    };
    expect(saved.enabled).toBe(true);
    expect(saved.url).toBe('https://hooks.example.com/h');
    expect(saved.condition.tag).toBe('#obsidian');
    expect(saved.condition.minScrollDepth).toBe(50);
  });

  it('resends through the injected seams and refreshes history', async () => {
    const historyStore = memoryHistoryStore(
      JSON.stringify([
        {
          key: 'k1',
          recordId: 'r9',
          origin: 'https://hooks.example.com',
          status: 'failed',
          reason: 'http-500',
          charCount: 10,
          createdAt: 1700000000000,
          resentCount: 0,
        },
      ]),
    );
    const resend = vi.fn(async (_record: unknown, _settings: unknown, _force: boolean) => ({ ok: true, message: 'redelivered' }));
    const resolveRecord = vi.fn(async (recordId: string) => ({
      id: recordId,
      title: 't',
      url: 'https://example.com/x',
      summary: 's',
      tags: [],
    }));
    const controller = createWebhookExportSettingsUi({
      settingsStore: memorySettingsStore(),
      historyStore,
      resolveRecord,
      resend,
    });
    controller.init();
    await controller.load();
    // The resolver seam is wired, so the Resend button renders.
    expect(document.querySelectorAll('#webhookExportHistoryList .webhook-export-resend')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('.webhook-export-resend')?.click();
    await waitForMock(() => {
      expect(resend).toHaveBeenCalledTimes(1);
    });
    expect(resolveRecord).toHaveBeenCalledWith('r9');
    const resendCall = resend.mock.calls[0];
    if (!resendCall) throw new Error('expected one resend call');
    expect(resendCall[2]).toBe(true);
    await drainMacrotask();
  });
});
