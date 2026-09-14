# PBI: Firefox ストレージ移植の中核 — StorageHost seam と manifest/build 整備

## ステータス: ⬜ 未着手（順位1 / RICE 36.0 / 台帳: 2026-09-14-00-backlog-firefox-support.md）

## ユーザーストーリー

Firefox ユーザー（技術ドキュメントや論文、長文記事をよく読むエンジニアやリサーチャー）として、Yasumaro の記録・検索機能を Firefox で使いたい。なぜなら Chromium 系ブラウザに縛られず、普段使いのブラウザで知識管理を続けたいから。

## 優先度

- 順位: 1 / 全候補数 3
- RICEスコア: 36.0（Reach=30 / Impact=3 / Confidence=80% / Effort=2人日）
- 根拠: プラットフォーム解锁の中核。最大の不確実要素（Firefox での wa-sqlite OPFS VFS 互換性）は VFS プローブ（main 済み）で解消済み。Phase 1（コンテナ抽象化）と Phase 2（manifest/build）を統合する — manifest なしでは移植の検証ができないため

## 背景（検証済み事実）

- **根本原因**: Firefox には `chrome.offscreen` API が存在しない。`src/background/offscreenTransport.ts:83`（`chrome.offscreen.hasDocument()`）と `:94`（`createDocument()`）がガードなしで呼ばれ、最初のストレージ操作で `TypeError` により記録・検索・パージが全滅する
- **ストレージ層は Firefox 互換**: VFS プローブ（Firefox 155 / chromium 対照）で、`@subframe7536/sqlite-wasm` glue + ASYNCIFY wasm のペアが OPFS SAH の open → CRUD → FTS5 → reopen 永続化、および IDB VFS を全 green
- **wasm ペアの制約**: glue と wasm は同一ビルドファミリー必須。`@subframe7536` glue には `@subframe7536/dist/wa-sqlite-async.wasm` を使う（`wa-sqlite` devDep の wasm は `null function` で不整合）
- **feature-detect は既存**: `supportsOffscreen()` が `src/utils/browserSupport.ts:57` にあるが transport が未使用
- **wxt の自動変換**: `background.service_worker` → Firefox 用 `background.scripts`（イベントページ）は wxt が処理済み。イベントページは DOM・Worker 生成可

## 実装ガイド

### 1. offscreen 消費者の棚卸し

`src/offscreen/` の offscreen document 消費者を列挙する。既知: sqlite エンジン（opfsWorker / IDB engine / storageFallback）、`cleansingOffscreen.ts`。全消費者が新設する Host seam 経由になるよう整理する。

### 2. StorageHost seam の新設

- `supportsOffscreen()`（`src/utils/browserSupport.ts:57`）で分岐:
  - **Chromium**: 現行 `OffscreenDocumentTransport`（offscreen document + `chrome.runtime.sendMessage` 経由）をそのまま使用
  - **Firefox**: `EventPageWorkerTransport` 新設 — イベントページ（DOM・Worker 可）から `new Worker(chrome.runtime.getURL(...))` で opfsWorker を直接起動し、既存の Worker メッセージ契約（`WorkerRequestMessage` / `WorkerResponseMessage`、`src/offscreen/opfsWorker/types.ts`）を postMessage で流用
- `offscreenTransport.ts` の呼び出し側（offscreenGateway 系）は seam 経由のみにし、`chrome.offscreen` 直参照を殺す
- IDB エンジン（`sqliteEngineContext`）も同様にイベントページ Worker でホストする
- **wasm は `@subframe7536/dist/wa-sqlite-async.wasm` に固定**（glue と同一ファミリー。同期版は chromium でも動くが ASYNCIFY 版に統一）

### 3. keep-alive の転用

`src/background/alarmRegistry.ts` の offscreen 維持 alarm をイベントページ維持に転用（Firefox MV3 イベントページもアイドルで停止する）。

### 4. manifest とビルド

- `browser_specific_settings.gecko.id` を追加（wxt の firefox ビルド時のみ。wxt.config で browser 判定して条件付与）
- `offscreen` / `favicon` 権限を chromium ビルドのみに含める（Firefox では未知権限警告）
- `npm run build:firefox` スクリプト追加（`npx wxt build -b firefox`）+ `build:store` 系に倣った zip 生成確認

### 触ってはいけないもの

- `SQLITE_QUERY` 等のメッセージ契約（type / payload / `OffscreenResponse`）— 変更すると Gateway・Handler・dashboard に波及する
- `opfsCapabilities.ts` の実行時 fallback 構造（opfs-sync-worker → idb → fallback はそのまま活用）

## BDD受け入れシナリオ

```gherkin
Scenario: Firefox で記録が SQLite に保存される
  Given Firefox に firefox ビルドを読み込み済みで同意も完了している
  When  有効なページを閲覧して記録が走る
  Then  レコードが OPFS VFS 経由で保存され、診断パネルのレコード数が増える

Scenario: offscreen 非対応環境で transport が分岐する
  Given chrome.offscreen が存在しない環境で拡張が起動した
  When  最初のストレージ操作が発生する
  Then  supportsOffscreen() により EventPageWorkerTransport が選択され、TypeError なく動作する
```

## 受け入れ基準

- [ ] `chrome.offscreen` 直参照が `supportsOffscreen()` 分岐の内側にのみ存在する
- [ ] `npx wxt build -b firefox` が成功し、unit tests 全件 green
- [ ] Firefox（about:debugging 一時読み込み）で記録 → ダッシュボード検索の smoke が通る
- [ ] manifest に `browser_specific_settings.gecko.id` があり、`offscreen` / `favicon` 権限が chromium ビルドのみ
- [ ] `npm run build:firefox` スクリプトが存在する
- [ ] chromium ビルドの既存挙動が不変（unit tests + usability e2e で確認）

## テスト戦略

- E2E: VFS プローブ + 手動 smoke（本PBI範囲。自動 E2E は PBI 10）
- 統合: offscreenGateway の transport 分岐テスト（supportsOffscreen モック）
- 単体: 既存 12,024 件が回帰網として機能（メッセージ契約不変のため）

## 見積もり

2人日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（ARCHITECTURE_MAP の storage 経路）
