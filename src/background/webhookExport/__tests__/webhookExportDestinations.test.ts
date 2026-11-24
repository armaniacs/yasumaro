/**
 * webhookExportDestinations.test.ts (PBI 2026-10-31-12, narrowed PBI 2026-11-24-18)
 *
 * The webhook-specific destination allowlist and the single judgment source
 * shared by the save-time pre-flight and the send-time gate. Pins:
 *
 *   - the narrowed set is loopback-only (16 patterns: 8 http dead
 *     grandfather + 8 https functional); AI-provider patterns and the Gist
 *     egress are gone on purpose (owner裁定 run-3 NV-1);
 *   - the narrowed list is intentionally DIVERGED from the declared manifest
 *     host_permissions (the manifest keeps AI/Gist hosts for their own
 *     features; the webhook gate must not follow it);
 *   - save judgment === send judgment for every URL (same judgment source —
 *     a save-permitted destination is never send-blocked);
 *   - BDD scenario 4: the migration wording (existing destinations are part
 *     of the initial set) is carried by the settings screen and by
 *     README / PRIVACY.
 *
 * The declared manifest is read the same way manifest.test.ts reads it: the
 * wxt.config.ts manifest factory is called directly, so a factory that stops
 * declaring host_permissions is a red test, not a skip.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WEBHOOK_EXPORT_DESTINATION_PATTERNS,
  judgeWebhookDestination,
} from '../webhookExportDestinations.js';
import { defaultIsWebhookHostPermitted } from '../webhookExportSender.js';
import type { UserManifest } from 'wxt';
// Intentional deviation from the ".js extensions on all imports" convention
// (AGENTS.md): wxt.config.ts is the root build config, not a compiled module —
// no .js form exists for it, and vitest (vite) resolves the .ts directly.
import wxtConfig from '../../../../wxt.config.ts';

/** Mirrors manifest.test.ts: calls the wxt.config.ts manifest factory for the Chromium MV3 target. */
function declaredHostPermissions(): string[] {
  const factory = wxtConfig.manifest;
  if (typeof factory !== 'function') {
    throw new Error('wxt.config.ts no longer declares the manifest as a factory — update this pin');
  }
  const declared = factory({ mode: 'production', command: 'build', browser: 'chromium', manifestVersion: 3 });
  if (declared instanceof Promise) {
    throw new Error('wxt.config.ts manifest factory is async — resolve it here so the pin fails instead of hanging');
  }
  const host = (declared as UserManifest).host_permissions;
  if (host === undefined) {
    throw new Error('wxt.config.ts declares no host_permissions — the webhook allowlist pin cannot run');
  }
  return host;
}

function readFromRoot(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

describe('webhook 宛先許可リストの pin（PBI 2026-11-24-18 narrow）', () => {
  it('narrowed 集合は loopback 16 パターン（http 8 + https 8）である', () => {
    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS).toHaveLength(16);
    const http = WEBHOOK_EXPORT_DESTINATION_PATTERNS.filter((pattern) => pattern.startsWith('http://'));
    const https = WEBHOOK_EXPORT_DESTINATION_PATTERNS.filter((pattern) => pattern.startsWith('https://'));
    expect(http).toHaveLength(8);
    expect(https).toHaveLength(8);
    const loopbackHttps = https.filter((pattern) => /^https:\/\/(127\.0\.0\.1|localhost):\d+\//.test(pattern));
    expect(loopbackHttps).toHaveLength(8);
  });

  it('第三者エンドポイント（AI プロバイダ・Gist）を含まない', () => {
    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS).not.toContain('https://api.openai.com/*');
    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS).not.toContain('https://*.openai.com/*');
    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS).not.toContain('https://api.github.com/*');
    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS.some((pattern) => pattern.includes('openai'))).toBe(false);
    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS.some((pattern) => pattern.includes('github'))).toBe(false);
  });

  it('宣言 manifest（AI/Gist を残す 31）から意図的に乖離し、loopback 部分集合である', () => {
    const declared = declaredHostPermissions();
    expect(declared).toHaveLength(31);
    // The webhook gate no longer follows the manifest: AI/Gist hosts stay
    // declared for their own features, but the webhook list must not widen.
    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS).not.toEqual(declared);
    for (const pattern of WEBHOOK_EXPORT_DESTINATION_PATTERNS) {
      expect(declared).toContain(pattern);
    }
  });
});

