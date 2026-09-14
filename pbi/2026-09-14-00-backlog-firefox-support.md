# バックログ: Firefox 対応ロードマップの PBI 化（2026-09-14）

`autonomous-task-closer` セッションで発見した Firefox 動作不能の根本原因（`chrome.offscreen` 依存）と、VFS プローブによる検証結果（Firefox 155 で wa-sqlite OPFS SAH / FTS5 / 永続化 / IDB fallback 全 green）を受け、Firefox 対応を3件の PBI に分解したもの。目標バージョンは v6.9.0（奇数マイナー = 新機能ライン）。

## 前提資産

- **VFS プローブ**: `testDir/e2e/firefox-opfs-probe.spec.ts` + probe Worker。main 取り込み済み（2026-09-14）
- **検証済み知見**:
  - 根本原因は `src/background/offscreenTransport.ts:83,94` のガードなき `chrome.offscreen` 呼び出しのみ。ストレージエンジン層は Firefox でそのまま動く
  - glue と wasm は同一ビルドファミリーで揃える: `@subframe7536/sqlite-wasm` glue には **`@subframe7536/dist/wa-sqlite-async.wasm`**（ASYNCIFY 版）。`wa-sqlite` devDep の wasm は `null function` で不整合
  - `supportsOffscreen()` feature-detect が `src/utils/browserSupport.ts:57` に既存（transport 未使用）
  - wxt は `background.service_worker` を Firefox 用イベントページへ自動変換済み（manifest 確認済み）

## 順位表

| 順位 | PBI | RICEスコア | R / I / C / E | 根拠・依存関係 |
|---|---|---|---|---|
| 1 | 2026-09-14-09-feat-firefox-storage-port.md | **36.0** | 30 / 3 / 80% / 2人日 | プラットフォーム解锁の中核。最大リスク（VFS互換）はプローブで解消済み → Confidence 80%。Phase 1+2 を統合（manifest・ビルドは検証に不可欠なため） |
| 2 | 2026-09-14-10-test-firefox-e2e-ci.md | **32.0** | 20 / 1 / 80% / 0.5人日 | 回帰網の確保。**09 に依存**（gecko.id と動くビルドが前提） |
| 3 | 2026-09-14-11-chore-firefox-release-readiness.md | **30.0** | 30 / 2 / 50% / 1人日 | 実機 QA の発見事項は工数不確実性が最大 → Confidence 50%。**09・10 に依存**。配布方針（AMO vs GitHub Releases）の意思決定を含む |

スコアの差は僅差（32.0 / 30.0）だが、依存関係（10 は 09 の gecko.id・動くビルド、11 は 09・10 の成果物が前提）がスコアより優先され、この順で確定。

## 実行順

```
09 (storage port + manifest/build) → 10 (probe取込 + E2E/CI) → 11 (実機QA + リリース準備)
```
