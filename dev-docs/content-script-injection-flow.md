# Content Script Injection Flow / コンテンツスクリプト注入フロー

## Overview / 概要

Yasumaro のコンテンツスクリプトは2段階の注入アーキテクチャを採用している。

1. **静的注入（manifest）**: `loader.ts` が全ページに自動注入される
2. **動的注入（programmatic）**: 条件を満たした場合に `extractor.ts` が動的インポートされる

## Architecture / アーキテクチャ

```
manifest.json
  └─ content_scripts.js → src/content/loader.ts (全URLで即時実行)
       │
       ├─ [early return] chrome://, edge:// 等の内部スキーム
       ├─ [cache check] domainFilterCache で許可ドメインか確認
       │     └─ キャッシュミス時:
       │         chrome.runtime.sendMessage({ type: 'CHECK_DOMAIN' })
       │         → service-worker.ts が domainFilter を参照して判定
       │
       ├─ [dynamic import] import('./extractor.js')
       │     └─ src/content/extractor.ts
       │           ├─ 設定読み込み: chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
       │           ├─ コンテンツ抽出: extractMainContent()
       │           ├─ エンゲージメント監視: scrollRatio, visitDuration
       │           └─ 記録送信: chrome.runtime.sendMessage({ type: 'VALID_VISIT', payload: {...} })
       │                 → service-worker.ts → RecordingPipeline
       │
       └─ [error fallback] リトライ (最大3回) 後、ドメインをブロック
```

## Message Types / メッセージ型

Content Script ↔ Service Worker 間の全メッセージ型は `src/background/messageTypes.ts` で単一管理されている。

| direction | type | defined in | source file |
|-----------|------|------------|-------------|
| CS → SW | `CHECK_DOMAIN` | `CheckDomainMessage` | `src/content/loader.ts` |
| CS → SW | `VALID_VISIT` | `ValidVisitMessage` | `src/content/extractor.ts` |
| CS → SW | `GET_CONTENT` | `GetContentMessage` | `src/content/extractor.ts` |
| SW → CS | (response) | inline | `src/background/service-worker.ts` |

Content scripts 内で文字列リテラル (`'CHECK_DOMAIN'`, `'VALID_VISIT'`) として直書きされていた型参照は、graphify の依存グラフ可視化のため `import type` で明示化済み（PBI-02-3）。

## Related ADRs / 関連ADR

- [ADR-013: WXT への移行](../ADR/2026-04-19-wxt-migration.md) — `content_scripts` 設定は `wxt.config.ts` が生成