describe('保存/送信が同一判定源を共有する pin（保存 OK ⇒ 送信 NG が再現しない）', () => {
  /** Every judgment class: permitted, unlisted (incl. removed AI/Gist), non-https, empty/invalid, ported loopback. */
  const judgedUrls: readonly string[] = [
    'https://127.0.0.1:27123/hook',
    'https://localhost:11434/hook',
    'https://api.github.com/x',
    'https://api.openai.com/v1',
    'https://sub.openai.com/v1',
    'https://api.ai.sakura.ad.jp/v1',
    'https://hooks.example.com/hook',
    'http://127.0.0.1:27123/hook',
    'http://hooks.example.com/hook',
    'https://127.0.0.1:9999/hook',
    '',
    'not a url',
    'file:///etc/passwd',
  ];

  it('保存時判定と送信時判定が全 URL で一致する', async () => {
    for (const url of judgedUrls) {
      const verdict = judgeWebhookDestination(url);
      const sendPermitted = await defaultIsWebhookHostPermitted(url);
      // The URL rides the compared strings (vitest/valid-expect takes at most
      // 1 argument), so a mismatch names the URL in the diff.
      expect(`${url} → ${sendPermitted}`).toBe(`${url} → ${verdict.permitted}`);
    }
  });

  it('保存で許可された宛先が送信ゲートで拒否されない', async () => {
    for (const url of judgedUrls) {
      const verdict = judgeWebhookDestination(url);
      if (verdict.permitted) {
        await expect(defaultIsWebhookHostPermitted(url)).resolves.toBe(true);
      }
    }
  });

  it('送信ゲートが許可した宛先が保存判定で拒否されない（逆方向も一致）', async () => {
    for (const url of judgedUrls) {
      const sendPermitted = await defaultIsWebhookHostPermitted(url);
      if (sendPermitted) {
        const verdict = judgeWebhookDestination(url);
        expect(`${url} → ${verdict.permitted}`).toBe(`${url} → ${sendPermitted}`);
      }
    }
  });
});

describe('judgeWebhookDestination（表駆動）', () => {
  it('許可 origin（loopback のみ）は permitted', () => {
    const permitted = [
      'https://127.0.0.1:27123/hook',
      'https://localhost:27124/x',
    ];
    for (const url of permitted) {
      // The URL rides the compared object (vitest/valid-expect takes at most
      // 1 argument), so a mismatch names the URL in the diff.
      expect({ url, ...judgeWebhookDestination(url) }).toEqual({
        url,
        permitted: true,
        reason: 'permitted',
        origin: new URL(url).origin,
      });
    }
  });

  it('狭めで外れた第三者 origin（AI プロバイダ・Gist）は理由付きで非許可（発火デモの緑）', () => {
    const removed = [
      'https://api.openai.com/v1',
      'https://sub.openai.com/v1',
      'https://api.ai.sakura.ad.jp/v1',
      'https://mistral.ai/x',
      'https://api.github.com/x',
    ];
    for (const url of removed) {
      expect({ url, ...judgeWebhookDestination(url) }).toEqual({
        url,
        permitted: false,
        reason: 'destination-not-in-allowlist',
        origin: new URL(url).origin,
      });
    }
  });

  it('許可リスト外 origin は理由付きで非許可', () => {
    const unlisted = [
      'https://hooks.example.com/hook',
      'https://example.com/x',
      'https://127.0.0.1:9999/hook',
    ];
    for (const url of unlisted) {
      expect({ url, ...judgeWebhookDestination(url) }).toEqual({
        url,
        permitted: false,
        reason: 'destination-not-in-allowlist',
        origin: new URL(url).origin,
      });
    }
  });

  it('https 以外と空/不正 URL は理由付きで非許可', () => {
    const nonHttps = [
      'http://127.0.0.1:27123/hook',
      'http://hooks.example.com/x',
      '',
      'not a url',
      'file:///etc/passwd',
    ];
    for (const url of nonHttps) {
      const verdict = judgeWebhookDestination(url);
      expect({ url, permitted: verdict.permitted, reason: verdict.reason }).toEqual({
        url,
        permitted: false,
        reason: 'non-https-or-empty-destination',
      });
    }
    expect(judgeWebhookDestination('').origin).toBe('');
  });

  it('理由表示は origin 単位で、token を含み得る URL 全文を露出しない', () => {
    const verdict = judgeWebhookDestination('https://hooks.example.com/hook?token=secret');
    // The origin alone — the path and the token query never ride the verdict.
    expect(verdict.origin).toBe('https://hooks.example.com');
    expect(verdict.origin).not.toContain('hook?token=secret');
    expect(verdict.origin).not.toContain('token=secret');
  });
});

describe('BDD scenario 4: 既存宛先の扱いが設定画面とドキュメントで明示される', () => {
  it('設定画面が data-i18n で移行文言を持つ', () => {
    const html = readFromRoot('entrypoints/options/index.html');
    expect(html).toContain('data-i18n="webhookExportLegacyOrigins"');
  });

  it('日英両ロケールが移行文言と宛先判定キーを持ち、空でない', () => {
    for (const locale of ['ja', 'en'] as const) {
      const messages = JSON.parse(readFromRoot(`public/_locales/${locale}/messages.json`)) as Record<
        string,
        { message?: string }
      >;
      for (const key of [
        'webhookExportLegacyOrigins',
        'webhookExportDestinationPermitted',
        'webhookExportDestinationGrandfathered',
        'webhookExportDestinationNonHttps',
        'webhookExportDestinationNotInAllowlist',
      ]) {
        expect(typeof messages[key]?.message, `${locale}:${key}`).toBe('string');
        expect((messages[key]?.message ?? '').length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('README と PRIVACY の該当箇所に初期集合の扱いが明記されている', () => {
    const readme = readFromRoot('README.md');
    expect(readme).toContain('初期集合');
    expect(readme).toContain('initial set');
    const privacy = readFromRoot('docs/PRIVACY.md');
    const publicPrivacy = readFromRoot('public/PRIVACY.md');
    expect(privacy).toContain('初期集合');
    expect(privacy).toContain('initial set');
    // PRIVACY.md stays byte-identical between docs/ and public/.
    expect(publicPrivacy).toBe(privacy);
  });
});
